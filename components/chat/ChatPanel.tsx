"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { capture } from "@/lib/telemetry/posthog";
import { useVoiceRecording } from "../hooks/useVoiceRecording";

const MAX_SEND_RETRIES = 3;

export type Message = {
  role: "user" | "system";
  text: string;
  suggestions?: string[];
};

type Props = {
  currentMusicXml: string | null;
  selectedMeasures: Set<number>;
  messages: Message[];
  onMessagesChange: (messages: Message[]) => void;
  onClearSelection: () => void;
  onScoreReady: (musicXml: string, name?: string) => void;
  onUsageRefresh: () => void;
  onSingClick?: () => void;
  initialPrompt?: string;
};

export default function ChatPanel({
  currentMusicXml,
  selectedMeasures,
  messages,
  onMessagesChange,
  onClearSelection,
  onScoreReady,
  onUsageRefresh,
  onSingClick,
  initialPrompt,
}: Props) {
  const [instruction, setInstruction] = useState(initialPrompt ?? "");
  const [loading, setLoading] = useState(false);
  const [paywallHit, setPaywallHit] = useState(false);
  const [usage, setUsage] = useState<{ plan: string; used: number; limit: number | null } | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then(setUsage)
      .catch(() => {});
  }, []);

  const isAtLimit =
    paywallHit || (usage !== null && usage.plan === "free" && usage.limit !== null && usage.used >= usage.limit);

  function refreshUsage() {
    fetch("/api/usage")
      .then((r) => r.json())
      .then((u) => {
        setUsage(u);
        onUsageRefresh();
      })
      .catch(() => {});
  }

  // Always-current ref so sendMessage never uses stale messages
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { recording, transcribing, recordingSecs, micSupported, toggleRecording } = useVoiceRecording(
    setInstruction,
    formRef,
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function addMessage(msg: Message) {
    onMessagesChange([...messages, msg]);
  }

  async function handleUpgrade() {
    capture("upgrade_clicked");
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        addMessage({ role: "system", text: `Checkout error: ${data.error ?? "unknown error"}` });
      }
    } catch {
      addMessage({ role: "system", text: "Failed to start checkout." });
    }
  }

  const autoSubmittedRef = useRef(false);

  // Auto-submit initialPrompt once the score is ready
  useEffect(() => {
    if (!initialPrompt || autoSubmittedRef.current || !currentMusicXml) return;
    autoSubmittedRef.current = true;
    sendMessage(initialPrompt, new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, currentMusicXml]);

  async function sendMessage(text: string, selection: Set<number>) {
    if (!text.trim()) return;

    const selectionNote = selection.size > 0 ? ` [measures ${[...selection].sort((a, b) => a - b).join(", ")}]` : "";

    const next: Message[] = [...messagesRef.current, { role: "user", text: text + selectionNote }];
    onMessagesChange(next);
    setInstruction("");
    onClearSelection();
    setLoading(true);
    capture("chat_message_sent", {
      messageLength: text.length,
      hasScore: !!currentMusicXml,
      selectedMeasureCount: selection.size,
    });

    try {
      const form = new FormData();
      form.append("message", text);
      if (currentMusicXml) form.append("musicXml", currentMusicXml);
      if (selection.size > 0) {
        form.append("selectedMeasures", JSON.stringify([...selection].sort((a, b) => a - b)));
      }
      // Send chat history (user messages without [measures] suffix, system→assistant)
      if (messages.length > 0) {
        const history = messages.map((m) => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: m.role === "user" ? m.text.replace(/\s*\[measures\s[\d,\s]+\]$/, "") : m.text,
        }));
        form.append("history", JSON.stringify(history));
      }

      let res: Response | null = null;
      for (let attempt = 0; attempt < MAX_SEND_RETRIES; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
        try {
          res = await fetch("/api/agent", { method: "POST", body: form });
          break;
        } catch {
          /* retry */
        }
      }
      if (!res) throw new Error("network");
      const data = await res.json();

      if (res.status === 402) {
        capture("paywall_hit");
        setPaywallHit(true);
        onMessagesChange([
          ...next,
          { role: "system", text: "You've used all your free interactions. Upgrade to Pro for unlimited access." },
        ]);
      } else if (data.error) {
        onMessagesChange([...next, { role: "system", text: `Error: ${data.error}` }]);
      } else if (data.type === "chat") {
        onMessagesChange([...next, { role: "system", text: data.message }]);
        refreshUsage();
      } else if (data.type === "load") {
        onMessagesChange([...next, { role: "system", text: `Loaded: ${data.name ?? "score"}` }]);
        onScoreReady(data.musicXml, data.name);
        onClearSelection();
        refreshUsage();
      } else if (data.type === "modify") {
        onMessagesChange([...next, { role: "system", text: data.message || "Score updated." }]);
        onScoreReady(data.musicXml, text);
        onClearSelection();
        refreshUsage();
      }
    } catch {
      onMessagesChange([
        ...next,
        { role: "system", text: "Connection error — please check your internet and try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await sendMessage(instruction, selectedMeasures);
  }

  // Memoize suggestion filtering
  const visibleSuggestions = useMemo(() => {
    const hasUserMsg = messages.some((m) => m.role === "user");
    if (hasUserMsg || loading || isAtLimit) return null;
    const suggestions = [...messages].reverse().find((m) => m.suggestions?.length)?.suggestions;
    if (!suggestions?.length) return null;
    return suggestions;
  }, [messages, loading, isAtLimit]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-hide bg-gray-50"
        style={{ scrollbarWidth: "none" }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm px-3 py-2 rounded-lg max-w-[90%] ${
              m.role === "user"
                ? "bg-brand-primary text-white self-end ml-auto"
                : "bg-white border border-gray-200 text-gray-700 self-start shadow-sm"
            }`}
          >
            {m.text}
          </div>
        ))}
        {transcribing && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 self-start text-brand-secondary text-sm shadow-sm">
            <span className="flex gap-0.5">
              <span
                className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </span>
            Transcribing voice…
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 self-start text-brand-secondary text-sm shadow-sm">
            <span className="flex gap-0.5">
              <span
                className="w-1.5 h-1.5 rounded-full bg-brand-secondary animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-brand-secondary animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-brand-secondary animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </span>
            Processing…
          </div>
        )}
        {isAtLimit && (
          <div className="px-3 py-3 rounded-lg bg-amber-50 border border-amber-200 text-center space-y-2">
            <p className="text-sm text-amber-800">Free tier limit reached</p>
            <button
              onClick={handleUpgrade}
              className="px-4 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-lg text-sm font-medium transition"
            >
              Upgrade to Pro
            </button>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Suggestion chips — shown above input until first user message */}
      {visibleSuggestions && (
        <div className="px-3 py-2 flex flex-wrap gap-1.5 border-t border-gray-100 bg-white">
          {visibleSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => sendMessage(s, selectedMeasures)}
              className="text-xs px-2.5 py-1 rounded-full bg-white border border-brand-primary/30 text-brand-primary hover:bg-brand-primary/5 transition shadow-sm"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="border-t border-gray-200 p-3 space-y-2 bg-white">
        {/* Selection badge */}
        {selectedMeasures.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-primary/5 border border-brand-primary/20 text-xs text-brand-primary">
            <span>
              {selectedMeasures.size === 1 ? "Measure" : "Measures"}{" "}
              {[...selectedMeasures].sort((a, b) => a - b).join(", ")} selected
            </span>
            <button
              type="button"
              onClick={onClearSelection}
              className="ml-auto text-brand-primary hover:text-brand-primary/70 transition"
            >
              ✕
            </button>
          </div>
        )}

        {/* Instruction input — ChatGPT-style container */}
        <div
          className={`relative bg-gray-50 rounded-xl border transition ${
            recording ? "border-red-500" : "border-gray-200 focus-within:border-brand-primary"
          }`}
        >
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            placeholder={
              recording
                ? "Recording…"
                : currentMusicXml
                  ? "Modify, transpose, ask anything…"
                  : "Ask me to create a score…"
            }
            disabled={loading || isAtLimit || recording}
            rows={3}
            className="w-full bg-transparent rounded-xl px-3 pt-3 pb-12 text-sm text-gray-900 placeholder-gray-400 outline-none disabled:opacity-40 resize-none"
          />
          <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
            {/* Recording state: full-width stop & send button */}
            {recording ? (
              <button
                type="button"
                onClick={toggleRecording}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                {String(Math.floor(recordingSecs / 60)).padStart(2, "0")}:{String(recordingSecs % 60).padStart(2, "0")}
                <span className="mx-1 text-red-200">·</span>
                Stop & Send
              </button>
            ) : (
              <>
                <div className="flex-1" />
                {onSingClick && (
                  <button
                    type="button"
                    onClick={() => {
                      capture("sing_opened");
                      onSingClick();
                    }}
                    disabled={loading || isAtLimit}
                    className="p-1.5 rounded-lg transition disabled:opacity-40 text-gray-400 hover:text-gray-700 hover:bg-gray-200"
                    title="Sing a melody"
                    aria-label="Sing a melody"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path d="M17.721 1.599a.75.75 0 0 1 .279.583v12.568a.75.75 0 0 1-.773.75 9.033 9.033 0 0 0-1.727.189c-.6.122-1.187.316-1.623.569-.437.253-.727.53-.727.796 0 .265.29.543.727.796.436.253 1.024.447 1.623.57a9.035 9.035 0 0 0 1.727.188.75.75 0 0 1 .773.75V20a.75.75 0 0 1-.75.75h-.003a10.54 10.54 0 0 1-2.065-.228c-.747-.152-1.535-.4-2.17-.753C12.376 19.416 12 18.87 12 18.25c0-.62.376-1.166 1.012-1.52.635-.352 1.423-.6 2.17-.752A10.539 10.539 0 0 1 17 15.75V4.832l-10 2.5v10.918a.75.75 0 0 1-.773.75 9.032 9.032 0 0 0-1.727.189c-.6.122-1.187.316-1.623.569C2.44 20.011 2.15 20.288 2.15 20.554c0 .265.29.543.727.796.436.253 1.024.447 1.623.57.593.12 1.186.178 1.727.188A.75.75 0 0 1 7 22.857V10a.75.75 0 0 1 .553-.724l12-3a.75.75 0 0 1 .947.723V1.6a.75.75 0 0 1-.779-.001Z" />
                    </svg>
                  </button>
                )}
                {micSupported && (
                  <button
                    type="button"
                    onClick={toggleRecording}
                    disabled={loading || isAtLimit || transcribing}
                    className="p-1.5 rounded-lg transition disabled:opacity-40 text-gray-400 hover:text-gray-700 hover:bg-gray-200"
                    title="Voice input"
                    aria-label="Voice input"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path d="M7 4a3 3 0 0 1 6 0v4a3 3 0 1 1-6 0V4Z" />
                      <path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" />
                    </svg>
                  </button>
                )}
                <button
                  type="submit"
                  disabled={loading || !instruction.trim() || isAtLimit}
                  className="p-1.5 rounded-lg bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-40 text-white transition"
                  title="Send"
                  aria-label="Send message"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95l14.095-5.637a.75.75 0 0 0 0-1.4L3.105 2.288Z" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

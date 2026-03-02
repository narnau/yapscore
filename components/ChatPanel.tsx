"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { capture } from "@/lib/posthog";

export type Message = {
  role: "user" | "system";
  text: string;
};

type Usage = {
  plan: "free" | "pro";
  used: number;
  limit: number | null;
};

type Props = {
  currentMusicXml: string | null;
  fileName: string;
  onFileNameChange: (name: string) => void;
  selectedMeasures: Set<number>;
  messages: Message[];
  onMessagesChange: (messages: Message[]) => void;
  onClearSelection: () => void;
  onScoreReady: (musicXml: string, name?: string) => void;
  onNew: () => void;
  usage: Usage | null;
  onUsageRefresh: () => void;
};

export default function ChatPanel({
  currentMusicXml,
  fileName,
  onFileNameChange,
  selectedMeasures,
  messages,
  onMessagesChange,
  onClearSelection,
  onScoreReady,
  onNew,
  usage,
  onUsageRefresh,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [paywallHit, setPaywallHit] = useState(false);

  const isAtLimit = paywallHit || (
    usage !== null && usage.plan === "free" && usage.limit !== null && usage.used >= usage.limit
  );
  const [editingName, setEditingName] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [micSupported, setMicSupported] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setMicSupported(!!navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function addMessage(msg: Message) {
    onMessagesChange([...messages, msg]);
  }

  const toggleRecording = useCallback(async () => {
    // Stop recording
    if (recording) {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      mediaRecorderRef.current?.stop();
      return;
    }

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        setRecordingSecs(0);

        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        if (blob.size === 0) return;
        capture("voice_recording_completed");

        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "recording");
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = await res.json();
          if (data.transcript) {
            setInstruction(data.transcript);
            setTimeout(() => formRef.current?.requestSubmit(), 100);
          }
        } catch {
          // silently ignore transcription errors
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingSecs(0);
      setRecording(true);
      capture("voice_recording_started");
      recordingTimerRef.current = setInterval(() => setRecordingSecs(s => s + 1), 1000);
    } catch {
      // microphone permission denied or unavailable
    }
  }, [recording]);

  async function handleFileUpload(file: File) {
    capture("file_uploaded", {
      fileType: file.name.split(".").pop()?.toLowerCase(),
      fileSizeKb: Math.round(file.size / 1024),
    });
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/load", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) {
        addMessage({ role: "system", text: `Error loading file: ${data.error}` });
      } else {
        const name = file.name.replace(/\.(mscz|mxl|xml|musicxml)$/i, "");
        onFileNameChange(name);
        onScoreReady(data.musicXml, name);
        addMessage({ role: "system", text: `Loaded: ${file.name}` });
      }
    } catch {
      addMessage({ role: "system", text: "Failed to upload file." });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleUpgrade() {
    capture("upgrade_clicked");
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      addMessage({ role: "system", text: "Failed to start checkout." });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!instruction.trim()) return;

    const text = instruction;
    const selectionNote =
      selectedMeasures.size > 0
        ? ` [measures ${[...selectedMeasures].sort((a, b) => a - b).join(", ")}]`
        : "";

    const next: Message[] = [...messages, { role: "user", text: text + selectionNote }];
    onMessagesChange(next);
    setInstruction("");
    onClearSelection();
    setLoading(true);
    capture("chat_message_sent", {
      messageLength: text.length,
      hasScore: !!currentMusicXml,
      selectedMeasureCount: selectedMeasures.size,
    });

    try {
      const form = new FormData();
      form.append("message", text);
      if (currentMusicXml) form.append("musicXml", currentMusicXml);
      if (selectedMeasures.size > 0) {
        form.append(
          "selectedMeasures",
          JSON.stringify([...selectedMeasures].sort((a, b) => a - b))
        );
      }
      // Send chat history (user messages without [measures] suffix, system→assistant)
      if (messages.length > 0) {
        const history = messages.map((m) => ({
          role: m.role === "user" ? "user" as const : "assistant" as const,
          content: m.role === "user"
            ? m.text.replace(/\s*\[measures\s[\d,\s]+\]$/, "")
            : m.text,
        }));
        form.append("history", JSON.stringify(history));
      }

      const res = await fetch("/api/agent", { method: "POST", body: form });
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
        onUsageRefresh();
      } else if (data.type === "load") {
        onMessagesChange([...next, { role: "system", text: `Loaded: ${data.name ?? "score"}` }]);
        onScoreReady(data.musicXml, data.name);
        onClearSelection();
        onUsageRefresh();
      } else if (data.type === "modify") {
        onMessagesChange([...next, { role: "system", text: data.message || "Score updated." }]);
        onScoreReady(data.musicXml, text);
        onClearSelection();
        onUsageRefresh();
      }
    } catch {
      onMessagesChange([...next, { role: "system", text: "Network error." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">YapScore</h1>
          <div className="flex items-center gap-1.5">
            {usage && usage.limit !== null && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                {usage.used}/{usage.limit}
              </span>
            )}
            {usage?.plan === "pro" && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900 text-indigo-300">
                Pro
              </span>
            )}
            {currentMusicXml && (
              <button
                onClick={() => { onMessagesChange([]); onNew(); }}
                className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-300 transition"
                title="Clear score and start fresh"
              >
                New
              </button>
            )}
          </div>
        </div>
        {/* Inline-editable file name */}
        {editingName ? (
          <input
            autoFocus
            type="text"
            value={fileName}
            onChange={(e) => onFileNameChange(e.target.value)}
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingName(false); }}
            className="mt-0.5 w-full bg-gray-800 text-xs text-gray-200 px-1.5 py-0.5 rounded outline-none focus:ring-1 focus:ring-indigo-500"
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="mt-0.5 text-xs text-gray-400 hover:text-gray-200 truncate max-w-full text-left transition"
            title="Click to rename"
          >
            {fileName}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm px-3 py-2 rounded-lg max-w-[90%] ${
              m.role === "user"
                ? "bg-indigo-600 self-end ml-auto"
                : "bg-gray-800 self-start"
            }`}
          >
            {m.text}
          </div>
        ))}
        {transcribing && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 self-start text-gray-400 text-sm">
            <span className="flex gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
            Transcribing voice…
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 self-start text-gray-400 text-sm">
            <span className="flex gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
            Processing…
          </div>
        )}
        {isAtLimit && (
          <div className="px-3 py-3 rounded-lg bg-amber-900/30 border border-amber-700 text-center space-y-2">
            <p className="text-sm text-amber-200">Free tier limit reached</p>
            <button
              onClick={handleUpgrade}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition"
            >
              Upgrade to Pro
            </button>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".mscz,.mxl,.xml,.musicxml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
        }}
      />

      <form ref={formRef} onSubmit={handleSubmit} className="border-t border-gray-800 p-3 space-y-2">
        {/* Selection badge */}
        {selectedMeasures.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-900/50 border border-indigo-700 text-xs text-indigo-300">
            <span>
              {selectedMeasures.size === 1 ? "Measure" : "Measures"} {[...selectedMeasures].sort((a, b) => a - b).join(", ")} selected
            </span>
            <button
              type="button"
              onClick={onClearSelection}
              className="ml-auto text-indigo-400 hover:text-white transition"
            >
              ✕
            </button>
          </div>
        )}

        {/* Instruction input — ChatGPT-style container */}
        <div className={`relative bg-gray-800 rounded-xl border transition ${
          recording ? "border-red-500" : "border-gray-700 focus-within:border-indigo-500"
        }`}>
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
                : "Ask me to create a score, or upload a file with 📎…"
            }
            disabled={loading || isAtLimit || recording}
            rows={3}
            className="w-full bg-transparent rounded-xl px-3 pt-3 pb-12 text-sm outline-none disabled:opacity-40 resize-none"
          />
          <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
            {/* Recording state: full-width stop & send button */}
            {recording ? (
              <button
                type="button"
                onClick={toggleRecording}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                {String(Math.floor(recordingSecs / 60)).padStart(2, "0")}:{String(recordingSecs % 60).padStart(2, "0")}
                <span className="mx-1 text-red-200">·</span>
                Stop & Send
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || uploading}
                  className="p-1.5 rounded-lg transition disabled:opacity-40 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
                  title="Upload .mscz or .mxl file"
                >
                  {uploading ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 animate-spin">
                      <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243h.001l.497-.5a.75.75 0 0 1 1.064 1.057l-.498.501-.002.002a4.5 4.5 0 0 1-6.364-6.364l7-7a4.5 4.5 0 0 1 6.368 6.36l-3.455 3.553A2.625 2.625 0 1 1 9.52 9.52l3.45-3.451a.75.75 0 1 1 1.061 1.06l-3.45 3.451a1.125 1.125 0 0 0 1.587 1.595l3.454-3.553a3 3 0 0 0 0-4.242Z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
                <div className="flex-1" />
                {micSupported && (
                  <button
                    type="button"
                    onClick={toggleRecording}
                    disabled={loading || isAtLimit || transcribing}
                    className="p-1.5 rounded-lg transition disabled:opacity-40 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
                    title="Voice input"
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
                  className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition"
                  title="Send"
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

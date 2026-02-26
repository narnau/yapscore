"use client";

import { useEffect, useRef, useState } from "react";

export type Message = {
  role: "user" | "system";
  text: string;
};

type LibraryItem = {
  id: string;
  name: string;
  description: string;
};

type Usage = {
  plan: "free" | "pro";
  used: number;
  limit: number | null;
};

type Props = {
  currentMusicXml: string | null;
  scoreName: string | null;
  selectedMeasures: Set<number>;
  onClearSelection: () => void;
  onScoreReady: (musicXml: string, name?: string) => void;
  onOpenLibrary: () => void;
  onNew: () => void;
};

export default function ChatPanel({
  currentMusicXml,
  scoreName,
  selectedMeasures,
  onClearSelection,
  onScoreReady,
  onOpenLibrary,
  onNew,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", text: "Upload a score (.mscz or .musicxml), load one from the library, or just ask me to create one from scratch!" },
  ]);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [paywallHit, setPaywallHit] = useState(false);

  useEffect(() => {
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => setLibrary(d.scores ?? []));
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => setUsage(d));
  }, []);

  async function refreshUsage() {
    try {
      const res = await fetch("/api/usage");
      const data = await res.json();
      setUsage(data);
    } catch {
      // ignore
    }
  }

  async function handleUpgrade() {
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      setMessages((m) => [...m, { role: "system", text: "Failed to start checkout." }]);
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
    setMessages((m) => [...m, { role: "user", text: text + selectionNote }]);
    setInstruction("");
    setLoading(true);

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
      form.append("library", JSON.stringify(library));

      const res = await fetch("/api/agent", { method: "POST", body: form });
      const data = await res.json();

      if (res.status === 402) {
        setPaywallHit(true);
        setMessages((m) => [
          ...m,
          { role: "system", text: "You've used all your free interactions. Upgrade to Pro for unlimited access." },
        ]);
      } else if (data.error) {
        setMessages((m) => [...m, { role: "system", text: `Error: ${data.error}` }]);
      } else if (data.type === "chat") {
        setMessages((m) => [...m, { role: "system", text: data.message }]);
        await refreshUsage();
      } else if (data.type === "load") {
        setMessages((m) => [
          ...m,
          { role: "system", text: `Loaded: ${data.name ?? "score"}` },
        ]);
        onScoreReady(data.musicXml, data.name);
        onClearSelection();
        await refreshUsage();
        // Refresh library list
        fetch("/api/library")
          .then((r) => r.json())
          .then((d) => setLibrary(d.scores ?? []));
      } else if (data.type === "modify") {
        setMessages((m) => [...m, { role: "system", text: "Score updated." }]);
        onScoreReady(data.musicXml, text);
        onClearSelection();
        await refreshUsage();
      }
    } catch {
      setMessages((m) => [...m, { role: "system", text: "Network error." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">score-ai</h1>
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
                onClick={onNew}
                className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-300 transition"
                title="Clear score and start fresh"
              >
                New
              </button>
            )}
            <button
              onClick={onOpenLibrary}
              className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
            >
              Library
            </button>
          </div>
        </div>
        {scoreName && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{scoreName}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
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
        {loading && (
          <div className="text-sm px-3 py-2 rounded-lg bg-gray-800 self-start text-gray-400 animate-pulse">
            Processing…
          </div>
        )}
        {paywallHit && (
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
      </div>

      <form onSubmit={handleSubmit} className="border-t border-gray-800 p-3 space-y-2">
        {/* File picker */}
        <div className="block">
          <span className="text-xs text-gray-400">Score file (.mscz or .musicxml)</span>
          <div
            className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 cursor-pointer hover:bg-gray-700 transition"
            onClick={() => fileRef.current?.click()}
          >
            <span className="text-xs text-gray-300 truncate">
              {fileName ?? "Click to upload…"}
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".mscz,.musicxml,.xml"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileName(f.name);
              setLoading(true);
              try {
                const name = f.name.replace(/\.(mscz|musicxml|xml)$/i, "");
                if (f.name.endsWith(".mscz")) {
                  // .mscz → convert server-side via mscore
                  const form = new FormData();
                  form.append("file", f);
                  const res = await fetch("/api/load", { method: "POST", body: form });
                  const data = await res.json();
                  if (data.musicXml) onScoreReady(data.musicXml, name);
                } else {
                  // .musicxml / .xml → read directly, no conversion needed
                  const text = await f.text();
                  onScoreReady(text, name);
                }
              } finally {
                setLoading(false);
              }
            }}
          />
        </div>

        {/* Selection badge */}
        {selectedMeasures.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-900/50 border border-indigo-700 text-xs text-indigo-300">
            <span>
              Measures {[...selectedMeasures].sort((a, b) => a - b).join(", ")} selected
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

        {/* Instruction input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={
              currentMusicXml
                ? "Modify, transpose, ask anything…"
                : "Ask me to create a score, or upload one above…"
            }
            disabled={loading || paywallHit}
            className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={loading || !instruction.trim() || paywallHit}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-sm font-medium transition"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

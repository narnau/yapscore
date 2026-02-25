"use client";

import { useRef, useState } from "react";

export type Message = {
  role: "user" | "system";
  text: string;
};

type Props = {
  currentMusicXml: string | null;
  selectedMeasures: Set<number>;
  onClearSelection: () => void;
  onScoreReady: (musicXml: string) => void;
};

export default function ChatPanel({ currentMusicXml, selectedMeasures, onClearSelection, onScoreReady }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", text: "Upload a .mscz file and type an instruction to modify it." },
  ]);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentMusicXml || !instruction.trim()) return;

    const text = instruction;
    const selectionNote = selectedMeasures.size > 0
      ? ` [measures ${[...selectedMeasures].sort((a, b) => a - b).join(", ")}]`
      : "";
    setMessages((m) => [...m, { role: "user", text: text + selectionNote }]);
    setInstruction("");
    setLoading(true);

    try {
      const form = new FormData();
      form.append("musicXml", currentMusicXml);
      form.append("instruction", text);
      if (selectedMeasures.size > 0) {
        form.append("selectedMeasures", JSON.stringify([...selectedMeasures].sort((a, b) => a - b)));
      }

      const res = await fetch("/api/modify", { method: "POST", body: form });
      const data = await res.json();

      if (data.error) {
        setMessages((m) => [...m, { role: "system", text: `Error: ${data.error}` }]);
      } else {
        setMessages((m) => [...m, { role: "system", text: "Score updated." }]);
        onScoreReady(data.musicXml);
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
        <h1 className="text-lg font-semibold tracking-tight">score-ai</h1>
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
      </div>

      <form onSubmit={handleSubmit} className="border-t border-gray-800 p-3 space-y-2">
        {/* File picker */}
        <div className="block">
          <span className="text-xs text-gray-400">Score file (.mscz)</span>
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
            accept=".mscz"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileName(f.name);
              setLoading(true);
              try {
                const form = new FormData();
                form.append("file", f);
                const res = await fetch("/api/load", { method: "POST", body: form });
                const data = await res.json();
                if (data.musicXml) onScoreReady(data.musicXml);
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
            placeholder={currentMusicXml ? "Type an instruction…" : "Upload a score first…"}
            disabled={!currentMusicXml || loading}
            className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={loading || !instruction.trim() || !currentMusicXml}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-sm font-medium transition"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

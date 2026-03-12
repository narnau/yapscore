"use client";

import { useState } from "react";

const MELODIES = [
  { file: "ode-to-joy.xml", label: "Ode to Joy", composer: "Beethoven" },
  { file: "twinkle-twinkle.xml", label: "Twinkle Twinkle", composer: "Traditional" },
];

const PROMPT_IDEAS = [
  "A gentle waltz in C major",
  "A simple blues melody in E",
  "A Bach-style two-voice invention",
  "A cheerful march in G major",
];

type Props = {
  onPrompt: (prompt: string) => void;
  onMelody: (xml: string, name: string) => void;
  onClose: () => void;
};

export default function NewScoreModal({ onPrompt, onMelody, onClose }: Props) {
  const [tab, setTab] = useState<"prompt" | "melody">("prompt");
  const [prompt, setPrompt] = useState("");
  const [loadingMelody, setLoadingMelody] = useState<string | null>(null);

  async function handleMelody(file: string, label: string) {
    setLoadingMelody(file);
    try {
      const res = await fetch(`/melodies/${file}`);
      const xml = await res.text();
      onMelody(xml, label);
    } finally {
      setLoadingMelody(null);
    }
  }

  function handleRandom() {
    const random = MELODIES[Math.floor(Math.random() * MELODIES.length)];
    handleMelody(random.file, random.label);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label="New score"
        className="bg-white border border-gray-200 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <p className="text-sm font-semibold text-gray-900">New score</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition" title="Close">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pb-4">
          <button
            onClick={() => setTab("prompt")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              tab === "prompt" ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Write an idea
          </button>
          <button
            onClick={() => setTab("melody")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              tab === "melody" ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Start with a melody
          </button>
        </div>

        {/* Tab content */}
        <div className="px-6 pb-6">
          {tab === "prompt" ? (
            <div className="space-y-3">
              <textarea
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (prompt.trim()) onPrompt(prompt.trim());
                  }
                  if (e.key === "Escape") onClose();
                }}
                placeholder="Describe what you'd like to create…"
                rows={3}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/30 transition resize-none"
              />
              {/* Idea chips */}
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_IDEAS.map((idea) => (
                  <button
                    key={idea}
                    onClick={() => setPrompt(idea)}
                    className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition"
                  >
                    {idea}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  if (prompt.trim()) onPrompt(prompt.trim());
                }}
                disabled={!prompt.trim()}
                className="w-full py-2.5 rounded-xl bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-40 text-white text-sm font-medium transition"
              >
                Start
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-1.5">
                {MELODIES.map((m) => (
                  <button
                    key={m.file}
                    onClick={() => handleMelody(m.file, m.label)}
                    disabled={!!loadingMelody}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-100 hover:border-gray-200 text-sm transition disabled:opacity-50 text-left"
                  >
                    <span className="font-medium text-gray-800">{loadingMelody === m.file ? "Loading…" : m.label}</span>
                    <span className="text-xs text-brand-secondary">{m.composer}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={handleRandom}
                disabled={!!loadingMelody}
                className="w-full py-2.5 rounded-xl bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 text-white text-sm font-medium transition"
              >
                {loadingMelody ? "Loading…" : "Load a random melody"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

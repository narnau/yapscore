"use client";

import { useEffect } from "react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-bold text-gray-900 mb-3">{title}</h2>
      <div className="text-sm text-brand-secondary leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export default function DocsModal({ onClose }: { onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h1 className="text-lg font-bold text-gray-900">Documentation</h1>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto px-6 py-5 space-y-6 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">

          <Section title="Getting Started">
            <p>You can start in two ways:</p>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li><strong>Upload a file</strong> — Drop a <code className="text-brand-primary bg-brand-primary/5 px-1 rounded">.musicxml</code> or <code className="text-brand-primary bg-brand-primary/5 px-1 rounded">.mscz</code> file into the chat</li>
              <li><strong>Create from scratch</strong> — Ask the AI to generate a score (e.g. "Write a 12-bar blues in Bb for piano")</li>
            </ul>
            <p>Then simply describe your edits in plain language.</p>
          </Section>

          <Section title="Editing Scores">
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>Click measures in the score to select them for targeted edits</li>
              <li>Hold <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono">Shift</kbd> or <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono">Cmd</kbd> to select multiple measures</li>
              <li>Type instructions like "transpose up a major third" or "add a drum part"</li>
              <li>Use <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono">Ctrl+Z</kbd> / <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono">Ctrl+Y</kbd> to undo/redo</li>
            </ul>
          </Section>

          <Section title="Example Prompts">
            <p>Not sure what to say? Here are some ideas:</p>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {[
                "Transpose the whole piece to G major",
                "Add a forte at measure 12",
                "Write a waltz intro in 3/4 time",
                "Move the bass line down an octave",
                "Add a crescendo from measure 4 to 8",
                "Change the tempo to 120 bpm",
              ].map((prompt) => (
                <div key={prompt} className="bg-gray-50 rounded-lg px-3 py-2 text-xs italic text-gray-600 border border-gray-100">
                  &ldquo;{prompt}&rdquo;
                </div>
              ))}
            </div>
          </Section>

          <Section title="File Compatibility">
            <p>YapScore uses <strong>MusicXML</strong> — compatible with:</p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {["MuseScore", "Finale", "Sibelius", "Dorico", "Noteflight", "Flat.io"].map((app) => (
                <span key={app} className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs font-medium text-gray-700">
                  {app}
                </span>
              ))}
            </div>
            <p className="mt-2">You can also upload <code className="text-brand-primary bg-brand-primary/5 px-1 rounded">.mscz</code> files — they&apos;re converted automatically.</p>
          </Section>

        </div>
      </div>
    </div>
  );
}

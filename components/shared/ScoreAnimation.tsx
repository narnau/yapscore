"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// ─── Staff geometry ──────────────────────────────────────────────────────────
// viewBox 0 0 400 115, treble clef, lines every 10px
const STAFF_LINES = [40, 50, 60, 70, 80]; // y coords of 5 lines
const MIDDLE_LINE_Y = 60; // B4 — notes below get stem-up, above get stem-down

interface Note {
  x: number;
  y: number;
  ledger?: boolean; // needs ledger line (C4 below staff)
}

// ─── Scenarios ───────────────────────────────────────────────────────────────
const SCENARIOS: { prompt: string; notes: Note[] }[] = [
  {
    prompt: "Write a gentle melody in C major",
    notes: [
      { x: 118, y: 90, ledger: true }, // C4  (below staff)
      { x: 178, y: 80 },               // E4  (line 5)
      { x: 238, y: 70 },               // G4  (line 4)
      { x: 298, y: 55 },               // C5  (space 2-3)
    ],
  },
  {
    prompt: "Make it descend — a falling phrase",
    notes: [
      { x: 118, y: 55 },               // C5
      { x: 178, y: 60 },               // B4  (line 3)
      { x: 238, y: 65 },               // A4  (space 3-4)
      { x: 298, y: 70 },               // G4  (line 4)
    ],
  },
  {
    prompt: "Write a waltz, let it breathe",
    notes: [
      { x: 128, y: 70 },               // G4  — 3 beats, 3/4 time
      { x: 218, y: 55 },               // C5
      { x: 308, y: 45 },               // E5
    ],
  },
];

// ─── Timing (ms) ─────────────────────────────────────────────────────────────
const CHAR_MS   = 42;
const NOTE_MS   = 380;
const PLAY_MS   = 280;  // highlight each note during "playback"
const HOLD_MS   = 1600;
const FADE_MS   = 500;

type Phase = "typing" | "appearing" | "playing" | "holding" | "fading";

// ─── Component ───────────────────────────────────────────────────────────────
export default function ScoreAnimation() {
  const [scene, setScene]           = useState(0);
  const [chars, setChars]           = useState(0);
  const [visible, setVisible]       = useState<number[]>([]);
  const [lit, setLit]               = useState<number | null>(null); // playback highlight
  const [phase, setPhase]           = useState<Phase>("typing");
  const [wrapperOpacity, setWrapperOpacity] = useState(1);

  const current = SCENARIOS[scene];

  useEffect(() => {
    // ── typing ──────────────────────────────────────────────────────────────
    if (phase === "typing") {
      if (chars < current.prompt.length) {
        const t = setTimeout(() => setChars((c) => c + 1), CHAR_MS);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase("appearing"), 400);
      return () => clearTimeout(t);
    }

    // ── appearing ───────────────────────────────────────────────────────────
    if (phase === "appearing") {
      if (visible.length < current.notes.length) {
        const t = setTimeout(
          () => setVisible((v) => [...v, v.length]),
          NOTE_MS
        );
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase("playing"), 300);
      return () => clearTimeout(t);
    }

    // ── playing (highlight each note in sequence) ────────────────────────────
    if (phase === "playing") {
      const total = current.notes.length;
      let step = 0;

      const next = () => {
        if (step < total) {
          setLit(step++);
          setTimeout(next, PLAY_MS);
        } else {
          setLit(null);
          setPhase("holding");
        }
      };
      const t = setTimeout(next, 100);
      return () => clearTimeout(t);
    }

    // ── holding ──────────────────────────────────────────────────────────────
    if (phase === "holding") {
      const t = setTimeout(() => setPhase("fading"), HOLD_MS);
      return () => clearTimeout(t);
    }

    // ── fading ───────────────────────────────────────────────────────────────
    if (phase === "fading") {
      setWrapperOpacity(0);
      const t = setTimeout(() => {
        setScene((s) => (s + 1) % SCENARIOS.length);
        setChars(0);
        setVisible([]);
        setLit(null);
        setWrapperOpacity(1);
        setPhase("typing");
      }, FADE_MS);
      return () => clearTimeout(t);
    }
  }, [phase, chars, visible, scene, current]);

  const displayText = current.prompt.slice(0, chars);

  return (
    <div className="relative w-full max-w-[480px] mx-auto select-none">
      {/* Decorative blurs */}
      <div className="absolute -bottom-8 -right-8 w-52 h-52 bg-[#F55D3E]/10 rounded-full blur-3xl -z-10" />
      <div className="absolute -top-8 -left-8 w-36 h-36 bg-[#F7CB15]/20 rounded-full blur-2xl -z-10" />

      {/* App window card */}
      <div
        className="rounded-2xl overflow-hidden shadow-2xl border border-gray-200 bg-white"
        style={{
          opacity: wrapperOpacity,
          transition: `opacity ${FADE_MS}ms ease`,
        }}
      >
        {/* Browser URL bar */}
        <div className="bg-gray-50 px-3 py-2.5 border-b border-gray-200 flex items-center gap-2">
          {/* Back / forward */}
          <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {/* URL pill */}
          <div className="flex-1 bg-white rounded-md border border-gray-200 px-2.5 py-1 flex items-center gap-1.5">
            <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-xs text-gray-400 tracking-wide">yapscore.ai/editor</span>
          </div>
        </div>

        {/* Score area */}
        <div className="bg-white px-2 pt-5 pb-1">
          <svg
            viewBox="0 0 400 115"
            className="w-full"
            style={{ height: 115 }}
            aria-hidden="true"
          >
            {/* Staff lines */}
            {STAFF_LINES.map((y) => (
              <line
                key={y}
                x1="52" y1={y} x2="390" y2={y}
                stroke="#E5E7EB" strokeWidth="1.5"
              />
            ))}

            {/* Bar line at start */}
            <line x1="52" y1="40" x2="52" y2="80" stroke="#D1D5DB" strokeWidth="1.5" />

            {/* Treble clef (Unicode 𝄞 in serif) */}
            <text
              x="8" y="97"
              fontFamily="Georgia, 'Times New Roman', serif"
              fontSize="78"
              fill="#D1D5DB"
              style={{ userSelect: "none" }}
            >
              𝄞
            </text>

            {/* Notes */}
            {current.notes.map((note, i) => {
              const isVisible = visible.includes(i);
              const isLit     = lit === i;
              const stemUp    = note.y >= MIDDLE_LINE_Y;
              const fill      = isLit ? "#F55D3E" : "#1F2937";

              return (
                <g
                  key={i}
                  style={{
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? "translateY(0)" : "translateY(6px)",
                    transition: "opacity 0.35s ease, transform 0.35s ease",
                    transformOrigin: `${note.x}px ${note.y}px`,
                  }}
                >
                  {/* Ledger line for notes below staff */}
                  {note.ledger && (
                    <line
                      x1={note.x - 11} y1={note.y}
                      x2={note.x + 11} y2={note.y}
                      stroke={fill} strokeWidth="1.5"
                      style={{ transition: "stroke 0.2s" }}
                    />
                  )}

                  {/* Note head */}
                  <ellipse
                    cx={note.x} cy={note.y}
                    rx="6" ry="4.5"
                    fill={fill}
                    style={{ transition: "fill 0.2s" }}
                  />

                  {/* Stem */}
                  {stemUp ? (
                    <line
                      x1={note.x + 5.5} y1={note.y - 3}
                      x2={note.x + 5.5} y2={note.y - 30}
                      stroke={fill} strokeWidth="1.5"
                      style={{ transition: "stroke 0.2s" }}
                    />
                  ) : (
                    <line
                      x1={note.x - 5.5} y1={note.y + 3}
                      x2={note.x - 5.5} y2={note.y + 30}
                      stroke={fill} strokeWidth="1.5"
                      style={{ transition: "stroke 0.2s" }}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Divider */}
        <div className="mx-4 border-t border-gray-100" />

        {/* Chat input row */}
        <div className="p-3">
          <div className="flex items-center gap-2 bg-gray-50 rounded-xl border border-gray-200 px-4 py-2.5">
            <p className="flex-1 text-sm text-gray-700 min-h-[20px] leading-relaxed">
              {displayText}
              {phase === "typing" && (
                <span
                  className="inline-block w-[2px] h-[15px] bg-[#F55D3E] ml-0.5 align-middle rounded-full"
                  style={{ animation: "pulse 1s ease-in-out infinite" }}
                />
              )}
            </p>
            <Link
              href="/editor"
              className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center"
              style={{ background: "#F55D3E" }}
              aria-label="Go to editor"
            >
              <svg
                className="w-3.5 h-3.5 text-white"
                fill="none" viewBox="0 0 24 24"
                stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useRef } from "react";
import { capture } from "@/lib/posthog";
import { setTempo } from "@/lib/music/musicxml";

const FIFTHS_KEYS = ["Cb","Gb","Db","Ab","Eb","Bb","F","C","G","D","A","E","B","F#","C#"];

export default function ScoreInfoBar({ musicXml, onTempoChange }: { musicXml: string; onTempoChange?: (bpm: number) => void }) {
  const instruments = [...musicXml.matchAll(/<part-name>([^<]+)<\/part-name>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .join(", ");

  const fifths = parseInt(musicXml.match(/<fifths>(-?\d+)<\/fifths>/)?.[1] ?? "0");
  const key = FIFTHS_KEYS[fifths + 7] ?? "C";

  const beatsStr = musicXml.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4";
  const beatTypeStr = musicXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4";

  const tempoMatch = musicXml.match(/<sound\b[^>]*tempo="(\d+(?:\.\d+)?)"/);
  const tempoExplicit = tempoMatch ? Math.round(parseFloat(tempoMatch[1])) : null;
  const tempo = tempoExplicit ?? 120;

  // Count measures in first part only
  const firstPart = musicXml.match(/<part\b[^>]*>[\s\S]*?<\/part>/);
  const measureCount = firstPart
    ? (firstPart[0].match(/<measure\b/g) ?? []).length
    : 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tempo);
  const committedRef = useRef(false);

  function startEdit() {
    if (!onTempoChange) return;
    committedRef.current = false;
    setDraft(tempo);
    setEditing(true);
  }

  function commit(value: number) {
    if (committedRef.current) { setEditing(false); return; }
    const bpm = Math.round(value);
    if (bpm >= 20 && bpm <= 300 && bpm !== tempo) {
      committedRef.current = true;
      onTempoChange?.(bpm);
    }
    setEditing(false);
  }

  // Reset editing state when musicXml changes (e.g. after a commit re-render)
  const prevTempoRef = useRef(tempo);
  if (prevTempoRef.current !== tempo) {
    prevTempoRef.current = tempo;
    setDraft(tempo);
    if (editing) setEditing(false);
  }

  const items: Array<{ label: string; dim?: boolean; isTempoSlot?: boolean }> = [];
  if (instruments) items.push({ label: instruments });
  items.push({ label: key });
  items.push({ label: `${beatsStr}/${beatTypeStr}` });
  items.push({ label: `♩ = ${tempo}`, dim: !tempoExplicit, isTempoSlot: true });
  items.push({ label: `${measureCount} bars` });

  return (
    <div className="flex items-center gap-3 text-[11px] text-brand-secondary">
      {items.map((item, i) => (
        <span key={i} className={`flex items-center gap-3${item.dim ? " opacity-40" : ""}`}>
          {i > 0 && <span className="text-gray-300">·</span>}
          {item.isTempoSlot && onTempoChange ? (
            editing ? (
              <span className="flex items-center gap-2">
                <span className="shrink-0">♩ =</span>
                <input
                  type="range"
                  min={20}
                  max={300}
                  step={1}
                  value={draft}
                  onChange={(e) => setDraft(Number(e.target.value))}
                  onMouseUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
                  onTouchEnd={(e) => commit(Number((e.target as HTMLInputElement).value))}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditing(false);
                    if (e.key === "Enter") commit(draft);
                  }}
                  onBlur={() => commit(draft)}
                  className="w-24 accent-brand-primary cursor-pointer"
                />
                <span className="tabular-nums text-gray-900 w-7 shrink-0">{draft}</span>
              </span>
            ) : (
              <button
                onClick={startEdit}
                title="Click to change tempo"
                className="hover:text-gray-900 hover:underline decoration-dotted underline-offset-2 transition cursor-pointer"
              >
                {item.label}
              </button>
            )
          ) : (
            item.label
          )}
        </span>
      ))}
    </div>
  );
}

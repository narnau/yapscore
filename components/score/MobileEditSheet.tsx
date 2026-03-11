import React from "react";
import type { NotePosition } from "@/lib/music/musicxml";
import { changeNotePitch, changeNoteDuration, deleteNote, pasteMeasures, duplicateMeasures, deleteMeasures } from "@/lib/music/musicxml";
import NoteSymbol from "./NoteSymbol";

export default function MobileEditSheet({
  selectedNoteIndex, noteMapRef, selectedMeasures, copiedMeasures,
  musicXml, onMusicXmlChange, onClearMeasureSelection,
  setSelectedNoteIndex, setCopiedMeasures,
}: {
  selectedNoteIndex: number | null;
  noteMapRef: React.RefObject<NotePosition[]>;
  selectedMeasures: Set<number>;
  copiedMeasures: Set<number>;
  musicXml: string | null;
  onMusicXmlChange?: (xml: string, label: string) => void;
  onClearMeasureSelection?: () => void;
  setSelectedNoteIndex: (i: number | null) => void;
  setCopiedMeasures: (s: Set<number>) => void;
}) {
  const isOpen = (selectedNoteIndex !== null || selectedMeasures.size > 0) && !!onMusicXmlChange;
  const note = selectedNoteIndex !== null ? noteMapRef.current[selectedNoteIndex] : null;

  function dismiss() {
    setSelectedNoteIndex(null);
    onClearMeasureSelection?.();
  }

  return (
    <div
      className={`md:hidden fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 ease-out ${
        isOpen ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="bg-white rounded-t-2xl shadow-2xl border-t border-gray-200">
        {/* Handle + dismiss */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="w-8" />
          <div className="w-10 h-1 rounded-full bg-gray-300" />
          <button onClick={dismiss} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 transition">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Note editing */}
        {selectedNoteIndex !== null && note && (
          <div className="px-4 pb-8 space-y-3">
            <p className="text-xs font-medium text-gray-400 text-center uppercase tracking-wide">
              {note.isRest ? "Rest" : note.isDrum ? "Drum" : "Note"}
            </p>

            {/* Pitch row — pitched notes only (not rests, not drum notes) */}
            {!note.isRest && !note.isDrum && (
              <div className="grid grid-cols-4 gap-2">
                {([
                  { label: "↓ 8va", delta: -12, title: "Octave down" },
                  { label: "↓", delta: -1, title: "Semitone down" },
                  { label: "↑", delta: 1, title: "Semitone up" },
                  { label: "↑ 8va", delta: 12, title: "Octave up" },
                ] as const).map(({ label, delta, title }) => (
                  <button
                    key={label}
                    onClick={() => { if (musicXml) onMusicXmlChange!(changeNotePitch(musicXml, note, delta), title); }}
                    className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-sm font-medium text-gray-700 transition active:scale-95"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Duration row */}
            <div className="grid grid-cols-7 gap-1.5">
              {([1, 2, 3, 4, 5, 6, 7] as const).map((dur) => (
                <button
                  key={dur}
                  onClick={() => { if (musicXml) onMusicXmlChange!(changeNoteDuration(musicXml, note, String(dur) as "1"|"2"|"3"|"4"|"5"|"6"|"7"), "Change duration"); }}
                  title={["64th","32nd","16th","Eighth","Quarter","Half","Whole"][dur - 1]}
                  className="flex items-center justify-center py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-gray-700 transition active:scale-95"
                >
                  <NoteSymbol dur={dur} />
                </button>
              ))}
            </div>

            {/* Delete */}
            <button
              onClick={() => { if (musicXml) { onMusicXmlChange!(deleteNote(musicXml, note), "Delete note"); setSelectedNoteIndex(null); } }}
              className="w-full py-3 rounded-xl bg-red-50 active:bg-red-100 text-red-600 text-sm font-medium transition active:scale-95"
            >
              ✕ Delete note
            </button>
          </div>
        )}

        {/* Measure editing */}
        {selectedMeasures.size > 0 && (
          <div className="px-4 pb-8 space-y-3">
            <p className="text-xs font-medium text-gray-400 text-center uppercase tracking-wide">
              {selectedMeasures.size} measure{selectedMeasures.size > 1 ? "s" : ""} selected
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setCopiedMeasures(new Set(selectedMeasures))}
                className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-sm font-medium text-gray-700 transition active:scale-95"
              >
                Copy
              </button>
              <button
                disabled={copiedMeasures.size === 0}
                onClick={() => { if (musicXml && copiedMeasures.size > 0) onMusicXmlChange!(pasteMeasures(musicXml, [...copiedMeasures], Math.min(...selectedMeasures)), "Paste measures"); }}
                className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 disabled:opacity-30 text-sm font-medium text-gray-700 transition active:scale-95"
              >
                Paste
              </button>
              <button
                onClick={() => { if (musicXml) onMusicXmlChange!(duplicateMeasures(musicXml, [...selectedMeasures].sort((a, b) => a - b)), "Duplicate measures"); }}
                className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-sm font-medium text-gray-700 transition active:scale-95"
              >
                Duplicate
              </button>
              <button
                onClick={() => { if (musicXml) { onMusicXmlChange!(deleteMeasures(musicXml, [...selectedMeasures]), "Delete measures"); onClearMeasureSelection?.(); } }}
                className="py-3 rounded-xl bg-red-50 active:bg-red-100 text-red-600 text-sm font-medium transition active:scale-95"
              >
                ✕ Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

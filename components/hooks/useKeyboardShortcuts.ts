import { useEffect } from "react";
import type { NotePosition } from "@/lib/music/musicxml";
import { changeNotePitch, deleteNote, changeNoteDuration, duplicateMeasures, pasteMeasures, deleteMeasures } from "@/lib/music/musicxml";

type StateRef = {
  musicXml: string | null;
  onMusicXmlChange?: (xml: string, label: string) => void;
  selectedMeasures: Set<number>;
  copiedMeasures: Set<number>;
  onClearMeasureSelection?: () => void;
};

export function useKeyboardShortcuts(
  stateRef: React.RefObject<StateRef>,
  selectedNoteIndexRef: React.RefObject<number | null>,
  noteMapRef: React.RefObject<NotePosition[]>,
  setSelectedNoteIndex: (i: number | null) => void,
  setCopiedMeasures: (s: Set<number>) => void,
) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const { musicXml: xml, onMusicXmlChange: onChange, selectedMeasures: measures, copiedMeasures: copied } = stateRef.current;
      const idx = selectedNoteIndexRef.current;

      // ── Note actions ──
      if (idx !== null && xml) {
        const position = noteMapRef.current[idx];
        if (position) {
          if (!position.isRest && !position.isDrum && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            const semitones = (e.key === "ArrowUp" ? 1 : -1) * (ctrl ? 12 : 1);
            onChange?.(changeNotePitch(xml, position, semitones),
              ctrl ? (e.key === "ArrowUp" ? "Octave up" : "Octave down")
                   : (e.key === "ArrowUp" ? "Move note up" : "Move note down"));
            return;
          }
          if (!ctrl && (e.key === "Delete" || e.key === "Backspace")) {
            e.preventDefault();
            onChange?.(deleteNote(xml, position), "Delete note");
            setSelectedNoteIndex(null);
            return;
          }
          if (!ctrl && /^[1-7]$/.test(e.key)) {
            e.preventDefault();
            onChange?.(changeNoteDuration(xml, position, e.key as "1"|"2"|"3"|"4"|"5"|"6"|"7"), "Change duration");
            return;
          }
        }
      }

      // ── Measure actions ──
      if (ctrl && xml) {
        if (e.key === "c" && measures.size > 0) {
          e.preventDefault();
          setCopiedMeasures(new Set(measures));
        } else if (e.key === "v" && copied.size > 0 && measures.size > 0) {
          e.preventDefault();
          onChange?.(pasteMeasures(xml, [...copied], Math.min(...measures)), "Paste measures");
        } else if (e.key === "d" && measures.size > 0) {
          e.preventDefault();
          onChange?.(duplicateMeasures(xml, [...measures].sort((a, b) => a - b)), "Duplicate measures");
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // stable — all mutable values accessed via refs
}

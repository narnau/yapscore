import React from "react";
import type { NotePosition } from "@/lib/music/musicxml";
import { changeNoteDuration } from "@/lib/music/musicxml";
import NoteSymbol from "./NoteSymbol";
import ToolBtn from "./ToolBtn";

type Props = {
  selectedNoteIndex: number;
  noteMapRef: React.RefObject<NotePosition[]>;
  musicXml: string;
  onMusicXmlChange: (xml: string, label: string) => void;
  /** "desktop" renders compact ToolBtn; "mobile" renders full-width grid buttons */
  variant?: "desktop" | "mobile";
};

const DURATION_LABELS = ["64th", "32nd", "16th", "Eighth", "Quarter", "Half", "Whole"];

export default function DurationControls({
  selectedNoteIndex,
  noteMapRef,
  musicXml,
  onMusicXmlChange,
  variant = "desktop",
}: Props) {
  if (variant === "mobile") {
    const note = noteMapRef.current[selectedNoteIndex];
    if (!note) return null;

    return (
      <div className="grid grid-cols-7 gap-1.5">
        {([1, 2, 3, 4, 5, 6, 7] as const).map((dur) => (
          <button
            key={dur}
            onClick={() => {
              console.log("[score] Duration change", {
                noteIndex: selectedNoteIndex,
                position: note,
                targetDuration: dur,
              });
              onMusicXmlChange(
                changeNoteDuration(musicXml, note, String(dur) as "1" | "2" | "3" | "4" | "5" | "6" | "7"),
                "Change duration",
              );
            }}
            title={DURATION_LABELS[dur - 1]}
            className="flex items-center justify-center py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-gray-700 transition active:scale-95"
          >
            <NoteSymbol dur={dur} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      {([1, 2, 3, 4, 5, 6, 7] as const).map((dur) => (
        <ToolBtn
          key={dur}
          onClick={() => {
            const p = noteMapRef.current[selectedNoteIndex];
            if (p && musicXml) {
              console.log("[score] Duration change", {
                noteIndex: selectedNoteIndex,
                position: p,
                targetDuration: dur,
              });
              onMusicXmlChange(
                changeNoteDuration(musicXml, p, String(dur) as "1" | "2" | "3" | "4" | "5" | "6" | "7"),
                "Change duration",
              );
            }
          }}
          title={DURATION_LABELS[dur - 1]}
        >
          <NoteSymbol dur={dur} />
        </ToolBtn>
      ))}
    </>
  );
}

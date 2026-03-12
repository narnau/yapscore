import React from "react";
import type { NotePosition } from "@/lib/music/musicxml";
import { changeNotePitch } from "@/lib/music/musicxml";
import ToolBtn from "./ToolBtn";

type Props = {
  selectedNoteIndex: number;
  noteMapRef: React.RefObject<NotePosition[]>;
  musicXml: string;
  onMusicXmlChange: (xml: string, label: string) => void;
  /** "desktop" renders compact ToolBtn; "mobile" renders full-width grid buttons */
  variant?: "desktop" | "mobile";
};

const PITCH_ACTIONS = [
  { label: "\u2193 8va", delta: -12, title: "Octave down (Ctrl+\u2193)" },
  { label: "\u2193", delta: -1, title: "Semitone down (\u2193)" },
  { label: "\u2191", delta: 1, title: "Semitone up (\u2191)" },
  { label: "\u2191 8va", delta: 12, title: "Octave up (Ctrl+\u2191)" },
] as const;

export default function PitchControls({
  selectedNoteIndex,
  noteMapRef,
  musicXml,
  onMusicXmlChange,
  variant = "desktop",
}: Props) {
  const note = noteMapRef.current[selectedNoteIndex];
  if (!note || note.isRest || note.isDrum) return null;

  if (variant === "mobile") {
    return (
      <div className="grid grid-cols-4 gap-2">
        {PITCH_ACTIONS.map(({ label, delta, title }) => (
          <button
            key={label}
            onClick={() => onMusicXmlChange(changeNotePitch(musicXml, note, delta), title)}
            className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-sm font-medium text-gray-700 transition active:scale-95"
          >
            {label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      {PITCH_ACTIONS.map(({ label, delta, title }) => (
        <ToolBtn
          key={label}
          onClick={() => {
            const p = noteMapRef.current[selectedNoteIndex];
            if (p && musicXml) onMusicXmlChange(changeNotePitch(musicXml, p, delta), title);
          }}
          title={title}
        >
          {label}
        </ToolBtn>
      ))}
    </>
  );
}

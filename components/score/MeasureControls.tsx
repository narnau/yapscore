import React from "react";
import { pasteMeasures, duplicateMeasures, deleteMeasures } from "@/lib/music/musicxml";
import ToolBtn from "./ToolBtn";

type Props = {
  selectedMeasures: Set<number>;
  copiedMeasures: Set<number>;
  musicXml: string;
  onMusicXmlChange: (xml: string, label: string) => void;
  onClearMeasureSelection?: () => void;
  setCopiedMeasures: (s: Set<number>) => void;
  /** "desktop" renders compact ToolBtn; "mobile" renders full-width grid buttons */
  variant?: "desktop" | "mobile";
};

export default function MeasureControls({
  selectedMeasures,
  copiedMeasures,
  musicXml,
  onMusicXmlChange,
  onClearMeasureSelection,
  setCopiedMeasures,
  variant = "desktop",
}: Props) {
  if (selectedMeasures.size === 0) return null;

  if (variant === "mobile") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setCopiedMeasures(new Set(selectedMeasures))}
          className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-sm font-medium text-gray-700 transition active:scale-95"
        >
          Copy
        </button>
        <button
          disabled={copiedMeasures.size === 0}
          onClick={() => {
            if (copiedMeasures.size > 0)
              onMusicXmlChange(
                pasteMeasures(musicXml, [...copiedMeasures], Math.min(...selectedMeasures)),
                "Paste measures",
              );
          }}
          className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 disabled:opacity-30 text-sm font-medium text-gray-700 transition active:scale-95"
        >
          Paste
        </button>
        <button
          onClick={() =>
            onMusicXmlChange(
              duplicateMeasures(
                musicXml,
                [...selectedMeasures].sort((a, b) => a - b),
              ),
              "Duplicate measures",
            )
          }
          className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-sm font-medium text-gray-700 transition active:scale-95"
        >
          Duplicate
        </button>
        <button
          onClick={() => {
            onMusicXmlChange(deleteMeasures(musicXml, [...selectedMeasures]), "Delete measures");
            onClearMeasureSelection?.();
          }}
          className="py-3 rounded-xl bg-red-50 active:bg-red-100 text-red-600 text-sm font-medium transition active:scale-95"
        >
          ✕ Delete
        </button>
      </div>
    );
  }

  return (
    <>
      <span className="text-[10px] text-gray-400 mr-0.5 shrink-0">
        {selectedMeasures.size} measure{selectedMeasures.size > 1 ? "s" : ""}:
      </span>
      <ToolBtn onClick={() => setCopiedMeasures(new Set(selectedMeasures))} title="Copy (Ctrl+C)">
        Copy
      </ToolBtn>
      <ToolBtn
        disabled={copiedMeasures.size === 0}
        onClick={() => {
          if (copiedMeasures.size > 0)
            onMusicXmlChange(
              pasteMeasures(musicXml, [...copiedMeasures], Math.min(...selectedMeasures)),
              "Paste measures",
            );
        }}
        title="Paste (Ctrl+V)"
      >
        Paste
      </ToolBtn>
      <ToolBtn
        onClick={() =>
          onMusicXmlChange(
            duplicateMeasures(
              musicXml,
              [...selectedMeasures].sort((a, b) => a - b),
            ),
            "Duplicate measures",
          )
        }
        title="Duplicate (Ctrl+D)"
      >
        Duplicate
      </ToolBtn>
      <ToolBtn
        danger
        onClick={() => {
          onMusicXmlChange(deleteMeasures(musicXml, [...selectedMeasures]), "Delete measures");
          onClearMeasureSelection?.();
        }}
        title="Delete measures"
      >
        ✕ Delete
      </ToolBtn>
    </>
  );
}

import {
  mxlParse,
  mxlSerialize,
  generateId,
  findPart,
  findMeasure,
  measureNum,
  getDivisions,
  getBeatType,
  type HarmonyEntry,
} from "./musicxml-core";
import type { Score } from "musicxml-io";

// ─── ChordSymbol type ───────────────────────────────────────────────────────

export type ChordSymbol = {
  root: string;
  kind: string;
  beat?: number;
  bass?: string;
};

// ─── Chord kind mapping ─────────────────────────────────────────────────────

const CHORD_KIND_MAP: Record<string, { xml: string; text: string }> = {
  "": { xml: "major", text: "" },
  M: { xml: "major", text: "" },
  major: { xml: "major", text: "" },
  m: { xml: "minor", text: "m" },
  minor: { xml: "minor", text: "m" },
  "7": { xml: "dominant", text: "7" },
  maj7: { xml: "major-seventh", text: "maj7" },
  M7: { xml: "major-seventh", text: "maj7" },
  m7: { xml: "minor-seventh", text: "m7" },
  dim: { xml: "diminished", text: "dim" },
  dim7: { xml: "diminished-seventh", text: "dim7" },
  aug: { xml: "augmented", text: "aug" },
  m7b5: { xml: "half-diminished", text: "m7b5" },
  sus2: { xml: "suspended-second", text: "sus2" },
  sus4: { xml: "suspended-fourth", text: "sus4" },
};

// ─── addChordSymbols ────────────────────────────────────────────────────────

export function addChordSymbols(
  musicXml: string,
  measureNumber: number,
  chords: ChordSymbol[],
  partId: string = "P1",
): { xml: string; error?: string } {
  const score = mxlParse(musicXml);
  const divisions = getDivisions(score);
  const beatType = getBeatType(score);
  const beatTicks = Math.round(divisions * (4 / beatType));

  const part = findPart(score, partId);
  if (!part) return { xml: musicXml, error: `Part '${partId}' not found` };

  const totalMeasures = part.measures.length;
  const measure = findMeasure(part, measureNumber);
  if (!measure)
    return {
      xml: musicXml,
      error: `Measure ${measureNumber} does not exist (score has ${totalMeasures} measures). Call insertEmptyMeasures first to add more measures.`,
    };

  // Remove any existing chord symbols in this measure before inserting new ones
  measure.entries = measure.entries.filter((e) => e.type !== "harmony");

  const firstNoteIdx = measure.entries.findIndex((e) => e.type === "note");

  for (const chord of chords) {
    const rootStep = chord.root.replace(/[b#]/, "");
    const rootAlter = chord.root.includes("#") ? 1 : chord.root.includes("b") ? -1 : undefined;
    const kindInfo = CHORD_KIND_MAP[chord.kind] ?? { xml: chord.kind, text: chord.kind };
    const offset = Math.round(((chord.beat ?? 1) - 1) * beatTicks);

    const harmony: HarmonyEntry = {
      _id: generateId(),
      type: "harmony",
      root: { rootStep, ...(rootAlter != null ? { rootAlter } : {}) },
      kind: kindInfo.xml,
      kindText: kindInfo.text,
      ...(chord.bass ? { bass: { bassStep: chord.bass.replace(/[b#]/, "") } } : {}),
      ...(offset > 0 ? { offset } : {}),
    };

    if (firstNoteIdx !== -1) {
      measure.entries.splice(firstNoteIdx, 0, harmony);
    } else {
      measure.entries.push(harmony);
    }
  }
  return { xml: mxlSerialize(score) };
}

// ─── extractChordMap ────────────────────────────────────────────────────────

/** Reverse map: MusicXML kind string → display text (e.g. "dominant" → "7") */
const XML_KIND_TO_TEXT: Record<string, string> = Object.fromEntries(
  Object.entries(CHORD_KIND_MAP)
    .filter(([k]) => !["M", "major", "minor"].includes(k)) // keep canonical keys only
    .map(([, v]) => [v.xml, v.text]),
);

/**
 * Extracts chord symbols from the score and returns a compact string the LLM
 * can use as a reference when composing.
 * Example: "m1: C7 | m2: C7 | m5: F7 | m9: G7"
 * Returns "" if no chords are found.
 */
export function extractChordMap(musicXml: string): string {
  try {
    const score = mxlParse(musicXml);
    const part = score.parts[0];
    if (!part) return "";

    const entries: string[] = [];

    for (let i = 0; i < part.measures.length; i++) {
      const measure = part.measures[i];
      const harmonies = measure.entries.filter((e): e is HarmonyEntry => e.type === "harmony");
      if (harmonies.length === 0) continue;

      const chordStrs = harmonies.map((h) => {
        let root = h.root.rootStep;
        if (h.root.rootAlter === 1) root += "#";
        else if (h.root.rootAlter === -1) root += "b";
        const kindText = h.kindText ?? XML_KIND_TO_TEXT[h.kind] ?? h.kind;
        const bass = h.bass ? `/${h.bass.bassStep}` : "";
        return `${root}${kindText}${bass}`;
      });

      entries.push(`m${i + 1}: ${chordStrs.join(" ")}`);
    }

    return entries.length > 0 ? entries.join(" | ") : "";
  } catch {
    return "";
  }
}

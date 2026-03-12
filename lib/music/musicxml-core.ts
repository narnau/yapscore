import { parse as mxlParse, serialize as mxlSerialize, generateId } from "musicxml-io";
import { DEFAULT_DIVISIONS, DEFAULT_BEATS, DEFAULT_BEAT_TYPE, SEMITONES_PER_OCTAVE } from "./constants";
import type {
  Score,
  Part,
  Measure,
  MeasureEntry,
  NoteEntry,
  Pitch,
  MeasureAttributes,
  PartInfo,
  ScoreMetadata,
} from "musicxml-io";

// ─── Local type aliases ─────────────────────────────────────────────────────

// SoundEntry is not re-exported by musicxml-io, define locally
export type SoundEntry = Extract<MeasureEntry, { type: "sound" }>;
export type HarmonyEntry = Extract<MeasureEntry, { type: "harmony" }>;
export type ArticulationNotation = Extract<import("musicxml-io").Notation, { type: "articulation" }>;

// ─── Score model helpers ────────────────────────────────────────────────────

export function findPart(score: Score, partId: string): Part | undefined {
  return score.parts.find((p) => p.id === partId);
}

export function findPartInfo(score: Score, partId: string): PartInfo | undefined {
  return score.partList.find((e): e is PartInfo => e.type === "score-part" && e.id === partId);
}

export function measureNum(m: Measure): number {
  return parseInt(m.number) || 0;
}

export function findMeasure(part: Part, num: number): Measure | undefined {
  return part.measures.find((m) => measureNum(m) === num);
}

export function getDivisions(score: Score): number {
  for (const p of score.parts) {
    for (const m of p.measures) {
      if (m.attributes?.divisions) return m.attributes.divisions;
    }
  }
  return DEFAULT_DIVISIONS;
}

export function getBeats(score: Score): number {
  for (const p of score.parts) {
    for (const m of p.measures) {
      if (m.attributes?.time) return parseInt(m.attributes.time.beats) || DEFAULT_BEATS;
    }
  }
  return DEFAULT_BEATS;
}

export function getBeatType(score: Score): number {
  for (const p of score.parts) {
    for (const m of p.measures) {
      if (m.attributes?.time) return m.attributes.time.beatType || DEFAULT_BEAT_TYPE;
    }
  }
  return DEFAULT_BEAT_TYPE;
}

export function getFifths(score: Score): number {
  for (const p of score.parts) {
    for (const m of p.measures) {
      if (m.attributes?.key) return m.attributes.key.fifths;
    }
  }
  return 0;
}

const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

export function stepAlteredByKey(step: string, fifths: number): boolean {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(step);
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(step);
  return false;
}

export function notes(entries: MeasureEntry[]): NoteEntry[] {
  return entries.filter((e): e is NoteEntry => e.type === "note");
}

export function wholeRest(duration: number, staff?: number, voice?: number): NoteEntry {
  return {
    _id: generateId(),
    type: "note",
    rest: { measure: true },
    duration,
    noteType: "whole",
    ...(voice != null ? { voice: String(voice) } : {}),
    ...(staff != null ? { staff } : {}),
  };
}

export function measureDuration(score: Score): number {
  const divisions = getDivisions(score);
  const beats = getBeats(score);
  const beatType = getBeatType(score);
  return Math.round(divisions * beats * (4 / beatType));
}

export function emptyMeasure(num: number, duration: number): Measure {
  return {
    _id: generateId(),
    number: String(num),
    entries: [wholeRest(duration)],
  };
}

// ─── Pitch transposition helpers ────────────────────────────────────────────

const NOTES: [string, number][] = [
  ["C", 0],
  ["C", 1],
  ["D", 0],
  ["D", 1],
  ["E", 0],
  ["F", 0],
  ["F", 1],
  ["G", 0],
  ["G", 1],
  ["A", 0],
  ["A", 1],
  ["B", 0],
];

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function transposePitch(
  step: string,
  alter: number,
  octave: number,
  semitones: number,
): { step: string; alter: number; octave: number } {
  const baseSemitone = (NOTE_TO_SEMITONE[step] ?? 0) + alter;
  let totalSemitone = baseSemitone + semitones;
  let newOctave = octave;

  while (totalSemitone >= SEMITONES_PER_OCTAVE) {
    totalSemitone -= SEMITONES_PER_OCTAVE;
    newOctave++;
  }
  while (totalSemitone < 0) {
    totalSemitone += SEMITONES_PER_OCTAVE;
    newOctave--;
  }

  const [newStep, newAlter] = NOTES[totalSemitone];
  return { step: newStep, alter: newAlter, octave: newOctave };
}

// ─── Math helpers ───────────────────────────────────────────────────────────

export function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
export function lcmInt(a: number, b: number): number {
  return Math.round((a / gcd(a, b)) * b);
}

// ─── extractParts / reconstructMusicXml ─────────────────────────────────────
// These stay string-based because they manage skeleton/placeholder for LLM.

export function extractParts(musicXml: string): {
  skeleton: string;
  parts: string;
  context: string;
} {
  const firstPart = musicXml.indexOf("<part ");
  const lastPartEnd = musicXml.lastIndexOf("</part>") + "</part>".length;
  if (firstPart === -1) throw new Error("No <part> elements found in MusicXML");

  const skeleton = musicXml.slice(0, firstPart) + "__PARTS__" + musicXml.slice(lastPartEnd);
  const parts = musicXml.slice(firstPart, lastPartEnd);
  return { skeleton, parts, context: buildContext(musicXml) };
}

export function reconstructMusicXml(skeleton: string, modifiedParts: string): string {
  let parts = modifiedParts.trim();
  parts = parts.replace(/^<\?xml[^?]*\?>\s*/i, "");

  if (/<score-partwise/i.test(parts) || /<!DOCTYPE/i.test(parts)) {
    const fp = parts.indexOf("<part ");
    const lp = parts.lastIndexOf("</part>") + "</part>".length;
    if (fp !== -1) parts = parts.slice(fp, lp);
  }

  let result = skeleton.replace("__PARTS__", parts);

  // Sync <part-list>: ensure every <part id="X"> has a matching <score-part id="X">
  try {
    const score = mxlParse(result);
    const knownIds = new Set(score.partList.filter((e): e is PartInfo => e.type === "score-part").map((sp) => sp.id));
    let changed = false;
    for (const p of score.parts) {
      if (!knownIds.has(p.id)) {
        score.partList.push({
          _id: generateId(),
          type: "score-part",
          id: p.id,
          name: `Part ${p.id}`,
        });
        knownIds.add(p.id);
        changed = true;
      }
    }
    if (changed) result = mxlSerialize(score);
  } catch {
    /* best-effort */
  }

  return result;
}

export function extractSelectedMeasures(
  musicXml: string,
  measureNumbers: number[],
): { skeleton: string; selectedMeasures: string; context: string } {
  const { skeleton, parts, context } = extractParts(musicXml);
  const nums = new Set(measureNumbers);

  // Parse just the parts to extract selected measures
  const score = mxlParse(musicXml);
  const partBlocks: string[] = [];
  for (const part of score.parts) {
    const selected: string[] = [];
    for (const m of part.measures) {
      if (nums.has(measureNum(m))) {
        // Serialize this single measure by wrapping in a temp score
        const tempScore: Score = {
          _id: generateId(),
          metadata: {},
          partList: [],
          parts: [{ _id: generateId(), id: part.id, measures: [m] }],
          version: "3.1",
        };
        const xml = mxlSerialize(tempScore);
        // Extract just the <measure> element from the temp output
        const mStart = xml.indexOf("<measure");
        const mEnd = xml.lastIndexOf("</measure>") + "</measure>".length;
        if (mStart !== -1) selected.push(xml.slice(mStart, mEnd));
      }
    }
    if (selected.length > 0) {
      partBlocks.push(`<part id="${part.id}">\n${selected.join("\n")}\n</part>`);
    }
  }

  return { skeleton, selectedMeasures: partBlocks.join("\n"), context };
}

// ─── spliceMeasuresBack ─────────────────────────────────────────────────────
// Kept string-based because it splices raw LLM text into existing XML.

export function spliceMeasuresBack(
  musicXml: string,
  modifiedMeasuresXml: string,
  sentMeasureNumbers?: number[],
): string {
  const hasPartWrappers = /<part[\s>]/.test(modifiedMeasuresXml);
  if (hasPartWrappers) {
    return spliceMeasuresBackPerPart(musicXml, modifiedMeasuresXml, sentMeasureNumbers);
  }
  return spliceMeasuresBackGlobal(musicXml, modifiedMeasuresXml, sentMeasureNumbers);
}

export function spliceMeasuresBackPerPart(
  musicXml: string,
  modifiedMeasuresXml: string,
  sentMeasureNumbers?: number[],
): string {
  // Parse modified measures to extract per-part map
  let modScore: Score;
  try {
    modScore = mxlParse(modifiedMeasuresXml);
  } catch {
    // Might be a partial XML — wrap it
    modScore = mxlParse(
      `<?xml version="1.0"?><score-partwise version="3.1"><part-list></part-list>${modifiedMeasuresXml}</score-partwise>`,
    );
  }

  const perPartMap = new Map<string, Map<number, Measure>>();
  for (const part of modScore.parts) {
    const mm = new Map<number, Measure>();
    for (const m of part.measures) mm.set(measureNum(m), m);
    perPartMap.set(part.id, mm);
  }

  const deletedPerPart = new Map<string, Set<number>>();
  if (sentMeasureNumbers) {
    for (const [partId, mm] of perPartMap) {
      const deleted = new Set<number>();
      for (const num of sentMeasureNumbers) {
        if (!mm.has(num)) deleted.add(num);
      }
      if (deleted.size > 0) deletedPerPart.set(partId, deleted);
    }
  }

  const score = mxlParse(musicXml);
  let anyDeleted = false;

  for (const part of score.parts) {
    const mm = perPartMap.get(part.id);
    if (!mm) continue;
    const deleted = deletedPerPart.get(part.id) ?? new Set<number>();
    if (deleted.size > 0) anyDeleted = true;

    part.measures = part.measures
      .filter((m) => !deleted.has(measureNum(m)))
      .map((m) => {
        const replacement = mm.get(measureNum(m));
        return replacement ?? m;
      });
  }

  let result = mxlSerialize(score);
  if (anyDeleted) result = renumberMeasures(result);
  return result;
}

export function spliceMeasuresBackGlobal(
  musicXml: string,
  modifiedMeasuresXml: string,
  sentMeasureNumbers?: number[],
): string {
  // Parse modified measures (wrapped in a temp structure)
  let modScore: Score;
  try {
    modScore = mxlParse(
      `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name/></score-part></part-list><part id="P1">${modifiedMeasuresXml}</part></score-partwise>`,
    );
  } catch {
    return musicXml; // Can't parse modified measures
  }

  const modifiedMap = new Map<number, Measure>();
  for (const p of modScore.parts) {
    for (const m of p.measures) modifiedMap.set(measureNum(m), m);
  }

  const deletedNumbers = new Set<number>();
  if (sentMeasureNumbers) {
    for (const num of sentMeasureNumbers) {
      if (!modifiedMap.has(num)) deletedNumbers.add(num);
    }
  }

  const score = mxlParse(musicXml);
  for (const part of score.parts) {
    part.measures = part.measures
      .filter((m) => !deletedNumbers.has(measureNum(m)))
      .map((m) => {
        const replacement = modifiedMap.get(measureNum(m));
        return replacement ?? m;
      });
  }

  let result = mxlSerialize(score);
  if (deletedNumbers.size > 0) result = renumberMeasures(result);
  return result;
}

// ─── renumberMeasures ───────────────────────────────────────────────────────

export function renumberMeasures(musicXml: string): string {
  const score = mxlParse(musicXml);
  for (const part of score.parts) {
    let counter = 0;
    for (const m of part.measures) {
      counter++;
      m.number = String(counter);
    }
  }
  return mxlSerialize(score);
}

// ─── buildContext / fifthsToKey ──────────────────────────────────────────────

export function buildContext(musicXml: string): string {
  const score = mxlParse(musicXml);
  const instruments = score.partList
    .filter((e): e is PartInfo => e.type === "score-part")
    .map((pi) => pi.name?.trim())
    .filter(Boolean)
    .join(", ");

  const fifths = getFifths(score);
  const key = fifthsToKey(fifths);
  const beats = getBeats(score);
  const beatType = getBeatType(score);

  const first = score.parts[0];
  const measureCount = first ? first.measures.length : 0;

  const tempo = getTempoFromScore(score);
  const tempoStr = tempo ? ` | Tempo: ${tempo.bpm} BPM` : "";

  return `Instruments: ${instruments || "unknown"} | Key: ${key} | Time: ${beats}/${beatType} | Measures: ${measureCount}${tempoStr}`;
}

export function fifthsToKey(fifths: number): string {
  const keys = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
  return (keys[fifths + 7] ?? "C") + " major";
}

// Internal helper used by buildContext — avoids re-parsing XML
function getTempoFromScore(score: Score): { bpm: number; beatUnit: string } | null {
  for (const part of score.parts) {
    for (const m of part.measures) {
      for (const entry of m.entries) {
        if (entry.type === "direction") {
          const dir = entry as import("musicxml-io").DirectionEntry;
          if (dir.sound?.tempo) {
            const met = dir.directionTypes.find((dt) => dt.kind === "metronome");
            return {
              bpm: dir.sound.tempo,
              beatUnit: (met && met.kind === "metronome" ? met.beatUnit : "quarter") ?? "quarter",
            };
          }
        }
      }
    }
  }
  return null;
}

// ─── Instrument helpers ─────────────────────────────────────────────────────

export const GRAND_STAFF_INSTRUMENTS = new Set([
  "piano",
  "keyboard",
  "organ",
  "harpsichord",
  "marimba",
  "vibraphone",
  "celesta",
  "harp",
  "accordion",
]);

export function instrumentStaves(name: string): number {
  return GRAND_STAFF_INSTRUMENTS.has(name.toLowerCase()) ? 2 : 1;
}

export function clefToSignLine(clef: string): { sign: "G" | "F" | "C"; line: number } {
  if (clef === "bass") return { sign: "F", line: 4 };
  if (clef === "alto") return { sign: "C", line: 3 };
  if (clef === "tenor") return { sign: "C", line: 4 };
  return { sign: "G", line: 2 };
}

export function isPercussionPart(score: Score, partId: string): boolean {
  const part = findPart(score, partId);
  if (!part) return false;
  const clef = part.measures[0]?.attributes?.clef?.[0];
  return clef?.sign === "percussion";
}

// ─── Key helpers ────────────────────────────────────────────────────────────

export const KEY_ROOT_TO_FIFTHS: Record<string, number> = {
  Cb: -7,
  Gb: -6,
  Db: -5,
  Ab: -4,
  Eb: -3,
  Bb: -2,
  F: -1,
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  "F#": 6,
  "C#": 7,
};

export function fifthsToSemitones(oldFifths: number, newFifths: number): number {
  let semitones = ((newFifths - oldFifths) * 7) % SEMITONES_PER_OCTAVE;
  if (semitones > 6) semitones -= SEMITONES_PER_OCTAVE;
  if (semitones < -6) semitones += SEMITONES_PER_OCTAVE;
  return semitones;
}

// ─── Tempo direction builder ────────────────────────────────────────────────

export function buildTempoDirection(
  bpm: number,
  beatUnit: import("musicxml-io").NoteType,
): import("musicxml-io").DirectionEntry {
  return {
    _id: generateId(),
    type: "direction",
    placement: "above",
    directionTypes: [
      {
        kind: "metronome",
        beatUnit,
        perMinute: bpm,
      },
    ],
    sound: { tempo: bpm },
  };
}

// ─── MIDI channel helpers ───────────────────────────────────────────────────

import { PERCUSSION_MIDI_CHANNEL } from "./constants";

export function nextMidiChannel(score: Score): number {
  const used = new Set<number>();
  for (const entry of score.partList) {
    if (entry.type === "score-part" && entry.midiInstruments) {
      for (const mi of entry.midiInstruments) {
        if (mi.channel) used.add(mi.channel);
      }
    }
  }
  for (let ch = 1; ch <= 16; ch++) {
    if (ch !== PERCUSSION_MIDI_CHANNEL && !used.has(ch)) return ch;
  }
  return 1;
}

// ─── Duration helpers shared across modules ─────────────────────────────────

export function ensureTripletDivisions(musicXml: string): string {
  const score = mxlParse(musicXml);
  const current = getDivisions(score);
  if (current % 3 === 0) return musicXml;

  const target = lcmInt(current, 12);
  const factor = target / current;

  for (const part of score.parts) {
    for (const m of part.measures) {
      if (m.attributes?.divisions) m.attributes.divisions = target;
      for (const entry of m.entries) {
        if ("duration" in entry && typeof entry.duration === "number") {
          entry.duration = Math.round(entry.duration * factor);
        }
      }
    }
  }
  return mxlSerialize(score);
}

export function ensureMinDivisions(musicXml: string, minDiv: number): string {
  const score = mxlParse(musicXml);
  const current = getDivisions(score);
  if (current >= minDiv) return musicXml;
  const target = lcmInt(current, minDiv);
  const factor = target / current;
  for (const part of score.parts) {
    for (const m of part.measures) {
      if (m.attributes?.divisions) m.attributes.divisions = target;
      for (const entry of m.entries) {
        if ("duration" in entry && typeof entry.duration === "number") {
          entry.duration = Math.round(entry.duration * factor);
        }
      }
    }
  }
  return mxlSerialize(score);
}

// Re-export mxlParse / mxlSerialize / generateId for use by other modules
export { mxlParse, mxlSerialize, generateId };
// Re-export mxlTranspose / mxlRemovePart for instruments/measures modules
export { transpose as mxlTranspose, removePart as mxlRemovePart } from "musicxml-io";

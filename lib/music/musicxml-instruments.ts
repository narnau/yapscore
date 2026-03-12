import {
  mxlParse,
  mxlSerialize,
  mxlRemovePart,
  generateId,
  findPart,
  findPartInfo,
  measureNum,
  getDivisions,
  getBeats,
  getBeatType,
  getFifths,
  wholeRest,
  clefToSignLine,
  instrumentStaves,
  nextMidiChannel,
} from "./musicxml-core";
import { DEFAULT_MIDI_VOLUME, PERCUSSION_MIDI_CHANNEL } from "./constants";
import type { Score, Part, Measure, PartInfo, BackupEntry } from "musicxml-io";

// ─── Drum catalog ────────────────────────────────────────────────────────────

export type DrumSound = {
  instrumentName: string;
  instrumentId: string;
  midiUnpitched: number;
  displayStep: string;
  displayOctave: number;
  notehead: "normal" | "x" | "circle-x" | "diamond";
  defaultVoice: 1 | 2;
};

export const DRUM_CATALOG: Record<string, DrumSound> = {
  "bass-drum": {
    instrumentName: "Bass Drum 1",
    instrumentId: "X36",
    midiUnpitched: 36,
    displayStep: "C",
    displayOctave: 4,
    notehead: "normal",
    defaultVoice: 2,
  },
  snare: {
    instrumentName: "Acoustic Snare",
    instrumentId: "X38",
    midiUnpitched: 39,
    displayStep: "C",
    displayOctave: 5,
    notehead: "normal",
    defaultVoice: 1,
  },
  "hi-hat": {
    instrumentName: "Closed Hi-Hat",
    instrumentId: "X42",
    midiUnpitched: 43,
    displayStep: "G",
    displayOctave: 5,
    notehead: "x",
    defaultVoice: 1,
  },
  "open-hi-hat": {
    instrumentName: "Open Hi-Hat",
    instrumentId: "X46",
    midiUnpitched: 47,
    displayStep: "G",
    displayOctave: 5,
    notehead: "circle-x",
    defaultVoice: 1,
  },
  "hi-hat-pedal": {
    instrumentName: "Pedal Hi-Hat",
    instrumentId: "X44",
    midiUnpitched: 45,
    displayStep: "G",
    displayOctave: 3,
    notehead: "x",
    defaultVoice: 2,
  },
  "floor-tom": {
    instrumentName: "Low Floor Tom",
    instrumentId: "X41",
    midiUnpitched: 42,
    displayStep: "A",
    displayOctave: 3,
    notehead: "normal",
    defaultVoice: 2,
  },
  "low-tom": {
    instrumentName: "Low-Mid Tom",
    instrumentId: "X47",
    midiUnpitched: 48,
    displayStep: "F",
    displayOctave: 4,
    notehead: "normal",
    defaultVoice: 1,
  },
  "mid-tom": {
    instrumentName: "Hi-Mid Tom",
    instrumentId: "X48",
    midiUnpitched: 49,
    displayStep: "A",
    displayOctave: 4,
    notehead: "normal",
    defaultVoice: 1,
  },
  "high-tom": {
    instrumentName: "High Tom",
    instrumentId: "X50",
    midiUnpitched: 51,
    displayStep: "D",
    displayOctave: 5,
    notehead: "normal",
    defaultVoice: 1,
  },
  crash: {
    instrumentName: "Crash Cymbal 1",
    instrumentId: "X49",
    midiUnpitched: 50,
    displayStep: "A",
    displayOctave: 5,
    notehead: "x",
    defaultVoice: 1,
  },
  ride: {
    instrumentName: "Ride Cymbal 1",
    instrumentId: "X51",
    midiUnpitched: 52,
    displayStep: "F",
    displayOctave: 5,
    notehead: "x",
    defaultVoice: 1,
  },
};

// ─── fixPercussionDisplayOctave ──────────────────────────────────────────────

export function fixPercussionDisplayOctave(musicXml: string): string {
  const score = mxlParse(musicXml);
  for (const part of score.parts) {
    const isPerc = part.measures.some((m) => m.attributes?.clef?.some((c) => c.sign === "percussion"));
    if (!isPerc) continue;
    for (const m of part.measures) {
      for (const entry of m.entries) {
        // Only fix unpitched notes that don't already have a display position
        // (notes from DRUM_CATALOG already have correct displayStep/displayOctave)
        if (entry.type === "note" && entry.unpitched && !entry.unpitched.displayStep) {
          entry.unpitched.displayStep = "B";
          entry.unpitched.displayOctave = 4;
        }
      }
    }
  }
  return mxlSerialize(score);
}

// ─── ScoreInstrument type ───────────────────────────────────────────────────

export type ScoreInstrument = {
  name: string;
  staves?: number;
  midiProgram?: number;
  clef?: "treble" | "bass" | "alto" | "tenor";
  percussion?: boolean;
};

// ─── addPart ────────────────────────────────────────────────────────────────

export function addPart(musicXml: string, instrument: ScoreInstrument): string {
  const score = mxlParse(musicXml);

  // Find next part ID
  const existingNums = score.parts.map((p) => parseInt(p.id.replace("P", "")) || 0);
  const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
  const partId = `P${nextNum}`;
  const isPercussion = instrument.percussion === true;
  const staves = isPercussion ? 1 : (instrument.staves ?? instrumentStaves(instrument.name));

  // Read score parameters
  const firstPart = score.parts[0];
  const measureCount = firstPart ? firstPart.measures.length : 4;
  const divisions = getDivisions(score);
  const beats = getBeats(score);
  const beatType = getBeatType(score);
  const fifths = getFifths(score);
  const dur = Math.round(divisions * beats * (4 / beatType));

  const midiProgram = instrument.midiProgram ?? 1;

  // Add to part-list
  const partInfo: PartInfo = {
    _id: generateId(),
    type: "score-part",
    id: partId,
    name: instrument.name,
    scoreInstruments: isPercussion
      ? Object.entries(DRUM_CATALOG).map(([, drum]) => ({
          id: `${partId}-${drum.instrumentId}`,
          name: drum.instrumentName,
        }))
      : [{ id: `${partId}-I1`, name: instrument.name }],
    midiInstruments: isPercussion
      ? Object.entries(DRUM_CATALOG).map(([, drum]) => ({
          id: `${partId}-${drum.instrumentId}`,
          channel: PERCUSSION_MIDI_CHANNEL,
          program: 1,
          unpitched: drum.midiUnpitched,
          volume: DEFAULT_MIDI_VOLUME,
          pan: 0,
        }))
      : [
          {
            id: `${partId}-I1`,
            channel: nextMidiChannel(score),
            program: midiProgram,
            volume: DEFAULT_MIDI_VOLUME,
            pan: 0,
          },
        ],
  };
  score.partList.push(partInfo);

  // Create part with measures
  const part: Part = { _id: generateId(), id: partId, measures: [] };

  for (let i = 0; i < measureCount; i++) {
    const num = i + 1;
    const isFirst = i === 0;
    const measure: Measure = {
      _id: generateId(),
      number: String(num),
      entries: [],
    };

    if (isFirst) {
      const clefs = isPercussion
        ? [{ sign: "percussion" as const }]
        : staves === 1
          ? [{ ...clefToSignLine(instrument.clef ?? "treble") }]
          : [
              { sign: "G" as const, line: 2, staff: 1 },
              { sign: "F" as const, line: 4, staff: 2 },
            ];

      measure.attributes = {
        divisions,
        ...(isPercussion ? {} : { key: { fifths } }),
        time: { beats: String(beats), beatType },
        ...(staves > 1 ? { staves } : {}),
        clef: clefs,
      };
    }

    for (let s = 0; s < staves; s++) {
      if (s > 0) {
        measure.entries.push({
          _id: generateId(),
          type: "backup",
          duration: dur,
        } as BackupEntry);
      }
      const voice = staves > 1 ? (s === 0 ? 1 : 5) : undefined;
      const staffNum = staves > 1 ? s + 1 : undefined;
      measure.entries.push(wholeRest(dur, staffNum, voice));
    }
    part.measures.push(measure);
  }

  score.parts.push(part);
  return mxlSerialize(score);
}

// ─── removePart ─────────────────────────────────────────────────────────────

export function removePart(musicXml: string, partId: string): string {
  const score = mxlParse(musicXml);
  const result = mxlRemovePart(score, partId);
  if (!result.success) return musicXml; // fallback: return unchanged
  return mxlSerialize(result.data);
}

// ─── renamePart ─────────────────────────────────────────────────────────────

export function renamePart(musicXml: string, partId: string, name: string): string {
  const score = mxlParse(musicXml);
  const pi = findPartInfo(score, partId);
  if (pi) {
    pi.name = name;
    if (pi.scoreInstruments?.[0]) pi.scoreInstruments[0].name = name;
  }
  return mxlSerialize(score);
}

// ─── changeInstrument ───────────────────────────────────────────────────────

export function changeInstrument(musicXml: string, partId: string, instrument: ScoreInstrument): string {
  let xml = renamePart(musicXml, partId, instrument.name);

  if (instrument.midiProgram != null) {
    const score = mxlParse(xml);
    const pi = findPartInfo(score, partId);
    if (pi?.midiInstruments?.[0]) {
      pi.midiInstruments[0].program = instrument.midiProgram;
    }
    xml = mxlSerialize(score);
  }

  const targetStaves = instrument.staves ?? instrumentStaves(instrument.name);
  const score2 = mxlParse(xml);
  const part = findPart(score2, partId);
  const currentStaves = part?.measures[0]?.attributes?.staves ?? 1;

  if (targetStaves !== currentStaves) {
    xml = removePart(xml, partId);
    xml = addPart(xml, { ...instrument, staves: targetStaves });
  }

  return xml;
}

// ─── changeClef ─────────────────────────────────────────────────────────────

export function changeClef(
  musicXml: string,
  partId: string,
  clef: "treble" | "bass" | "alto" | "tenor",
  staffNumber?: number,
): string {
  const { sign, line } = clefToSignLine(clef);
  const score = mxlParse(musicXml);

  const part = findPart(score, partId);
  if (!part) return musicXml;

  const firstMeasure = part.measures[0];
  if (!firstMeasure?.attributes?.clef) return musicXml;

  const clefs = firstMeasure.attributes.clef;

  if (staffNumber != null) {
    const target = clefs.find((c) => c.staff === staffNumber);
    if (target) {
      target.sign = sign;
      target.line = line;
    } else {
      clefs.push({ sign, line, staff: staffNumber });
    }
  } else {
    const target = clefs.find((c) => !c.staff) ?? clefs[0];
    if (target) {
      target.sign = sign;
      target.line = line;
    }
  }

  return mxlSerialize(score);
}

// ─── movePart ───────────────────────────────────────────────────────────────

export function movePart(musicXml: string, partId: string, direction: "up" | "down"): string {
  const score = mxlParse(musicXml);

  // Find part-list index
  const plIdx = score.partList.findIndex((e): e is PartInfo => e.type === "score-part" && e.id === partId);
  if (plIdx === -1) throw new Error(`Part "${partId}" not found`);

  // Find next/prev score-part (skip part-groups)
  const swapPlIdx =
    direction === "up"
      ? [...score.partList.slice(0, plIdx)].reverse().findIndex((e) => e.type === "score-part")
      : score.partList.slice(plIdx + 1).findIndex((e) => e.type === "score-part");

  const actualSwapPlIdx = direction === "up" ? plIdx - 1 - swapPlIdx : plIdx + 1 + swapPlIdx;

  if (swapPlIdx === -1 || actualSwapPlIdx < 0 || actualSwapPlIdx >= score.partList.length) {
    throw new Error(`Cannot move part "${partId}" ${direction} — already at boundary`);
  }

  // Swap in part-list
  [score.partList[plIdx], score.partList[actualSwapPlIdx]] = [score.partList[actualSwapPlIdx], score.partList[plIdx]];

  // Swap in parts array
  const pIdx = score.parts.findIndex((p) => p.id === partId);
  const pSwap = direction === "up" ? pIdx - 1 : pIdx + 1;
  if (pIdx !== -1 && pSwap >= 0 && pSwap < score.parts.length) {
    [score.parts[pIdx], score.parts[pSwap]] = [score.parts[pSwap], score.parts[pIdx]];
  }

  return mxlSerialize(score);
}

// Alias for backwards compatibility
export const reorderParts = movePart;

import {
  mxlParse,
  mxlSerialize,
  mxlTranspose,
  generateId,
  findPart,
  findMeasure,
  measureNum,
  getDivisions,
  getBeats,
  getBeatType,
  getFifths,
  stepAlteredByKey,
  wholeRest,
  measureDuration,
  emptyMeasure,
  transposePitch,
  renumberMeasures,
  gcd,
  lcmInt,
  ensureTripletDivisions,
  ensureMinDivisions,
} from "./musicxml-core";
import { DRUM_CATALOG } from "./musicxml-instruments";
import { SEMITONES_PER_OCTAVE } from "./constants";
import type {
  Score,
  Part,
  Measure,
  MeasureEntry,
  NoteEntry,
  Pitch,
  MeasureAttributes,
  DirectionEntry,
  BackupEntry,
  NoteType,
  Notation,
  Lyric as MxlLyric,
} from "musicxml-io";

// ─── deleteMeasures ─────────────────────────────────────────────────────────

export function deleteMeasures(musicXml: string, measureNumbers: number[]): string {
  const toDelete = new Set(measureNumbers);
  const score = mxlParse(musicXml);
  for (const part of score.parts) {
    // Capture attributes from the first deleted measure that carries them,
    // so we can transfer them to the new first measure if needed.
    let orphanedAttributes: MeasureAttributes | undefined;
    for (const m of part.measures) {
      if (toDelete.has(measureNum(m)) && m.attributes && !orphanedAttributes) {
        orphanedAttributes = m.attributes;
      }
    }

    part.measures = part.measures.filter((m) => !toDelete.has(measureNum(m)));

    // If the new first measure has no attributes, give it the ones we captured.
    if (orphanedAttributes && part.measures.length > 0 && !part.measures[0].attributes) {
      part.measures[0].attributes = orphanedAttributes;
    }
  }
  return renumberMeasures(mxlSerialize(score));
}

// ─── clearMeasures ──────────────────────────────────────────────────────────

export function clearMeasures(musicXml: string, measureNumbers: number[], partId?: string, staff?: number): string {
  const toClear = new Set(measureNumbers);
  const score = mxlParse(musicXml);
  const dur = measureDuration(score);

  for (const part of score.parts) {
    if (partId && part.id !== partId) continue;
    for (const m of part.measures) {
      if (!toClear.has(measureNum(m))) continue;

      if (staff != null) {
        // Staff-specific clear: remove only notes belonging to this staff,
        // keep all other entries (notes on other staves, attributes, directions)
        m.entries = m.entries.filter((e) => {
          if (e.type !== "note") return true;
          const noteStaff = (e as NoteEntry).staff ?? 1;
          return noteStaff !== staff;
        });
        // Add a whole rest for the cleared staff
        m.entries.push(wholeRest(dur, staff, staff === 2 ? 5 : 1));
      } else {
        // Preserve attributes, direction, barline entries
        const preserved = m.entries.filter((e) => e.type === "direction" || e.type === "attributes");
        const preservedBarlines = m.barlines;

        m.entries = [...preserved, wholeRest(dur)];
        m.barlines = preservedBarlines;
      }
    }
  }
  return mxlSerialize(score);
}

// ─── insertEmptyMeasures ────────────────────────────────────────────────────

export function insertEmptyMeasures(musicXml: string, afterMeasure: number, count: number): string {
  const score = mxlParse(musicXml);
  const dur = measureDuration(score);

  for (const part of score.parts) {
    const newMeasures: Measure[] = [];
    for (let i = 0; i < count; i++) {
      newMeasures.push(emptyMeasure(0, dur));
    }

    if (afterMeasure === 0) {
      part.measures = [...newMeasures, ...part.measures];
    } else {
      const idx = part.measures.findIndex((m) => measureNum(m) === afterMeasure);
      if (idx !== -1) {
        part.measures = [...part.measures.slice(0, idx + 1), ...newMeasures, ...part.measures.slice(idx + 1)];
      }
    }
  }
  return renumberMeasures(mxlSerialize(score));
}

// ─── insertPickupMeasure ────────────────────────────────────────────────────

export function insertPickupMeasure(musicXml: string, pickupBeats: number): string {
  const score = mxlParse(musicXml);
  const divisions = getDivisions(score);
  const beatType = getBeatType(score);
  const pickupDuration = Math.round(divisions * pickupBeats * (4 / beatType));

  for (const part of score.parts) {
    const originalFirst = part.measures[0];

    // Move attributes from the original first measure to the new pickup measure
    // so the first measure in the file always carries divisions, clef, key, time.
    const attrs = originalFirst?.attributes;
    if (originalFirst) originalFirst.attributes = undefined;

    const m: Measure = {
      _id: generateId(),
      number: "1",
      implicit: true,
      attributes: attrs,
      entries: [wholeRest(pickupDuration)],
    };
    part.measures = [m, ...part.measures];
  }
  return renumberMeasures(mxlSerialize(score));
}

// ─── duplicateMeasures ──────────────────────────────────────────────────────

export function duplicateMeasures(musicXml: string, measureNumbers: number[]): string {
  const nums = new Set(measureNumbers);
  const lastNum = Math.max(...measureNumbers);
  const score = mxlParse(musicXml);

  for (const part of score.parts) {
    const toDuplicate: Measure[] = [];
    let lastIdx = -1;

    for (let i = 0; i < part.measures.length; i++) {
      const m = part.measures[i];
      const num = measureNum(m);
      if (nums.has(num)) {
        // Clone measure, strip attributes
        const clone: Measure = {
          ...structuredClone(m),
          _id: generateId(),
          attributes: undefined,
        };
        toDuplicate.push(clone);
      }
      if (num === lastNum) lastIdx = i;
    }

    if (lastIdx !== -1 && toDuplicate.length > 0) {
      part.measures = [...part.measures.slice(0, lastIdx + 1), ...toDuplicate, ...part.measures.slice(lastIdx + 1)];
    }
  }
  return renumberMeasures(mxlSerialize(score));
}

// ─── repeatSection ──────────────────────────────────────────────────────────

export function repeatSection(musicXml: string, startMeasure: number, endMeasure: number, times: number): string {
  const score = mxlParse(musicXml);

  for (const part of score.parts) {
    const section: Measure[] = [];
    let endIdx = -1;

    for (let i = 0; i < part.measures.length; i++) {
      const num = measureNum(part.measures[i]);
      if (num >= startMeasure && num <= endMeasure) {
        const clone: Measure = {
          ...structuredClone(part.measures[i]),
          _id: generateId(),
          attributes: undefined,
        };
        section.push(clone);
      }
      if (num === endMeasure) endIdx = i;
    }

    if (endIdx !== -1 && section.length > 0) {
      const copies: Measure[] = [];
      for (let t = 0; t < times; t++) {
        for (const s of section) {
          copies.push({ ...structuredClone(s), _id: generateId() });
        }
      }
      part.measures = [...part.measures.slice(0, endIdx + 1), ...copies, ...part.measures.slice(endIdx + 1)];
    }
  }
  return renumberMeasures(mxlSerialize(score));
}

// ─── transposeMeasures ──────────────────────────────────────────────────────

export function transposeMeasures(musicXml: string, measureNumbers: number[] | null, semitones: number): string {
  const score = mxlParse(musicXml);

  if (!measureNumbers) {
    // Whole score transpose — use musicxml-io
    const result = mxlTranspose(score, semitones);
    if (!result.success) return musicXml; // fallback: return unchanged
    return mxlSerialize(result.data);
  }

  // Per-measure transpose
  const nums = new Set(measureNumbers);
  for (const part of score.parts) {
    for (const m of part.measures) {
      if (!nums.has(measureNum(m))) continue;
      for (const entry of m.entries) {
        if (entry.type === "note" && entry.pitch) {
          const result = transposePitch(entry.pitch.step, entry.pitch.alter ?? 0, entry.pitch.octave, semitones);
          entry.pitch.step = result.step as Pitch["step"];
          entry.pitch.alter = result.alter || undefined;
          entry.pitch.octave = result.octave;
        }
      }
    }
  }
  return mxlSerialize(score);
}

// ─── changeKey ──────────────────────────────────────────────────────────────

import { fifthsToSemitones } from "./musicxml-core";

export function changeKey(musicXml: string, newFifths: number, fromMeasure?: number): string {
  const score = mxlParse(musicXml);
  const oldFifths = getFifths(score);
  const semitones = fifthsToSemitones(oldFifths, newFifths);

  if (fromMeasure === undefined || fromMeasure === 1) {
    // Change entire score key
    for (const part of score.parts) {
      for (const m of part.measures) {
        if (m.attributes?.key) m.attributes.key.fifths = newFifths;
        for (const entry of m.entries) {
          if (entry.type === "note" && (entry as NoteEntry).pitch) {
            const p = (entry as NoteEntry).pitch!;
            const result = transposePitch(p.step, p.alter ?? 0, p.octave, semitones);
            p.step = result.step as Pitch["step"];
            p.alter = result.alter || undefined;
            p.octave = result.octave;
          }
        }
      }
    }
    return mxlSerialize(score);
  }

  // Change from a specific measure onward
  for (const part of score.parts) {
    for (const m of part.measures) {
      const num = measureNum(m);
      if (num < fromMeasure) continue;

      // Transpose notes
      for (const entry of m.entries) {
        if (entry.type === "note" && (entry as NoteEntry).pitch) {
          const p = (entry as NoteEntry).pitch!;
          const result = transposePitch(p.step, p.alter ?? 0, p.octave, semitones);
          p.step = result.step as Pitch["step"];
          p.alter = result.alter || undefined;
          p.octave = result.octave;
        }
      }

      // Insert key change at the fromMeasure
      if (num === fromMeasure) {
        if (m.attributes) {
          if (!m.attributes.key) m.attributes.key = { fifths: newFifths };
          else m.attributes.key.fifths = newFifths;
        } else {
          m.attributes = { key: { fifths: newFifths } };
        }
      }
    }
  }
  return mxlSerialize(score);
}

// ─── scaleNoteDurations ─────────────────────────────────────────────────────

const DURATION_TYPES: NoteType[] = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"];

export function scaleNoteDurations(musicXml: string, measureNumbers: number[], factor: number): string {
  const nums = new Set(measureNumbers);
  const score = mxlParse(musicXml);

  for (const part of score.parts) {
    for (const m of part.measures) {
      if (!nums.has(measureNum(m))) continue;
      for (const entry of m.entries) {
        if (entry.type !== "note") continue;
        const note = entry as NoteEntry;
        note.duration = Math.round(note.duration * factor);
        if (note.noteType) {
          const idx = DURATION_TYPES.indexOf(note.noteType);
          if (idx !== -1) {
            const shift = factor >= 2 ? -1 : factor <= 0.5 ? 1 : 0;
            const newIdx = Math.max(0, Math.min(DURATION_TYPES.length - 1, idx + shift));
            note.noteType = DURATION_TYPES[newIdx];
          }
        }
      }
    }
  }
  return mxlSerialize(score);
}

// ─── setTimeSignature ───────────────────────────────────────────────────────

export function setTimeSignature(musicXml: string, beats: number, beatType: number, fromMeasure: number = 1): string {
  const score = mxlParse(musicXml);

  if (fromMeasure <= 1) {
    // Change all existing time signatures
    for (const part of score.parts) {
      for (const m of part.measures) {
        if (m.attributes?.time) {
          m.attributes.time.beats = String(beats);
          m.attributes.time.beatType = beatType;
        }
      }
    }
    return mxlSerialize(score);
  }

  // Insert at a specific measure
  for (const part of score.parts) {
    const m = findMeasure(part, fromMeasure);
    if (!m) continue;
    if (m.attributes) {
      if (m.attributes.time) {
        m.attributes.time.beats = String(beats);
        m.attributes.time.beatType = beatType;
      } else {
        m.attributes.time = { beats: String(beats), beatType };
      }
    } else {
      m.attributes = { time: { beats: String(beats), beatType } };
    }
  }
  return mxlSerialize(score);
}

// ─── setMeasureNotes ────────────────────────────────────────────────────────

export type NoteSpec = {
  step?: "C" | "D" | "E" | "F" | "G" | "A" | "B";
  octave?: number;
  alter?: number;
  duration:
    | "whole"
    | "half"
    | "quarter"
    | "eighth"
    | "16th"
    | "dotted-whole"
    | "dotted-half"
    | "dotted-quarter"
    | "dotted-eighth"
    | "half-triplet"
    | "quarter-triplet"
    | "eighth-triplet"
    | "16th-triplet";
  chord?: boolean;
  rest?: boolean;
  tie?: "start" | "stop" | "both";
  slur?: "start" | "stop";
  tuplet?: "start" | "stop";
  ornament?: "trill" | "mordent" | "inverted-mordent" | "turn";
  articulation?: "staccato" | "accent" | "tenuto" | "marcato" | "staccatissimo";
  lyric?: { text: string; syllabic?: "single" | "begin" | "middle" | "end"; verse?: number };
  drumSound?: string; // e.g. "snare", "hi-hat", "bass-drum"
  voice?: 1 | 2; // percussion: 1=hands (stems up), 2=feet (stems down)
};

const BASE_TYPE_MAP: Record<string, { type: NoteType; quarterMultiplier: number; dotted: boolean; triplet?: boolean }> =
  {
    whole: { type: "whole", quarterMultiplier: 4, dotted: false },
    half: { type: "half", quarterMultiplier: 2, dotted: false },
    quarter: { type: "quarter", quarterMultiplier: 1, dotted: false },
    eighth: { type: "eighth", quarterMultiplier: 0.5, dotted: false },
    "16th": { type: "16th", quarterMultiplier: 0.25, dotted: false },
    "dotted-whole": { type: "whole", quarterMultiplier: 6, dotted: true },
    "dotted-half": { type: "half", quarterMultiplier: 3, dotted: true },
    "dotted-quarter": { type: "quarter", quarterMultiplier: 1.5, dotted: true },
    "dotted-eighth": { type: "eighth", quarterMultiplier: 0.75, dotted: true },
    "half-triplet": { type: "half", quarterMultiplier: 4 / 3, dotted: false, triplet: true },
    "quarter-triplet": { type: "quarter", quarterMultiplier: 2 / 3, dotted: false, triplet: true },
    "eighth-triplet": { type: "eighth", quarterMultiplier: 1 / 3, dotted: false, triplet: true },
    "16th-triplet": { type: "16th", quarterMultiplier: 1 / 6, dotted: false, triplet: true },
  };

export function notesTotalBeats(notes: NoteSpec[]): number {
  return notes.filter((n) => !n.chord).reduce((sum, n) => sum + (BASE_TYPE_MAP[n.duration]?.quarterMultiplier ?? 0), 0);
}

function noteSpecToEntry(note: NoteSpec, divisions: number, staff?: number, partId?: string): NoteEntry {
  const info = BASE_TYPE_MAP[note.duration];
  if (!info) throw new Error(`Unknown duration: ${note.duration}`);

  const dur = Math.round(info.quarterMultiplier * divisions);
  const entry: NoteEntry = {
    _id: generateId(),
    type: "note",
    duration: dur,
    noteType: info.type,
  };

  if (note.chord) entry.chord = true;

  if (note.drumSound && !note.rest) {
    // Percussion unpitched note
    const drum = DRUM_CATALOG[note.drumSound];
    if (!drum)
      throw new Error(`Unknown drum sound: "${note.drumSound}". Valid: ${Object.keys(DRUM_CATALOG).join(", ")}`);
    entry.unpitched = { displayStep: drum.displayStep, displayOctave: drum.displayOctave };
    if (partId) entry.instrument = `${partId}-${drum.instrumentId}`;
    if (drum.notehead !== "normal") {
      entry.notehead = { value: drum.notehead as "x" | "circle-x" | "diamond" };
    }
    const voiceNum = note.voice ?? drum.defaultVoice;
    entry.voice = String(voiceNum);
    entry.stem = { value: voiceNum === 2 ? "down" : "up" };
  } else if (note.rest) {
    entry.rest = {};
    if (note.voice != null) {
      entry.voice = String(note.voice);
      entry.printObject = false; // hide percussion fill-rests from display
    }
  } else {
    if (!note.step) throw new Error("Non-rest note must have a step");
    entry.pitch = {
      step: note.step,
      octave: note.octave ?? 4,
      ...(note.alter ? { alter: note.alter } : {}),
    };
  }

  // Tie
  if (note.tie === "stop" || note.tie === "both") {
    entry.ties = [...(entry.ties ?? []), { type: "stop" }];
  }
  if (note.tie === "start" || note.tie === "both") {
    entry.ties = [...(entry.ties ?? []), { type: "start" }];
  }

  // Staff-based voice for grand staff (skip if voice already set by percussion logic)
  if (staff && !entry.voice) {
    entry.voice = String(staff === 2 ? 5 : 1);
    entry.staff = staff;
  }

  if (info.dotted) entry.dots = 1;
  if (info.triplet) {
    entry.timeModification = { actualNotes: 3, normalNotes: 2 };
  }

  // Lyric
  if (note.lyric) {
    entry.lyrics = [
      {
        number: note.lyric.verse ?? 1,
        syllabic: note.lyric.syllabic ?? "single",
        text: note.lyric.text,
      },
    ];
  }

  // Notations
  const notations: Notation[] = [];
  if (note.tie === "stop" || note.tie === "both") notations.push({ type: "tied", tiedType: "stop" });
  if (note.tie === "start" || note.tie === "both") notations.push({ type: "tied", tiedType: "start" });
  if (note.slur === "start") notations.push({ type: "slur", slurType: "start", number: 1 });
  if (note.slur === "stop") notations.push({ type: "slur", slurType: "stop", number: 1 });
  if (note.ornament) {
    const ornMap: Record<string, string> = {
      trill: "trill-mark",
      mordent: "mordent",
      "inverted-mordent": "inverted-mordent",
      turn: "turn",
    };
    notations.push({
      type: "ornament",
      ornament: (ornMap[note.ornament] ?? note.ornament) as "trill-mark" | "mordent" | "inverted-mordent" | "turn",
    });
  }
  if (note.articulation) {
    notations.push({ type: "articulation", articulation: note.articulation });
  }
  if (note.tuplet === "start") {
    notations.push({
      type: "tuplet",
      tupletType: "start",
      number: 1,
      bracket: true,
      showNumber: "actual",
      tupletActual: { tupletNumber: 3, tupletType: info.type },
      tupletNormal: { tupletNumber: 2, tupletType: info.type },
    });
  }
  if (note.tuplet === "stop") {
    notations.push({ type: "tuplet", tupletType: "stop", number: 1 });
  }

  if (notations.length > 0) entry.notations = notations;

  return entry;
}

// ─── triplet auto-notation ──────────────────────────────────────────────────

/**
 * Auto-inject tuplet start/stop notations on consecutive triplet note groups.
 * Groups of 3 notes sharing the same timeModification get a tuplet bracket
 * automatically — the LLM doesn't need to specify tuplet:"start"/"stop" manually.
 */
function autoTupletNotations(entries: NoteEntry[]): NoteEntry[] {
  // Only consider non-chord notes for grouping (chords share a beat with their root)
  const nonChord = entries.filter((e) => !e.chord);
  let i = 0;
  while (i < nonChord.length) {
    const e = nonChord[i];
    if (e.timeModification?.actualNotes === 3) {
      // Check if the next 2 non-chord notes are also triplets of the same duration
      const j1 = nonChord[i + 1];
      const j2 = nonChord[i + 2];
      if (
        j1?.timeModification?.actualNotes === 3 &&
        j2?.timeModification?.actualNotes === 3 &&
        e.noteType === j1.noteType &&
        e.noteType === j2.noteType
      ) {
        // Only add if not already set
        const hasTuplet = (n: NoteEntry) => n.notations?.some((x) => x.type === "tuplet");
        if (!hasTuplet(e)) {
          e.notations = [
            {
              type: "tuplet",
              tupletType: "start",
              number: 1,
              bracket: true,
              showNumber: "actual",
              tupletActual: { tupletNumber: 3, tupletType: e.noteType },
              tupletNormal: { tupletNumber: 2, tupletType: e.noteType },
            },
            ...(e.notations ?? []),
          ];
        }
        if (!hasTuplet(j2)) {
          j2.notations = [{ type: "tuplet", tupletType: "stop", number: 1 }, ...(j2.notations ?? [])];
        }
        i += 3;
        continue;
      }
    }
    i++;
  }
  return entries;
}

export function setMeasureNotes(
  musicXml: string,
  measureNumber: number,
  notes: NoteSpec[],
  partId: string = "P1",
  staff?: number,
  voice?: 1 | 2,
): string {
  // Auto-insert missing measures
  const score0 = mxlParse(musicXml);
  const firstPart = score0.parts[0];
  const currentCount = firstPart ? firstPart.measures.length : 0;
  if (measureNumber > currentCount) {
    musicXml = insertEmptyMeasures(musicXml, currentCount, measureNumber - currentCount);
  }

  // Upgrade divisions if triplets needed
  const hasTriplets = notes.some((n) => BASE_TYPE_MAP[n.duration]?.triplet);
  if (hasTriplets) musicXml = ensureTripletDivisions(musicXml);

  const score = mxlParse(musicXml);
  const divisions = getDivisions(score);

  const part = findPart(score, partId);
  if (!part) return musicXml;

  const measure = findMeasure(part, measureNumber);
  if (!measure) return musicXml;

  // Detect if this part actually has multiple staves
  const partStaves = part.measures[0]?.attributes?.staves ?? 1;
  // If the part is single-staff, ignore the staff parameter
  const effectiveStaff = partStaves > 1 ? staff : undefined;

  // Preserve non-note entries
  const preserved = measure.entries.filter(
    (e) => e.type === "direction" || e.type === "attributes" || e.type === "harmony",
  );
  const preservedBarlines = measure.barlines;

  const noteEntries = autoTupletNotations(notes.map((n) => noteSpecToEntry(n, divisions, effectiveStaff, partId)));

  if (voice != null) {
    // Percussion voice-aware merge: keep the other voice's notes, discard measure rests
    const otherVoiceNotes = measure.entries.filter(
      (e) => e.type === "note" && (e as NoteEntry).voice !== String(voice) && !(e as NoteEntry).rest?.measure,
    );

    const beats = getBeats(score);
    const beatType = getBeatType(score);
    const dur = Math.round(divisions * beats * (4 / beatType));

    const v1Notes = voice === 1 ? noteEntries : otherVoiceNotes;
    const v2Notes = voice === 2 ? noteEntries : otherVoiceNotes;

    if (v1Notes.length > 0 && v2Notes.length > 0) {
      const backup: BackupEntry = { _id: generateId(), type: "backup", duration: dur };
      measure.entries = [...preserved, ...v1Notes, backup, ...v2Notes];
    } else {
      measure.entries = [...preserved, ...v1Notes, ...v2Notes];
    }
  } else if (!effectiveStaff) {
    measure.entries = [...preserved, ...noteEntries];
  } else {
    // Staff-aware: keep other staff's notes
    const otherStaff = staff === 1 ? 2 : 1;
    const otherNotes = measure.entries.filter((e) => e.type === "note" && (e as NoteEntry).staff === otherStaff);

    const beats = getBeats(score);
    const beatType = getBeatType(score);
    const dur = Math.round(divisions * beats * (4 / beatType));

    const backup: BackupEntry = {
      _id: generateId(),
      type: "backup",
      duration: dur,
    };

    if (staff === 1) {
      measure.entries = [...preserved, ...noteEntries, backup, ...otherNotes];
    } else {
      // Ensure explicit staff tags on other notes
      for (const n of otherNotes) {
        if (n.type === "note" && !(n as NoteEntry).staff) {
          (n as NoteEntry).voice = "1";
          (n as NoteEntry).staff = 1;
        }
      }
      measure.entries = [...preserved, ...otherNotes, backup, ...noteEntries];
    }
  }

  measure.barlines = preservedBarlines;
  return mxlSerialize(score);
}

// ─── writeNotes (alias for setMeasureNotes) ─────────────────────────────────

export const writeNotes = setMeasureNotes;

// ─── pasteMeasures ──────────────────────────────────────────────────────────

export function pasteMeasures(musicXml: string, sourceMeasureNumbers: number[], targetStartMeasure: number): string {
  const score = mxlParse(musicXml);
  const sorted = [...sourceMeasureNumbers].sort((a, b) => a - b);
  for (const part of score.parts) {
    for (let i = 0; i < sorted.length; i++) {
      const src = findMeasure(part, sorted[i]);
      const tgt = findMeasure(part, targetStartMeasure + i);
      if (!src || !tgt) continue;
      tgt.entries = (JSON.parse(JSON.stringify(src.entries)) as MeasureEntry[]).map((e) => ({
        ...e,
        _id: generateId(),
      }));
    }
  }
  return mxlSerialize(score);
}

// ─── NotePosition + buildNoteMap + changeNotePitch + deleteNote + changeNoteDuration ──

export type NotePosition = {
  partId: string;
  measureNumber: number;
  entryIndex: number;
  isRest?: boolean;
  isDrum?: boolean;
  xmlId?: string;
};

/** Extract note id attributes from raw MusicXML in document order. */
function extractNoteXmlIds(musicXml: string): string[] {
  const ids: string[] = [];
  // Match <note ... id="xxx" ...> tags — id may appear anywhere in attributes
  const noteTagRe = /<note\b([^>]*)>/g;
  let match;
  while ((match = noteTagRe.exec(musicXml)) !== null) {
    const attrs = match[1];
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    ids.push(idMatch ? idMatch[1] : "");
  }
  return ids;
}

/** Returns an ordered array matching DOM g.note / g.rest element order in Verovio SVG output. */
export function buildNoteMap(musicXml: string): NotePosition[] {
  const score = mxlParse(musicXml);
  const xmlIds = extractNoteXmlIds(musicXml);
  const result: NotePosition[] = [];
  let noteIdx = 0;
  for (const part of score.parts) {
    for (const m of part.measures) {
      const mNum = measureNum(m);
      m.entries.forEach((entry, idx) => {
        const ne = entry as NoteEntry;
        if (entry.type === "note") {
          const xmlId = xmlIds[noteIdx] || undefined;
          noteIdx++;
          if (ne.pitch || ne.rest || ne.unpitched) {
            result.push({
              partId: part.id,
              measureNumber: mNum,
              entryIndex: idx,
              isRest: !!ne.rest,
              isDrum: !!ne.unpitched,
              xmlId,
            });
          }
        }
      });
    }
  }
  return result;
}

/** Returns a Map from xml:id → NotePosition for ID-based SVG↔NoteMap matching. */
export function buildNoteMapById(musicXml: string): Map<string, NotePosition> {
  const arr = buildNoteMap(musicXml);
  const map = new Map<string, NotePosition>();
  for (const pos of arr) {
    if (pos.xmlId) map.set(pos.xmlId, pos);
  }
  return map;
}

/** Move a single note pitch by `semitones` chromatic steps. */
export function changeNotePitch(musicXml: string, position: NotePosition, semitones: number): string {
  const score = mxlParse(musicXml);
  const part = findPart(score, position.partId);
  if (!part) return musicXml;
  const measure = findMeasure(part, position.measureNumber);
  if (!measure) return musicXml;
  const entry = measure.entries[position.entryIndex];
  if (!entry || entry.type !== "note") return musicXml;
  const noteEntry = entry as NoteEntry;
  if (!noteEntry.pitch) return musicXml;
  const result = transposePitch(noteEntry.pitch.step, noteEntry.pitch.alter ?? 0, noteEntry.pitch.octave, semitones);
  noteEntry.pitch.step = result.step as Pitch["step"];
  noteEntry.pitch.alter = result.alter || undefined;
  noteEntry.pitch.octave = result.octave;
  // Update the display accidental so Verovio shows the correct symbol.
  if (result.alter !== 0) {
    noteEntry.accidental = { value: result.alter > 0 ? "sharp" : "flat" };
  } else {
    // Natural: show natural sign only if the key signature alters this step
    const fifths = getFifths(score);
    if (stepAlteredByKey(result.step, fifths)) {
      noteEntry.accidental = { value: "natural" };
    } else {
      noteEntry.accidental = undefined;
    }
  }
  return mxlSerialize(score);
}

export function deleteNote(musicXml: string, position: NotePosition): string {
  const score = mxlParse(musicXml);
  const part = findPart(score, position.partId);
  if (!part) return musicXml;
  const measure = findMeasure(part, position.measureNumber);
  if (!measure) return musicXml;
  const entry = measure.entries[position.entryIndex];
  if (!entry || entry.type !== "note") return musicXml;
  const noteEntry = entry as NoteEntry;
  if (noteEntry.rest || noteEntry.chord) return musicXml;
  measure.entries[position.entryIndex] = {
    _id: generateId(),
    type: "note",
    rest: {},
    duration: noteEntry.duration,
    noteType: noteEntry.noteType,
    ...(noteEntry.voice != null ? { voice: noteEntry.voice } : {}),
    ...(noteEntry.staff != null ? { staff: noteEntry.staff } : {}),
  } as NoteEntry;
  return mxlSerialize(score);
}

// ─── changeNoteDuration ─────────────────────────────────────────────────────

const DURATION_KEYS: Record<string, { noteType: NoteType; quarterMultiplier: number }> = {
  "1": { noteType: "64th", quarterMultiplier: 1 / 16 },
  "2": { noteType: "32nd", quarterMultiplier: 1 / 8 },
  "3": { noteType: "16th", quarterMultiplier: 1 / 4 },
  "4": { noteType: "eighth", quarterMultiplier: 1 / 2 },
  "5": { noteType: "quarter", quarterMultiplier: 1 },
  "6": { noteType: "half", quarterMultiplier: 2 },
  "7": { noteType: "whole", quarterMultiplier: 4 },
};

// Minimum divisions value needed to represent each key as an integer tick count
const KEY_MIN_DIVISIONS: Record<string, number> = {
  "1": 16,
  "2": 8,
  "3": 4,
  "4": 2,
  "5": 1,
  "6": 1,
  "7": 1,
};

/**
 * Fill `ticks` with one or more properly-typed rests (greedy, largest first).
 * Avoids inserting a single rest with an invalid/mismatched noteType.
 */
function makeFillRests(
  ticks: number,
  divisions: number,
  voice?: number | string,
  staff?: number | string,
): NoteEntry[] {
  const types: Array<[number, NoteType]> = (
    [
      [divisions * 4, "whole"],
      [divisions * 2, "half"],
      [divisions, "quarter"],
      [Math.round(divisions / 2), "eighth"],
      [Math.round(divisions / 4), "16th"],
      [Math.round(divisions / 8), "32nd"],
      [Math.round(divisions / 16), "64th"],
    ] as Array<[number, NoteType]>
  ).filter(([d]) => d >= 1);

  const rests: NoteEntry[] = [];
  let remaining = ticks;
  for (const [dur, noteType] of types) {
    while (remaining >= dur) {
      rests.push({
        _id: generateId(),
        type: "note",
        rest: {},
        duration: dur,
        noteType,
        ...(voice != null ? { voice } : {}),
        ...(staff != null ? { staff } : {}),
      } as NoteEntry);
      remaining -= dur;
    }
  }
  return rests;
}

function ticksToNoteType(ticks: number, divisions: number): NoteType | undefined {
  const q = divisions;
  const map: Array<[number, NoteType]> = [
    [q * 4, "whole"],
    [q * 2, "half"],
    [q, "quarter"],
    [q / 2, "eighth"],
    [q / 4, "16th"],
    [q / 8, "32nd"],
    [q / 16, "64th"],
  ];
  for (const [dur, type] of map) if (Math.abs(ticks - dur) < 0.5) return type;
  return undefined;
}

export function changeNoteDuration(
  musicXml: string,
  position: NotePosition,
  key: "1" | "2" | "3" | "4" | "5" | "6" | "7",
): string {
  // Scale up divisions first so the target note type is representable as integer ticks
  musicXml = ensureMinDivisions(musicXml, KEY_MIN_DIVISIONS[key]);

  const score = mxlParse(musicXml);
  const divisions = getDivisions(score);
  const part = findPart(score, position.partId);
  if (!part) return musicXml;
  const measure = findMeasure(part, position.measureNumber);
  if (!measure) return musicXml;

  // If user clicked a chord note, walk back to find the main note of the chord group
  let mainIdx = position.entryIndex;
  while (mainIdx > 0 && (measure.entries[mainIdx] as NoteEntry).chord) mainIdx--;

  const entry = measure.entries[mainIdx];
  if (!entry || entry.type !== "note") return musicXml;
  const noteEntry = entry as NoteEntry;

  const { noteType, quarterMultiplier } = DURATION_KEYS[key];
  const newDuration = Math.round(divisions * quarterMultiplier);
  if (newDuration <= 0) return musicXml;
  const oldDuration = noteEntry.duration;
  if (newDuration === oldDuration) return musicXml;

  // Find the last chord note in this chord group
  let lastChordIdx = mainIdx;
  while (lastChordIdx + 1 < measure.entries.length && (measure.entries[lastChordIdx + 1] as NoteEntry).chord)
    lastChordIdx++;

  // Update main note and all chord notes together
  noteEntry.noteType = noteType;
  noteEntry.duration = newDuration;
  // Remove "measure rest" flag — it means "this rest fills the whole measure"
  // and would cause Verovio to render it as a whole rest regardless of actual duration.
  if (noteEntry.rest?.measure) delete noteEntry.rest.measure;
  for (let ci = mainIdx + 1; ci <= lastChordIdx; ci++) {
    const cn = measure.entries[ci] as NoteEntry;
    cn.noteType = noteType;
    cn.duration = newDuration;
  }

  const diff = newDuration - oldDuration;
  const insertAt = lastChordIdx + 1;

  if (diff < 0) {
    // Shorter — fill freed ticks with one or more properly-typed rests
    const fillRests = makeFillRests(-diff, divisions, noteEntry.voice, noteEntry.staff);
    measure.entries.splice(insertAt, 0, ...fillRests);
  } else {
    // Longer — consume subsequent entries of same voice (rests AND notes)
    let remaining = diff;
    let i = insertAt;
    const voice = noteEntry.voice;
    while (remaining > 0 && i < measure.entries.length) {
      const next = measure.entries[i] as NoteEntry;
      if (next.type !== "note") break;
      if (next.chord) {
        i++;
        continue;
      } // chord notes take no independent time
      if (voice != null && next.voice != null && next.voice !== voice) {
        i++;
        continue;
      }
      if (next.duration <= remaining) {
        // Fully consume: remove this entry plus any of its chord notes
        remaining -= next.duration;
        measure.entries.splice(i, 1);
        while (i < measure.entries.length && (measure.entries[i] as NoteEntry).chord) {
          measure.entries.splice(i, 1);
        }
      } else {
        // Partially consume: replace with a rest for the leftover ticks
        // (whether this was a pitched note or a rest, it becomes a rest)
        const leftover = next.duration - remaining;
        let toRemove = 1;
        while (i + toRemove < measure.entries.length && (measure.entries[i + toRemove] as NoteEntry).chord) {
          toRemove++;
        }
        const leftoverRests = makeFillRests(leftover, divisions, next.voice, next.staff);
        measure.entries.splice(i, toRemove, ...leftoverRests);
        remaining = 0;
      }
    }
    if (remaining > 0) {
      // Still not enough space (e.g. hit a non-note boundary) — revert
      noteEntry.noteType = ticksToNoteType(oldDuration, divisions) ?? noteEntry.noteType;
      noteEntry.duration = oldDuration;
      for (let ci = mainIdx + 1; ci <= lastChordIdx; ci++) {
        const cn = measure.entries[ci] as NoteEntry;
        cn.noteType = ticksToNoteType(oldDuration, divisions) ?? cn.noteType;
        cn.duration = oldDuration;
      }
    }
  }
  return mxlSerialize(score);
}

// ─── setSwing / getSwing ─────────────────────────────────────────────────────

export type SwingInfo = {
  /** first:second ratio — e.g. {first:2, second:1} for standard triplet swing */
  first: number;
  second: number;
  swingType: "eighth" | "16th";
};

/** Convert a swing percentage (50–75) to a simple first:second ratio for MusicXML.
 *  50% → 1:1 (straight), 60% → 3:2, 66% → 2:1, 75% → 3:1 */
export function percentToSwingRatio(percent: number): { first: number; second: number } {
  // Common named ratios
  if (percent <= 50) return { first: 1, second: 1 };
  if (percent >= 75) return { first: 3, second: 1 };
  if (percent >= 65 && percent <= 68) return { first: 2, second: 1 }; // 66.7%
  if (percent >= 58 && percent <= 62) return { first: 3, second: 2 }; // 60%
  // Generic: store as p:(100-p) — exact but large numbers
  const g = gcd(percent, 100 - percent);
  return { first: percent / g, second: (100 - percent) / g };
}

/** Convert first:second back to percentage (e.g. 2:1 → 67). */
export function swingRatioToPercent(first: number, second: number): number {
  return Math.round((first / (first + second)) * 100);
}

/** Remove any existing swing direction, then optionally insert a new one. */
export function setSwing(musicXml: string, swing: SwingInfo | null): string {
  // Strip any existing swing direction block we previously inserted
  const xml = musicXml.replace(
    /<direction[^>]*>\s*<direction-type>\s*<words[^>]*>Swing<\/words>\s*<\/direction-type>[\s\S]*?<\/direction>\n?/g,
    "",
  );
  if (!swing) return xml;

  const { first, second, swingType } = swing;
  const block =
    `<direction placement="above">\n` +
    `      <direction-type><words>Swing</words></direction-type>\n` +
    `      <sound><swing><first>${first}</first><second>${second}</second>` +
    `<swing-type>${swingType}</swing-type></swing></sound>\n` +
    `    </direction>\n    `;

  // Insert as first child of the first measure
  return xml.replace(/(<measure\b[^>]*>)(\s*)/, `$1\n    ${block}`);
}

/** Detect swing info stored in the MusicXML (returns null if straight). */
export function getSwing(musicXml: string): SwingInfo | null {
  const m = musicXml.match(
    /<swing>\s*<first>(\d+)<\/first>\s*<second>(\d+)<\/second>\s*<swing-type>(eighth|16th)<\/swing-type>\s*<\/swing>/,
  );
  if (!m) return null;
  return { first: parseInt(m[1]), second: parseInt(m[2]), swingType: m[3] as "eighth" | "16th" };
}

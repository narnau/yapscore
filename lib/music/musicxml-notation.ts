import {
  mxlParse,
  mxlSerialize,
  generateId,
  findPart,
  findMeasure,
  measureNum,
  getDivisions,
  buildTempoDirection,
  type SoundEntry,
  type ArticulationNotation,
} from "./musicxml-core";
import type {
  Score, Measure, MeasureEntry, NoteEntry, Pitch,
  DirectionEntry, DirectionType, NoteType, Notation, DynamicsValue,
  Lyric as MxlLyric,
} from "musicxml-io";

// ─── setTempo / getTempo ────────────────────────────────────────────────────

export function setTempo(musicXml: string, bpm: number, beatUnit: string = "quarter"): string {
  const score = mxlParse(musicXml);
  let found = false;

  // Update existing tempo markings
  for (const part of score.parts) {
    for (const m of part.measures) {
      for (const entry of m.entries) {
        if (entry.type === "direction") {
          for (const dt of (entry as DirectionEntry).directionTypes) {
            if (dt.kind === "metronome") {
              dt.beatUnit = beatUnit as NoteType;
              dt.perMinute = bpm;
              found = true;
            }
          }
          if ((entry as DirectionEntry).sound?.tempo) {
            (entry as DirectionEntry).sound!.tempo = bpm;
            found = true;
          }
        }
      }
    }
  }

  if (!found) {
    // Insert tempo in measure 1 of each part
    for (const part of score.parts) {
      const m1 = part.measures[0];
      if (!m1) continue;
      const dir = buildTempoDirection(bpm, beatUnit as NoteType);
      const firstNoteIdx = m1.entries.findIndex(e => e.type === "note");
      if (firstNoteIdx !== -1) {
        m1.entries.splice(firstNoteIdx, 0, dir);
      } else {
        m1.entries.push(dir);
      }
    }
  }
  return mxlSerialize(score);
}

export function getTempo(musicXml: string): { bpm: number; beatUnit: string } | null {
  const score = mxlParse(musicXml);
  for (const part of score.parts) {
    for (const m of part.measures) {
      for (const entry of m.entries) {
        if (entry.type === "direction") {
          const dir = entry as DirectionEntry;
          if (dir.sound?.tempo) {
            const met = dir.directionTypes.find(dt => dt.kind === "metronome");
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

// ─── addDynamics ────────────────────────────────────────────────────────────

const DYNAMIC_VELOCITIES: Record<string, number> = {
  pp: 36, p: 54, mp: 71, mf: 89, f: 106, ff: 124, fp: 96, sfz: 112,
};

export type DynamicMarking = "pp" | "p" | "mp" | "mf" | "f" | "ff" | "fp" | "sfz";

export function addDynamics(
  musicXml: string,
  measureNumbers: number[],
  dynamic: DynamicMarking
): string {
  const nums = new Set(measureNumbers);
  const velocity = DYNAMIC_VELOCITIES[dynamic] ?? 89;
  const score = mxlParse(musicXml);

  for (const part of score.parts) {
    for (const m of part.measures) {
      if (!nums.has(measureNum(m))) continue;

      // Check for existing dynamics direction
      const existingIdx = m.entries.findIndex(e =>
        e.type === "direction" &&
        (e as DirectionEntry).directionTypes.some(dt => dt.kind === "dynamics")
      );

      if (existingIdx !== -1) {
        const dir = m.entries[existingIdx] as DirectionEntry;
        const dynDt = dir.directionTypes.find(dt => dt.kind === "dynamics");
        if (dynDt && dynDt.kind === "dynamics") {
          dynDt.value = dynamic as DynamicsValue;
        }
        if (dir.sound) dir.sound.dynamics = velocity;
        continue;
      }

      // Insert new direction before first note
      const dir: DirectionEntry = {
        _id: generateId(),
        type: "direction",
        placement: "below",
        directionTypes: [{ kind: "dynamics", value: dynamic as DynamicsValue }],
        sound: { dynamics: velocity },
      };

      const firstNoteIdx = m.entries.findIndex(e => e.type === "note");
      if (firstNoteIdx !== -1) m.entries.splice(firstNoteIdx, 0, dir);
      else m.entries.push(dir);
    }
  }
  return mxlSerialize(score);
}

// ─── addArticulations / removeArticulations ─────────────────────────────────

export type ArticulationMarking = "staccato" | "accent" | "tenuto" | "marcato" | "staccatissimo";

export function addArticulations(
  musicXml: string,
  measureNumbers: number[],
  articulation: ArticulationMarking,
  partId?: string
): string {
  const nums = new Set(measureNumbers);
  const score = mxlParse(musicXml);

  for (const part of score.parts) {
    if (partId && part.id !== partId) continue;
    for (const m of part.measures) {
      if (!nums.has(measureNum(m))) continue;
      for (const entry of m.entries) {
        if (entry.type !== "note" || (entry as NoteEntry).rest) continue;
        const note = entry as NoteEntry;
        if (!note.notations) note.notations = [];
        note.notations.push({
          type: "articulation",
          articulation,
        });
      }
    }
  }
  return mxlSerialize(score);
}

export function removeArticulations(
  musicXml: string,
  measureNumbers: number[],
  articulation?: ArticulationMarking,
  partId?: string
): string {
  const nums = new Set(measureNumbers);
  const score = mxlParse(musicXml);

  for (const part of score.parts) {
    if (partId && part.id !== partId) continue;
    for (const m of part.measures) {
      if (!nums.has(measureNum(m))) continue;
      for (const entry of m.entries) {
        if (entry.type !== "note" || (entry as NoteEntry).rest) continue;
        const note = entry as NoteEntry;
        if (!note.notations) continue;
        note.notations = note.notations.filter((n) => {
          if (n.type !== "articulation") return true;
          if (articulation && (n as ArticulationNotation).articulation !== articulation) return true;
          return false;
        });
      }
    }
  }
  return mxlSerialize(score);
}

// ─── addRepeatBarlines ──────────────────────────────────────────────────────

export function addRepeatBarlines(
  musicXml: string,
  startMeasure: number,
  endMeasure: number
): string {
  const score = mxlParse(musicXml);

  for (const part of score.parts) {
    for (const m of part.measures) {
      const num = measureNum(m);
      if (!m.barlines) m.barlines = [];

      if (num === startMeasure) {
        m.barlines.push({
          _id: generateId(),
          location: "left",
          barStyle: "heavy-light",
          repeat: { direction: "forward" },
        });
      }
      if (num === endMeasure) {
        m.barlines.push({
          _id: generateId(),
          location: "right",
          barStyle: "light-heavy",
          repeat: { direction: "backward" },
        });
      }
    }
  }
  return mxlSerialize(score);
}

// ─── addVoltaBrackets ───────────────────────────────────────────────────────

export function addVoltaBrackets(
  musicXml: string,
  firstEndingMeasures: number[],
  secondEndingMeasures: number[]
): string {
  const firstStart = Math.min(...firstEndingMeasures);
  const firstEnd = Math.max(...firstEndingMeasures);
  const secondStart = Math.min(...secondEndingMeasures);
  const secondEnd = Math.max(...secondEndingMeasures);
  const score = mxlParse(musicXml);

  for (const part of score.parts) {
    for (const m of part.measures) {
      const num = measureNum(m);
      if (!m.barlines) m.barlines = [];

      if (num === firstStart) {
        m.barlines.push({
          _id: generateId(),
          location: "left",
          ending: { number: "1", type: "start" },
        });
      }
      if (num === firstEnd) {
        m.barlines.push({
          _id: generateId(),
          location: "right",
          ending: { number: "1", type: "stop" },
          repeat: { direction: "backward" },
        });
      }
      if (num === secondStart) {
        m.barlines.push({
          _id: generateId(),
          location: "left",
          ending: { number: "2", type: "start" },
        });
      }
      if (num === secondEnd) {
        m.barlines.push({
          _id: generateId(),
          location: "right",
          ending: { number: "2", type: "stop" },
        });
      }
    }
  }
  return mxlSerialize(score);
}

// ─── addHairpin ─────────────────────────────────────────────────────────────

export function addHairpin(
  musicXml: string,
  startMeasure: number,
  endMeasure: number,
  type: "crescendo" | "diminuendo"
): string {
  const score = mxlParse(musicXml);

  for (const part of score.parts) {
    for (const m of part.measures) {
      const num = measureNum(m);

      if (num === startMeasure) {
        const dir: DirectionEntry = {
          _id: generateId(),
          type: "direction",
          placement: "below",
          directionTypes: [{ kind: "wedge", type }],
        };
        const firstNoteIdx = m.entries.findIndex(e => e.type === "note");
        if (firstNoteIdx !== -1) m.entries.splice(firstNoteIdx, 0, dir);
        else m.entries.push(dir);
      }
      if (num === endMeasure) {
        const dir: DirectionEntry = {
          _id: generateId(),
          type: "direction",
          placement: "below",
          directionTypes: [{ kind: "wedge", type: "stop" }],
        };
        const firstNoteIdx = m.entries.findIndex(e => e.type === "note");
        if (firstNoteIdx !== -1) m.entries.splice(firstNoteIdx, 0, dir);
        else m.entries.push(dir);
      }
    }
  }
  return mxlSerialize(score);
}

// ─── addTextAnnotation ──────────────────────────────────────────────────────

export function addTextAnnotation(
  musicXml: string,
  measureNumber: number,
  text: string,
  type: "text" | "rehearsal"
): string {
  const score = mxlParse(musicXml);

  for (const part of score.parts) {
    for (const m of part.measures) {
      if (measureNum(m) !== measureNumber) continue;

      const dirType: DirectionType = type === "rehearsal"
        ? { kind: "rehearsal", text, enclosure: "square" }
        : { kind: "words", text, fontStyle: "italic" };

      const dir: DirectionEntry = {
        _id: generateId(),
        type: "direction",
        placement: "above",
        directionTypes: [dirType],
      };

      const firstNoteIdx = m.entries.findIndex(e => e.type === "note");
      if (firstNoteIdx !== -1) m.entries.splice(firstNoteIdx, 0, dir);
      else m.entries.push(dir);
    }
  }
  return mxlSerialize(score);
}

// ─── addSlur / removeSlurs ───────────────────────────────────────────────────

export function addSlur(
  musicXml: string,
  startMeasure: number,
  endMeasure: number,
  partId = "P1",
): string {
  const score = mxlParse(musicXml);
  const part = findPart(score, partId);
  if (!part) return musicXml;

  for (const m of part.measures) {
    const num = measureNum(m);
    if (num < startMeasure || num > endMeasure) continue;

    const notes = m.entries.filter(
      (e): e is NoteEntry => e.type === "note" && !e.rest
    );
    if (!notes.length) continue;

    if (num === startMeasure) {
      const first = notes[0];
      if (!first.notations) first.notations = [];
      first.notations.push({ type: "slur", slurType: "start", number: 1 });
    }
    if (num === endMeasure) {
      const last = notes[notes.length - 1];
      if (!last.notations) last.notations = [];
      last.notations.push({ type: "slur", slurType: "stop", number: 1 });
    }
  }
  return mxlSerialize(score);
}

export function removeSlurs(
  musicXml: string,
  startMeasure: number,
  endMeasure: number,
  partId?: string,
): string {
  const score = mxlParse(musicXml);
  for (const part of score.parts) {
    if (partId && part.id !== partId) continue;
    for (const m of part.measures) {
      const num = measureNum(m);
      if (num < startMeasure || num > endMeasure) continue;
      for (const e of m.entries) {
        if (e.type !== "note") continue;
        const note = e as NoteEntry;
        if (note.notations) {
          note.notations = note.notations.filter(n => n.type !== "slur");
        }
      }
    }
  }
  return mxlSerialize(score);
}

// ─── addLyrics ───────────────────────────────────────────────────────────────

export function addLyrics(
  musicXml: string,
  measureNumber: number,
  syllables: string[],
  partId = "P1",
): string {
  const score = mxlParse(musicXml);
  const part = findPart(score, partId);
  if (!part) return musicXml;
  const measure = findMeasure(part, measureNumber);
  if (!measure) return musicXml;

  const notes = measure.entries.filter(
    (e): e is NoteEntry => e.type === "note" && !e.rest && !e.chord
  );

  for (let i = 0; i < Math.min(notes.length, syllables.length); i++) {
    const raw = syllables[i];
    const text = raw.replace(/-$/, ""); // strip trailing hyphen
    const hasDash = raw.endsWith("-");

    // Determine syllabic: look at context
    const prevHadDash = i > 0 && syllables[i - 1].endsWith("-");
    let syllabic: MxlLyric["syllabic"];
    if (prevHadDash && hasDash) syllabic = "middle";
    else if (prevHadDash)        syllabic = "end";
    else if (hasDash)            syllabic = "begin";
    else                         syllabic = "single";

    // Replace existing lyric on this note
    notes[i].lyrics = [{ text, syllabic }];
  }

  return mxlSerialize(score);
}

// ─── addFermata ──────────────────────────────────────────────────────────────

export function addFermata(
  musicXml: string,
  measureNumber: number,
  beat?: number,
  type: "upright" | "inverted" = "upright",
  partId = "P1",
): string {
  const score = mxlParse(musicXml);
  const divisions = getDivisions(score);
  const part = findPart(score, partId);
  if (!part) return musicXml;
  const measure = findMeasure(part, measureNumber);
  if (!measure) return musicXml;

  const notes = measure.entries.filter(
    (e): e is NoteEntry => e.type === "note" && !e.rest
  );
  if (!notes.length) return musicXml;

  let target: NoteEntry;
  if (beat != null) {
    // Find note closest to the requested beat position
    const targetTick = Math.round((beat - 1) * divisions);
    let tick = 0;
    let best = notes[0];
    let bestDist = Infinity;
    for (const entry of measure.entries) {
      if (entry.type === "note") {
        const note = entry as NoteEntry;
        const dist = Math.abs(tick - targetTick);
        if (!note.rest && !note.chord && dist < bestDist) {
          bestDist = dist;
          best = note;
        }
        if (!note.chord) tick += note.duration;
      }
    }
    target = best;
  } else {
    target = notes[notes.length - 1];
  }

  if (!target.notations) target.notations = [];
  target.notations.push({ type: "fermata", fermataType: type });

  return mxlSerialize(score);
}

// ─── addOttava ───────────────────────────────────────────────────────────────

export function addOttava(
  musicXml: string,
  startMeasure: number,
  endMeasure: number,
  ottava: "8va" | "8vb" | "15ma" | "15mb" = "8va",
  partId = "P1",
): string {
  const score = mxlParse(musicXml);
  const ottavaType = ottava === "8va" || ottava === "15ma" ? "down" : "up";
  const size = ottava.startsWith("15") ? 15 : 8;

  for (const part of score.parts) {
    if (part.id !== partId) continue;
    for (const m of part.measures) {
      const num = measureNum(m);
      if (num === startMeasure) {
        const dir: DirectionEntry = {
          _id: generateId(),
          type: "direction",
          placement: "above",
          directionTypes: [{ kind: "octave-shift", type: ottavaType as "up" | "down" | "stop", size }],
        };
        const idx = m.entries.findIndex(e => e.type === "note");
        if (idx !== -1) m.entries.splice(idx, 0, dir);
        else m.entries.push(dir);
      }
      if (num === endMeasure) {
        const stop: DirectionEntry = {
          _id: generateId(),
          type: "direction",
          placement: "above",
          directionTypes: [{ kind: "octave-shift", type: "stop", size }],
        };
        m.entries.push(stop);
      }
    }
  }
  return mxlSerialize(score);
}

// ─── addPedalMarking ─────────────────────────────────────────────────────────

export function addPedalMarking(
  musicXml: string,
  startMeasure: number,
  endMeasure: number,
  partId = "P1",
): string {
  const score = mxlParse(musicXml);
  for (const part of score.parts) {
    if (part.id !== partId) continue;
    for (const m of part.measures) {
      const num = measureNum(m);
      if (num === startMeasure) {
        const dir: DirectionEntry = {
          _id: generateId(),
          type: "direction",
          placement: "below",
          directionTypes: [{ kind: "pedal", type: "start", line: true }],
        };
        const idx = m.entries.findIndex(e => e.type === "note");
        if (idx !== -1) m.entries.splice(idx, 0, dir);
        else m.entries.push(dir);
      }
      if (num === endMeasure) {
        const dir: DirectionEntry = {
          _id: generateId(),
          type: "direction",
          placement: "below",
          directionTypes: [{ kind: "pedal", type: "stop", line: true }],
        };
        m.entries.push(dir);
      }
    }
  }
  return mxlSerialize(score);
}

// ─── addNavigationMark ───────────────────────────────────────────────────────

export type NavigationMarkType = "segno" | "coda" | "fine" | "dacapo" | "dalsegno" | "toCoda";

export function addNavigationMark(
  musicXml: string,
  measureNumber: number,
  markType: NavigationMarkType,
  partId = "P1",
): string {
  const score = mxlParse(musicXml);
  const part = findPart(score, partId);
  if (!part) return musicXml;
  const measure = findMeasure(part, measureNumber);
  if (!measure) return musicXml;

  const idx = measure.entries.findIndex(e => e.type === "note");
  const insertAt = (entry: MeasureEntry) => {
    if (idx !== -1) measure.entries.splice(idx, 0, entry);
    else measure.entries.push(entry);
  };

  switch (markType) {
    case "segno": {
      insertAt({ _id: generateId(), type: "direction", placement: "above", directionTypes: [{ kind: "segno" }] });
      insertAt({ _id: generateId(), type: "sound", segno: "segno" } as SoundEntry);
      break;
    }
    case "coda": {
      insertAt({ _id: generateId(), type: "direction", placement: "above", directionTypes: [{ kind: "coda" }] });
      insertAt({ _id: generateId(), type: "sound", coda: "coda" } as SoundEntry);
      break;
    }
    case "fine": {
      insertAt({ _id: generateId(), type: "direction", placement: "above", directionTypes: [{ kind: "words", text: "Fine", fontWeight: "bold" }] });
      measure.entries.push({ _id: generateId(), type: "sound", fine: true } as SoundEntry);
      break;
    }
    case "dacapo": {
      measure.entries.push({ _id: generateId(), type: "direction", placement: "above", directionTypes: [{ kind: "words", text: "D.C. al Fine" }] } as DirectionEntry);
      measure.entries.push({ _id: generateId(), type: "sound", dacapo: true } as SoundEntry);
      break;
    }
    case "dalsegno": {
      measure.entries.push({ _id: generateId(), type: "direction", placement: "above", directionTypes: [{ kind: "words", text: "D.S. al Coda" }] } as DirectionEntry);
      measure.entries.push({ _id: generateId(), type: "sound", dalsegno: "segno" } as SoundEntry);
      break;
    }
    case "toCoda": {
      insertAt({ _id: generateId(), type: "direction", placement: "above", directionTypes: [{ kind: "words", text: "To Coda" }] });
      insertAt({ _id: generateId(), type: "sound", tocoda: "coda" } as SoundEntry);
      break;
    }
  }

  return mxlSerialize(score);
}

// ─── addArpeggio ─────────────────────────────────────────────────────────────

export function addArpeggio(
  musicXml: string,
  measureNumber: number,
  direction: "up" | "down" = "up",
  partId = "P1",
): string {
  const score = mxlParse(musicXml);
  const part = findPart(score, partId);
  if (!part) return musicXml;
  const measure = findMeasure(part, measureNumber);
  if (!measure) return musicXml;

  for (const entry of measure.entries) {
    if (entry.type !== "note") continue;
    const note = entry as NoteEntry;
    if (note.rest) continue;
    if (!note.notations) note.notations = [];
    note.notations.push({ type: "arpeggiate", direction });
  }
  return mxlSerialize(score);
}

// ─── addTremolo ──────────────────────────────────────────────────────────────

export function addTremolo(
  musicXml: string,
  measureNumber: number,
  marks: 1 | 2 | 3 = 3,
  partId = "P1",
): string {
  const score = mxlParse(musicXml);
  const part = findPart(score, partId);
  if (!part) return musicXml;
  const measure = findMeasure(part, measureNumber);
  if (!measure) return musicXml;

  for (const entry of measure.entries) {
    if (entry.type !== "note") continue;
    const note = entry as NoteEntry;
    if (note.rest) continue;
    if (!note.notations) note.notations = [];
    note.notations.push({
      type: "ornament",
      ornament: "tremolo",
      tremoloMarks: marks,
      tremoloType: "single",
    });
  }
  return mxlSerialize(score);
}

// ─── addGlissando ────────────────────────────────────────────────────────────

export function addGlissando(
  musicXml: string,
  startMeasure: number,
  endMeasure: number,
  lineType: "solid" | "wavy" = "wavy",
  partId = "P1",
): string {
  const score = mxlParse(musicXml);
  const part = findPart(score, partId);
  if (!part) return musicXml;

  const sameM = startMeasure === endMeasure;

  for (const m of part.measures) {
    const num = measureNum(m);
    if (num < startMeasure || num > endMeasure) continue;

    const notes = m.entries.filter(
      (e): e is NoteEntry => e.type === "note" && !e.rest
    );
    if (!notes.length) continue;

    if (num === startMeasure) {
      const note = sameM ? notes[0] : notes[notes.length - 1];
      if (!note.notations) note.notations = [];
      note.notations.push({ type: "glissando", glissandoType: "start", lineType, number: 1 });
    }
    if (num === endMeasure && !sameM) {
      const note = notes[0];
      if (!note.notations) note.notations = [];
      note.notations.push({ type: "glissando", glissandoType: "stop", lineType, number: 1 });
    }
    if (sameM && notes.length >= 2) {
      // Also add stop to last note in same measure
      const last = notes[notes.length - 1];
      if (!last.notations) last.notations = [];
      last.notations.push({ type: "glissando", glissandoType: "stop", lineType, number: 1 });
    }
  }
  return mxlSerialize(score);
}

// ─── addBreathMark ───────────────────────────────────────────────────────────

export function addBreathMark(
  musicXml: string,
  measureNumber: number,
  partId = "P1",
): string {
  const score = mxlParse(musicXml);
  const part = findPart(score, partId);
  if (!part) return musicXml;
  const measure = findMeasure(part, measureNumber);
  if (!measure) return musicXml;

  const notes = measure.entries.filter(
    (e): e is NoteEntry => e.type === "note" && !e.rest
  );
  if (!notes.length) return musicXml;

  const last = notes[notes.length - 1];
  if (!last.notations) last.notations = [];
  last.notations.push({ type: "articulation", articulation: "breath-mark" });

  return mxlSerialize(score);
}

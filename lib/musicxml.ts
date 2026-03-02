import {
  parse as mxlParse,
  serialize as mxlSerialize,
  generateId,
  transpose as mxlTranspose,
  removePart as mxlRemovePart,
} from "musicxml-io";
import type {
  Score, Part, Measure, MeasureEntry, NoteEntry, Pitch,
  MeasureAttributes, DirectionEntry, DirectionType,
  BackupEntry, Barline, NoteType, Notation, Lyric as MxlLyric,
  PartInfo, DynamicsValue, ScoreMetadata,
} from "musicxml-io";

// SoundEntry is not re-exported by musicxml-io, define locally
type SoundEntry = Extract<MeasureEntry, { type: "sound" }>;

type HarmonyEntry = Extract<MeasureEntry, { type: "harmony" }>;
type ArticulationNotation = Extract<Notation, { type: "articulation" }>;

// ─── Score model helpers ────────────────────────────────────────────────────

function findPart(score: Score, partId: string): Part | undefined {
  return score.parts.find(p => p.id === partId);
}

function findPartInfo(score: Score, partId: string): PartInfo | undefined {
  return score.partList.find(
    (e): e is PartInfo => e.type === "score-part" && e.id === partId
  );
}

function measureNum(m: Measure): number {
  return parseInt(m.number) || 0;
}

function findMeasure(part: Part, num: number): Measure | undefined {
  return part.measures.find(m => measureNum(m) === num);
}

function getDivisions(score: Score): number {
  for (const p of score.parts) {
    for (const m of p.measures) {
      if (m.attributes?.divisions) return m.attributes.divisions;
    }
  }
  return 4;
}

function getBeats(score: Score): number {
  for (const p of score.parts) {
    for (const m of p.measures) {
      if (m.attributes?.time) return parseInt(m.attributes.time.beats) || 4;
    }
  }
  return 4;
}

function getBeatType(score: Score): number {
  for (const p of score.parts) {
    for (const m of p.measures) {
      if (m.attributes?.time) return m.attributes.time.beatType || 4;
    }
  }
  return 4;
}

function getFifths(score: Score): number {
  for (const p of score.parts) {
    for (const m of p.measures) {
      if (m.attributes?.key) return m.attributes.key.fifths;
    }
  }
  return 0;
}

function notes(entries: MeasureEntry[]): NoteEntry[] {
  return entries.filter((e): e is NoteEntry => e.type === "note");
}

function wholeRest(duration: number, staff?: number, voice?: number): NoteEntry {
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

function measureDuration(score: Score): number {
  const divisions = getDivisions(score);
  const beats = getBeats(score);
  const beatType = getBeatType(score);
  return Math.round(divisions * beats * (4 / beatType));
}

function emptyMeasure(num: number, duration: number): Measure {
  return {
    _id: generateId(),
    number: String(num),
    entries: [wholeRest(duration)],
  };
}

// ─── fixPercussionDisplayOctave ──────────────────────────────────────────────

export function fixPercussionDisplayOctave(musicXml: string): string {
  const score = mxlParse(musicXml);
  for (const part of score.parts) {
    const isPerc = part.measures.some(m =>
      m.attributes?.clef?.some(c => c.sign === "percussion")
    );
    if (!isPerc) continue;
    for (const m of part.measures) {
      for (const entry of m.entries) {
        if (entry.type === "note" && entry.unpitched) {
          entry.unpitched.displayStep = "B";
          entry.unpitched.displayOctave = 4;
        }
      }
    }
  }
  return mxlSerialize(score);
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
    const knownIds = new Set(
      score.partList
        .filter((e): e is PartInfo => e.type === "score-part")
        .map(sp => sp.id)
    );
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
  } catch { /* best-effort */ }

  return result;
}

export function extractSelectedMeasures(
  musicXml: string,
  measureNumbers: number[]
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
  sentMeasureNumbers?: number[]
): string {
  const hasPartWrappers = /<part[\s>]/.test(modifiedMeasuresXml);
  if (hasPartWrappers) {
    return spliceMeasuresBackPerPart(musicXml, modifiedMeasuresXml, sentMeasureNumbers);
  }
  return spliceMeasuresBackGlobal(musicXml, modifiedMeasuresXml, sentMeasureNumbers);
}

function spliceMeasuresBackPerPart(
  musicXml: string,
  modifiedMeasuresXml: string,
  sentMeasureNumbers?: number[]
): string {
  // Parse modified measures to extract per-part map
  let modScore: Score;
  try {
    modScore = mxlParse(modifiedMeasuresXml);
  } catch {
    // Might be a partial XML — wrap it
    modScore = mxlParse(
      `<?xml version="1.0"?><score-partwise version="3.1"><part-list></part-list>${modifiedMeasuresXml}</score-partwise>`
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
      .filter(m => !deleted.has(measureNum(m)))
      .map(m => {
        const replacement = mm.get(measureNum(m));
        return replacement ?? m;
      });
  }

  let result = mxlSerialize(score);
  if (anyDeleted) result = renumberMeasures(result);
  return result;
}

function spliceMeasuresBackGlobal(
  musicXml: string,
  modifiedMeasuresXml: string,
  sentMeasureNumbers?: number[]
): string {
  // Parse modified measures (wrapped in a temp structure)
  let modScore: Score;
  try {
    modScore = mxlParse(
      `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name/></score-part></part-list><part id="P1">${modifiedMeasuresXml}</part></score-partwise>`
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
      .filter(m => !deletedNumbers.has(measureNum(m)))
      .map(m => {
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

// ─── deleteMeasures ─────────────────────────────────────────────────────────

export function deleteMeasures(musicXml: string, measureNumbers: number[]): string {
  const toDelete = new Set(measureNumbers);
  const score = mxlParse(musicXml);
  for (const part of score.parts) {
    part.measures = part.measures.filter(m => !toDelete.has(measureNum(m)));
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
        m.entries = m.entries.filter(e => {
          if (e.type !== "note") return true;
          const noteStaff = (e as NoteEntry).staff ?? 1;
          return noteStaff !== staff;
        });
        // Add a whole rest for the cleared staff
        m.entries.push(wholeRest(dur, staff, staff === 2 ? 5 : 1));
      } else {
        // Preserve attributes, direction, barline entries
        const preserved = m.entries.filter(e =>
          e.type === "direction" || e.type === "attributes"
        );
        const preservedBarlines = m.barlines;

        m.entries = [...preserved, wholeRest(dur)];
        m.barlines = preservedBarlines;
      }
    }
  }
  return mxlSerialize(score);
}

// ─── insertEmptyMeasures ────────────────────────────────────────────────────

export function insertEmptyMeasures(
  musicXml: string,
  afterMeasure: number,
  count: number
): string {
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
      const idx = part.measures.findIndex(m => measureNum(m) === afterMeasure);
      if (idx !== -1) {
        part.measures = [
          ...part.measures.slice(0, idx + 1),
          ...newMeasures,
          ...part.measures.slice(idx + 1),
        ];
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
      part.measures = [
        ...part.measures.slice(0, lastIdx + 1),
        ...toDuplicate,
        ...part.measures.slice(lastIdx + 1),
      ];
    }
  }
  return renumberMeasures(mxlSerialize(score));
}

// ─── repeatSection ──────────────────────────────────────────────────────────

export function repeatSection(
  musicXml: string,
  startMeasure: number,
  endMeasure: number,
  times: number
): string {
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
      part.measures = [
        ...part.measures.slice(0, endIdx + 1),
        ...copies,
        ...part.measures.slice(endIdx + 1),
      ];
    }
  }
  return renumberMeasures(mxlSerialize(score));
}

// ─── transposeMeasures ──────────────────────────────────────────────────────

export function transposeMeasures(
  musicXml: string,
  measureNumbers: number[] | null,
  semitones: number
): string {
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
          const result = transposePitch(
            entry.pitch.step, entry.pitch.alter ?? 0, entry.pitch.octave, semitones
          );
          entry.pitch.step = result.step as Pitch["step"];
          entry.pitch.alter = result.alter || undefined;
          entry.pitch.octave = result.octave;
        }
      }
    }
  }
  return mxlSerialize(score);
}

// ─── setTempo ───────────────────────────────────────────────────────────────

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

function buildTempoDirection(bpm: number, beatUnit: NoteType): DirectionEntry {
  return {
    _id: generateId(),
    type: "direction",
    placement: "above",
    directionTypes: [{
      kind: "metronome",
      beatUnit,
      perMinute: bpm,
    }],
    sound: { tempo: bpm },
  };
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

// ─── addArticulations ───────────────────────────────────────────────────────

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

// ─── removeArticulations ────────────────────────────────────────────────────

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

// ─── changeKey ──────────────────────────────────────────────────────────────

const KEY_NAME_TO_FIFTHS: Record<string, number> = {
  "Cb major": -7, "Gb major": -6, "Db major": -5, "Ab major": -4,
  "Eb major": -3, "Bb major": -2, "F major": -1, "C major": 0,
  "G major": 1, "D major": 2, "A major": 3, "E major": 4,
  "B major": 5, "F# major": 6, "C# major": 7,
  "Ab minor": -7, "Eb minor": -6, "Bb minor": -5, "F minor": -4,
  "C minor": -3, "G minor": -2, "D minor": -1, "A minor": 0,
  "E minor": 1, "B minor": 2, "F# minor": 3, "C# minor": 4,
  "G# minor": 5, "D# minor": 6, "A# minor": 7,
};

function fifthsToSemitones(oldFifths: number, newFifths: number): number {
  let semitones = ((newFifths - oldFifths) * 7) % 12;
  if (semitones > 6) semitones -= 12;
  if (semitones < -6) semitones += 12;
  return semitones;
}

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

export function scaleNoteDurations(
  musicXml: string,
  measureNumbers: number[],
  factor: number
): string {
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

// ─── pitch transposition helpers ────────────────────────────────────────────

const NOTES: [string, number][] = [
  ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0],
  ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
];

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function transposePitch(
  step: string,
  alter: number,
  octave: number,
  semitones: number
): { step: string; alter: number; octave: number } {
  const baseSemitone = NOTE_TO_SEMITONE[step] + alter;
  let totalSemitone = baseSemitone + semitones;
  let newOctave = octave;

  while (totalSemitone >= 12) { totalSemitone -= 12; newOctave++; }
  while (totalSemitone < 0) { totalSemitone += 12; newOctave--; }

  const [newStep, newAlter] = NOTES[totalSemitone];
  return { step: newStep, alter: newAlter, octave: newOctave };
}

// ─── setMeasureNotes ────────────────────────────────────────────────────────

export type NoteSpec = {
  step?: "C" | "D" | "E" | "F" | "G" | "A" | "B";
  octave?: number;
  alter?: number;
  duration: "whole" | "half" | "quarter" | "eighth" | "16th" |
            "dotted-whole" | "dotted-half" | "dotted-quarter" | "dotted-eighth" |
            "half-triplet" | "quarter-triplet" | "eighth-triplet" | "16th-triplet";
  chord?: boolean;
  rest?: boolean;
  tie?: "start" | "stop" | "both";
  slur?: "start" | "stop";
  tuplet?: "start" | "stop";
  ornament?: "trill" | "mordent" | "inverted-mordent" | "turn";
  articulation?: "staccato" | "accent" | "tenuto" | "marcato" | "staccatissimo";
  lyric?: { text: string; syllabic?: "single" | "begin" | "middle" | "end"; verse?: number };
};

const BASE_TYPE_MAP: Record<string, { type: NoteType; quarterMultiplier: number; dotted: boolean; triplet?: boolean }> = {
  "whole":           { type: "whole",   quarterMultiplier: 4,    dotted: false },
  "half":            { type: "half",    quarterMultiplier: 2,    dotted: false },
  "quarter":         { type: "quarter", quarterMultiplier: 1,    dotted: false },
  "eighth":          { type: "eighth",  quarterMultiplier: 0.5,  dotted: false },
  "16th":            { type: "16th",    quarterMultiplier: 0.25, dotted: false },
  "dotted-whole":    { type: "whole",   quarterMultiplier: 6,    dotted: true  },
  "dotted-half":     { type: "half",    quarterMultiplier: 3,    dotted: true  },
  "dotted-quarter":  { type: "quarter", quarterMultiplier: 1.5,  dotted: true  },
  "dotted-eighth":   { type: "eighth",  quarterMultiplier: 0.75, dotted: true  },
  "half-triplet":    { type: "half",    quarterMultiplier: 4/3,  dotted: false, triplet: true },
  "quarter-triplet": { type: "quarter", quarterMultiplier: 2/3,  dotted: false, triplet: true },
  "eighth-triplet":  { type: "eighth",  quarterMultiplier: 1/3,  dotted: false, triplet: true },
  "16th-triplet":    { type: "16th",    quarterMultiplier: 1/6,  dotted: false, triplet: true },
};

export function notesTotalBeats(notes: NoteSpec[]): number {
  return notes
    .filter((n) => !n.chord)
    .reduce((sum, n) => sum + (BASE_TYPE_MAP[n.duration]?.quarterMultiplier ?? 0), 0);
}

function noteSpecToEntry(note: NoteSpec, divisions: number, staff?: number): NoteEntry {
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

  if (note.rest) {
    entry.rest = {};
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

  if (staff) {
    entry.voice = String(staff === 2 ? 5 : 1);
    entry.staff = staff;
  }

  if (info.dotted) entry.dots = 1;
  if (info.triplet) {
    entry.timeModification = { actualNotes: 3, normalNotes: 2 };
  }

  // Lyric
  if (note.lyric) {
    entry.lyrics = [{
      number: note.lyric.verse ?? 1,
      syllabic: note.lyric.syllabic ?? "single",
      text: note.lyric.text,
    }];
  }

  // Notations
  const notations: Notation[] = [];
  if (note.tie === "stop" || note.tie === "both") notations.push({ type: "tied", tiedType: "stop" });
  if (note.tie === "start" || note.tie === "both") notations.push({ type: "tied", tiedType: "start" });
  if (note.slur === "start") notations.push({ type: "slur", slurType: "start", number: 1 });
  if (note.slur === "stop") notations.push({ type: "slur", slurType: "stop", number: 1 });
  if (note.ornament) {
    const ornMap: Record<string, string> = {
      "trill": "trill-mark", "mordent": "mordent",
      "inverted-mordent": "inverted-mordent", "turn": "turn",
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
    notations.push({ type: "tuplet", tupletType: "start", bracket: true });
  }
  if (note.tuplet === "stop") {
    notations.push({ type: "tuplet", tupletType: "stop" });
  }

  if (notations.length > 0) entry.notations = notations;

  return entry;
}

// ─── triplet division helpers ───────────────────────────────────────────────

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
function lcmInt(a: number, b: number): number { return Math.round((a / gcd(a, b)) * b); }

function ensureTripletDivisions(musicXml: string): string {
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

export function setMeasureNotes(
  musicXml: string,
  measureNumber: number,
  notes: NoteSpec[],
  partId: string = "P1",
  staff?: number
): string {
  // Auto-insert missing measures
  const score0 = mxlParse(musicXml);
  const firstPart = score0.parts[0];
  const currentCount = firstPart ? firstPart.measures.length : 0;
  if (measureNumber > currentCount) {
    musicXml = insertEmptyMeasures(musicXml, currentCount, measureNumber - currentCount);
  }

  // Upgrade divisions if triplets needed
  const hasTriplets = notes.some(n => BASE_TYPE_MAP[n.duration]?.triplet);
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
  const preserved = measure.entries.filter(e =>
    e.type === "direction" || e.type === "attributes" || e.type === "harmony"
  );
  const preservedBarlines = measure.barlines;

  const noteEntries = notes.map(n => noteSpecToEntry(n, divisions, effectiveStaff));

  if (!effectiveStaff) {
    measure.entries = [...preserved, ...noteEntries];
  } else {
    // Staff-aware: keep other staff's notes
    const otherStaff = staff === 1 ? 2 : 1;
    const otherNotes = measure.entries.filter(e =>
      e.type === "note" && (e as NoteEntry).staff === otherStaff
    );

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

// ─── setTimeSignature ───────────────────────────────────────────────────────

export function setTimeSignature(
  musicXml: string,
  beats: number,
  beatType: number,
  fromMeasure: number = 1
): string {
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

// ─── helpers ────────────────────────────────────────────────────────────────

function buildContext(musicXml: string): string {
  const score = mxlParse(musicXml);
  const instruments = score.partList
    .filter((e): e is PartInfo => e.type === "score-part")
    .map(pi => pi.name?.trim())
    .filter(Boolean)
    .join(", ");

  const fifths = getFifths(score);
  const key = fifthsToKey(fifths);
  const beats = getBeats(score);
  const beatType = getBeatType(score);

  const first = score.parts[0];
  const measureCount = first ? first.measures.length : 0;

  const tempo = getTempo(musicXml);
  const tempoStr = tempo ? ` | Tempo: ${tempo.bpm} BPM` : "";

  return `Instruments: ${instruments || "unknown"} | Key: ${key} | Time: ${beats}/${beatType} | Measures: ${measureCount}${tempoStr}`;
}

function fifthsToKey(fifths: number): string {
  const keys = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
  return (keys[fifths + 7] ?? "C") + " major";
}

// ─── createScore ────────────────────────────────────────────────────────────

const KEY_ROOT_TO_FIFTHS: Record<string, number> = {
  "Cb": -7, "Gb": -6, "Db": -5, "Ab": -4, "Eb": -3, "Bb": -2, "F": -1,
  "C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7,
};

const GRAND_STAFF_INSTRUMENTS = new Set([
  "piano", "keyboard", "organ", "harpsichord", "marimba", "vibraphone",
  "celesta", "harp", "accordion",
]);

function instrumentStaves(name: string): number {
  return GRAND_STAFF_INSTRUMENTS.has(name.toLowerCase()) ? 2 : 1;
}

function clefToSignLine(clef: string): { sign: "G" | "F" | "C"; line: number } {
  if (clef === "bass")  return { sign: "F", line: 4 };
  if (clef === "alto")  return { sign: "C", line: 3 };
  if (clef === "tenor") return { sign: "C", line: 4 };
  return { sign: "G", line: 2 };
}

export type ScoreInstrument = {
  name: string;
  staves?: number;
  midiProgram?: number;
  clef?: "treble" | "bass" | "alto" | "tenor";
};

export function createScore(options: {
  instruments: ScoreInstrument[];
  key?: string;
  beats?: number;
  beatType?: number;
  tempo?: number;
  measures?: number;
  pickupBeats?: number;
}): string {
  const {
    instruments, key = "C", beats = 4, beatType = 4,
    tempo = 120, measures: measureCount = 4, pickupBeats,
  } = options;

  const fifths = KEY_ROOT_TO_FIFTHS[key] ?? 0;
  const divisions = 12;
  const dur = Math.round(divisions * beats * (4 / beatType));

  const score: Score = {
    _id: generateId(),
    metadata: {},
    partList: [],
    parts: [],
    version: "3.1",
  };

  for (let i = 0; i < instruments.length; i++) {
    const inst = instruments[i];
    const id = `P${i + 1}`;
    const staves = inst.staves ?? instrumentStaves(inst.name);
    const midiChannel = (i + 1) >= 10 ? i + 2 : i + 1;
    const midiProgram = inst.midiProgram ?? 1;

    // Part list entry
    const partInfo: PartInfo = {
      _id: generateId(),
      type: "score-part",
      id,
      name: inst.name,
      scoreInstruments: [{ id: `${id}-I1`, name: inst.name }],
      midiInstruments: [{
        id: `${id}-I1`,
        channel: midiChannel,
        program: midiProgram,
        volume: 78.7402,
        pan: 0,
      }],
    };
    score.partList.push(partInfo);

    // Part with measures
    const part: Part = { _id: generateId(), id, measures: [] };

    for (let mi = 0; mi < measureCount; mi++) {
      const num = mi + 1;
      const isFirst = mi === 0;
      const isPickup = isFirst && pickupBeats != null;

      const measure: Measure = {
        _id: generateId(),
        number: String(num),
        ...(isPickup ? { implicit: true } : {}),
        entries: [],
      };

      if (isFirst) {
        const clefs = staves === 1
          ? [{ ...clefToSignLine(inst.clef ?? "treble") }]
          : [
              { sign: "G" as const, line: 2, staff: 1 },
              { sign: "F" as const, line: 4, staff: 2 },
            ];

        measure.attributes = {
          divisions,
          key: { fifths },
          time: { beats: String(beats), beatType },
          ...(staves > 1 ? { staves } : {}),
          clef: clefs,
        };

        // Tempo direction
        measure.entries.push(buildTempoDirection(tempo, "quarter"));
      }

      const thisDuration = isPickup ? Math.round(divisions * pickupBeats! * (4 / beatType)) : dur;

      for (let s = 0; s < staves; s++) {
        if (s > 0) {
          measure.entries.push({
            _id: generateId(),
            type: "backup",
            duration: thisDuration,
          } as BackupEntry);
        }
        const voice = staves > 1 ? (s === 0 ? 1 : 5) : undefined;
        const staffNum = staves > 1 ? s + 1 : undefined;
        measure.entries.push(wholeRest(thisDuration, staffNum, voice));
      }

      part.measures.push(measure);
    }
    score.parts.push(part);
  }

  return mxlSerialize(score);
}

// ─── addChordSymbols ────────────────────────────────────────────────────────

export type ChordSymbol = {
  root: string;
  kind: string;
  beat?: number;
  bass?: string;
};

const CHORD_KIND_MAP: Record<string, { xml: string; text: string }> = {
  "":      { xml: "major",               text: ""     },
  "M":     { xml: "major",               text: ""     },
  "major": { xml: "major",               text: ""     },
  "m":     { xml: "minor",               text: "m"    },
  "minor": { xml: "minor",               text: "m"    },
  "7":     { xml: "dominant",            text: "7"    },
  "maj7":  { xml: "major-seventh",       text: "maj7" },
  "M7":    { xml: "major-seventh",       text: "maj7" },
  "m7":    { xml: "minor-seventh",       text: "m7"   },
  "dim":   { xml: "diminished",          text: "dim"  },
  "dim7":  { xml: "diminished-seventh",  text: "dim7" },
  "aug":   { xml: "augmented",           text: "aug"  },
  "m7b5":  { xml: "half-diminished",     text: "m7b5" },
  "sus2":  { xml: "suspended-second",    text: "sus2" },
  "sus4":  { xml: "suspended-fourth",    text: "sus4" },
};

export function addChordSymbols(
  musicXml: string,
  measureNumber: number,
  chords: ChordSymbol[],
  partId: string = "P1"
): { xml: string; error?: string } {
  const score = mxlParse(musicXml);
  const divisions = getDivisions(score);
  const beatType = getBeatType(score);
  const beatTicks = Math.round(divisions * (4 / beatType));

  const part = findPart(score, partId);
  if (!part) return { xml: musicXml, error: `Part '${partId}' not found` };

  const totalMeasures = part.measures.length;
  const measure = findMeasure(part, measureNumber);
  if (!measure) return { xml: musicXml, error: `Measure ${measureNumber} does not exist (score has ${totalMeasures} measures). Call insertEmptyMeasures first to add more measures.` };

  // Remove any existing chord symbols in this measure before inserting new ones
  measure.entries = measure.entries.filter(e => e.type !== "harmony");

  const firstNoteIdx = measure.entries.findIndex(e => e.type === "note");

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

export function changeInstrument(
  musicXml: string,
  partId: string,
  instrument: ScoreInstrument,
): string {
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
  staffNumber?: number
): string {
  const { sign, line } = clefToSignLine(clef);
  const score = mxlParse(musicXml);

  const part = findPart(score, partId);
  if (!part) return musicXml;

  const firstMeasure = part.measures[0];
  if (!firstMeasure?.attributes?.clef) return musicXml;

  const clefs = firstMeasure.attributes.clef;

  if (staffNumber != null) {
    const target = clefs.find(c => c.staff === staffNumber);
    if (target) {
      target.sign = sign;
      target.line = line;
    } else {
      clefs.push({ sign, line, staff: staffNumber });
    }
  } else {
    const target = clefs.find(c => !c.staff) ?? clefs[0];
    if (target) {
      target.sign = sign;
      target.line = line;
    }
  }

  return mxlSerialize(score);
}

// ─── nextMidiChannel ────────────────────────────────────────────────────────

function nextMidiChannel(score: Score): number {
  const used = new Set<number>();
  for (const entry of score.partList) {
    if (entry.type === "score-part" && entry.midiInstruments) {
      for (const mi of entry.midiInstruments) {
        if (mi.channel) used.add(mi.channel);
      }
    }
  }
  for (let ch = 1; ch <= 16; ch++) {
    if (ch !== 10 && !used.has(ch)) return ch;
  }
  return 1;
}

// ─── addPart ────────────────────────────────────────────────────────────────

export function addPart(musicXml: string, instrument: ScoreInstrument): string {
  const score = mxlParse(musicXml);

  // Find next part ID
  const existingNums = score.parts.map(p => parseInt(p.id.replace("P", "")) || 0);
  const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
  const partId = `P${nextNum}`;
  const staves = instrument.staves ?? instrumentStaves(instrument.name);

  // Read score parameters
  const firstPart = score.parts[0];
  const measureCount = firstPart ? firstPart.measures.length : 4;
  const divisions = getDivisions(score);
  const beats = getBeats(score);
  const beatType = getBeatType(score);
  const fifths = getFifths(score);
  const dur = Math.round(divisions * beats * (4 / beatType));

  const midiChannel = nextMidiChannel(score);
  const midiProgram = instrument.midiProgram ?? 1;

  // Add to part-list
  const partInfo: PartInfo = {
    _id: generateId(),
    type: "score-part",
    id: partId,
    name: instrument.name,
    scoreInstruments: [{ id: `${partId}-I1`, name: instrument.name }],
    midiInstruments: [{
      id: `${partId}-I1`,
      channel: midiChannel,
      program: midiProgram,
      volume: 78.7402,
      pan: 0,
    }],
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
      const clefInfo = clefToSignLine(instrument.clef ?? "treble");
      const clefs = staves === 1
        ? [{ ...clefInfo }]
        : [
            { sign: "G" as const, line: 2, staff: 1 },
            { sign: "F" as const, line: 4, staff: 2 },
          ];

      measure.attributes = {
        divisions,
        key: { fifths },
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

// ─── movePart ───────────────────────────────────────────────────────────────

export function movePart(musicXml: string, partId: string, direction: "up" | "down"): string {
  const score = mxlParse(musicXml);

  // Find part-list index
  const plIdx = score.partList.findIndex(
    (e): e is PartInfo => e.type === "score-part" && e.id === partId
  );
  if (plIdx === -1) throw new Error(`Part "${partId}" not found`);

  // Find next/prev score-part (skip part-groups)
  const swapPlIdx = direction === "up"
    ? [...score.partList.slice(0, plIdx)].reverse().findIndex(e => e.type === "score-part")
    : score.partList.slice(plIdx + 1).findIndex(e => e.type === "score-part");

  const actualSwapPlIdx = direction === "up"
    ? plIdx - 1 - swapPlIdx
    : plIdx + 1 + swapPlIdx;

  if (swapPlIdx === -1 || actualSwapPlIdx < 0 || actualSwapPlIdx >= score.partList.length) {
    throw new Error(`Cannot move part "${partId}" ${direction} — already at boundary`);
  }

  // Swap in part-list
  [score.partList[plIdx], score.partList[actualSwapPlIdx]] =
    [score.partList[actualSwapPlIdx], score.partList[plIdx]];

  // Swap in parts array
  const pIdx = score.parts.findIndex(p => p.id === partId);
  const pSwap = direction === "up" ? pIdx - 1 : pIdx + 1;
  if (pIdx !== -1 && pSwap >= 0 && pSwap < score.parts.length) {
    [score.parts[pIdx], score.parts[pSwap]] =
      [score.parts[pSwap], score.parts[pIdx]];
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
function percentToSwingRatio(percent: number): { first: number; second: number } {
  // Common named ratios
  if (percent <= 50) return { first: 1, second: 1 };
  if (percent >= 75) return { first: 3, second: 1 };
  if (percent >= 65 && percent <= 68) return { first: 2, second: 1 }; // 66.7%
  if (percent >= 58 && percent <= 62) return { first: 3, second: 2 }; // 60%
  // Generic: store as p:(100-p) — exact but large numbers
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const g = gcd(percent, 100 - percent);
  return { first: percent / g, second: (100 - percent) / g };
}

/** Convert first:second back to percentage (e.g. 2:1 → 67). */
export function swingRatioToPercent(first: number, second: number): number {
  return Math.round(first / (first + second) * 100);
}

/** Remove any existing swing direction, then optionally insert a new one. */
export function setSwing(musicXml: string, swing: SwingInfo | null): string {
  // Strip any existing swing direction block we previously inserted
  let xml = musicXml.replace(
    /<direction[^>]*>\s*<direction-type>\s*<words[^>]*>Swing<\/words>\s*<\/direction-type>[\s\S]*?<\/direction>\n?/g,
    ""
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
    /<swing>\s*<first>(\d+)<\/first>\s*<second>(\d+)<\/second>\s*<swing-type>(eighth|16th)<\/swing-type>\s*<\/swing>/
  );
  if (!m) return null;
  return { first: parseInt(m[1]), second: parseInt(m[2]), swingType: m[3] as "eighth" | "16th" };
}

// ─── addSlur / removeSlurs ───────────────────────────────────────────────────

/**
 * Add a slur spanning from the first note of startMeasure to the last note of
 * endMeasure in the given part.
 */
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

/** Remove all slur notations from measures in the given range. */
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

/**
 * Attach lyrics (syllables) to consecutive non-rest notes in a measure.
 * Syllables ending with "-" are treated as "begin" or "middle"; the next
 * syllable gets "middle" or "end" syllabic value automatically.
 */
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

/**
 * Add a fermata to a note in a measure. If beat is given (1-based), the
 * fermata is placed on the note closest to that beat. Otherwise it goes on
 * the last note of the measure (most common use case).
 */
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

/**
 * Add an ottava (8va, 8vb, 15ma) spanning measures startMeasure–endMeasure.
 * The start direction is placed in startMeasure and the stop in endMeasure.
 */
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

/**
 * Add sustain pedal start/stop markings spanning measures startMeasure–endMeasure.
 */
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

// ─── setScoreMetadata / getScoreMetadata ─────────────────────────────────────

export type ScoreMetadataInput = {
  title?: string;
  subtitle?: string;
  composer?: string;
  lyricist?: string;
  arranger?: string;
  copyright?: string;
};

export function setScoreMetadata(musicXml: string, meta: ScoreMetadataInput): string {
  const score = mxlParse(musicXml);
  if (!score.metadata) score.metadata = {} as ScoreMetadata;

  if (meta.title !== undefined) score.metadata.movementTitle = meta.title;
  if (meta.subtitle !== undefined) score.metadata.workTitle = meta.subtitle;

  // Creators: composer, lyricist, arranger
  const creatorFields: { key: keyof ScoreMetadataInput; type: string }[] = [
    { key: "composer", type: "composer" },
    { key: "lyricist", type: "lyricist" },
    { key: "arranger", type: "arranger" },
  ];
  for (const { key, type } of creatorFields) {
    if (meta[key] === undefined) continue;
    if (!score.metadata.creators) score.metadata.creators = [];
    const idx = score.metadata.creators.findIndex(c => c.type === type);
    if (idx !== -1) {
      score.metadata.creators[idx].value = meta[key] as string;
    } else {
      score.metadata.creators.push({ type, value: meta[key] as string });
    }
  }

  if (meta.copyright !== undefined) {
    score.metadata.rights = [meta.copyright];
  }

  return mxlSerialize(score);
}

export function getScoreMetadata(musicXml: string): ScoreMetadataInput {
  const score = mxlParse(musicXml);
  const m = score.metadata ?? {};
  const result: ScoreMetadataInput = {};
  if (m.movementTitle) result.title = m.movementTitle;
  if (m.workTitle) result.subtitle = m.workTitle;
  if (m.rights?.length) result.copyright = m.rights[0];
  for (const creator of m.creators ?? []) {
    if (creator.type === "composer") result.composer = creator.value;
    else if (creator.type === "lyricist") result.lyricist = creator.value;
    else if (creator.type === "arranger") result.arranger = creator.value;
  }
  return result;
}

// ─── addNavigationMark ───────────────────────────────────────────────────────

export type NavigationMarkType = "segno" | "coda" | "fine" | "dacapo" | "dalsegno" | "toCoda";

/**
 * Add a navigation mark (segno, coda, fine, D.C., D.S.) to a measure.
 */
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

/**
 * Add arpeggiate notation to all chord notes in a measure.
 */
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

/**
 * Add single-note tremolo (buzz roll) to all notes in a measure.
 * marks: number of beams (1=eighth, 2=sixteenth, 3=thirty-second tremolo).
 */
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

/**
 * Add a glissando from the last note of startMeasure to the first note of
 * endMeasure (or within a single measure if start === end).
 */
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

/**
 * Add a breath mark (caesura pause) after the last note of a measure.
 */
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

import {
  mxlParse,
  mxlSerialize,
  generateId,
  getDivisions,
  getBeats,
  getBeatType,
  getFifths,
  fifthsToKey,
  buildContext,
  wholeRest,
  buildTempoDirection,
  clefToSignLine,
  instrumentStaves,
  KEY_ROOT_TO_FIFTHS,
} from "./musicxml-core";
import { DRUM_CATALOG } from "./musicxml-instruments";
import {
  DEFAULT_BEATS,
  DEFAULT_BEAT_TYPE,
  DEFAULT_TEMPO_BPM,
  SCORE_DIVISIONS,
  DEFAULT_MIDI_VOLUME,
  PERCUSSION_MIDI_CHANNEL,
} from "./constants";
import type {
  Score, Part, Measure, PartInfo, BackupEntry, ScoreMetadata,
} from "musicxml-io";

// Re-export buildContext and fifthsToKey from core (they are score-related)
export { buildContext, fifthsToKey };

// ─── createScore ────────────────────────────────────────────────────────────

export type ScoreInstrument = {
  name: string;
  staves?: number;
  midiProgram?: number;
  clef?: "treble" | "bass" | "alto" | "tenor";
  percussion?: boolean;
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
    instruments, key = "C", beats = DEFAULT_BEATS, beatType = DEFAULT_BEAT_TYPE,
    tempo = DEFAULT_TEMPO_BPM, measures: measureCount = 4, pickupBeats,
  } = options;

  const fifths = KEY_ROOT_TO_FIFTHS[key] ?? 0;
  const divisions = SCORE_DIVISIONS;
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
    const isPercussion = inst.percussion === true;
    const staves = isPercussion ? 1 : (inst.staves ?? instrumentStaves(inst.name));
    const midiChannel = isPercussion ? PERCUSSION_MIDI_CHANNEL : ((i + 1) >= 10 ? i + 2 : i + 1);
    const midiProgram = inst.midiProgram ?? 1;

    // Part list entry
    const partInfo: PartInfo = {
      _id: generateId(),
      type: "score-part",
      id,
      name: inst.name,
      scoreInstruments: isPercussion
        ? Object.entries(DRUM_CATALOG).map(([, drum]) => ({ id: `${id}-${drum.instrumentId}`, name: drum.instrumentName }))
        : [{ id: `${id}-I1`, name: inst.name }],
      midiInstruments: isPercussion
        ? Object.entries(DRUM_CATALOG).map(([, drum]) => ({
            id: `${id}-${drum.instrumentId}`,
            channel: PERCUSSION_MIDI_CHANNEL,
            program: 1,
            unpitched: drum.midiUnpitched,
            volume: DEFAULT_MIDI_VOLUME,
            pan: 0,
          }))
        : [{
            id: `${id}-I1`,
            channel: midiChannel,
            program: midiProgram,
            volume: DEFAULT_MIDI_VOLUME,
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
        const clefs = isPercussion
          ? [{ sign: "percussion" as const }]
          : staves === 1
            ? [{ ...clefToSignLine(inst.clef ?? "treble") }]
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

// ─── toMusicXml (alias for mxlSerialize) ───────────────────────────────────

export function toMusicXml(score: Score): string {
  return mxlSerialize(score);
}

// ─── parseMusicXml (alias for mxlParse) ────────────────────────────────────

export function parseMusicXml(musicXml: string): Score {
  return mxlParse(musicXml);
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

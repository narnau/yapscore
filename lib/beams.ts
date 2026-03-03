/**
 * Post-processes MusicXML to add correct <beam> elements to eighth-note and
 * shorter runs, grouped by quarter-note beat.
 *
 * Uses the note's <type> element (not <duration>) for position tracking, so it
 * produces correct beaming even when the LLM generates wrong duration values.
 *
 * Handles N-staff measures: each <backup> element resets the time position so
 * every staff section (1..N) is beamed independently.
 */

const BEAMABLE_TYPES = new Set(['eighth', '16th', '32nd', '64th']);

/** How many quarter notes each undotted note type occupies. */
const TYPE_QN: Record<string, number> = {
  whole: 4, half: 2, quarter: 1,
  eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
};

interface NoteData {
  original: string;
  stripped: string;  // XML with <beam> elements removed
  isRest: boolean;
  isChord: boolean;
  type: string | null;
  hasDot: boolean;
  beamable: boolean;
  /** actual-notes / normal-notes ratio from <time-modification>, e.g. 3/2 for triplets */
  tupletRatio: number;
}

type Element =
  | { kind: 'note'; data: NoteData; noteIdx: number }
  | { kind: 'backup' };

function processMeasure(measureXml: string): string {
  // Match notes and <backup> elements in document order
  const elemRe = /<note\b[^>]*>[\s\S]*?<\/note>|<backup\b[^>]*>[\s\S]*?<\/backup>/g;

  const elements: Element[] = [];
  const notes: NoteData[] = [];

  let m: RegExpExecArray | null;
  while ((m = elemRe.exec(measureXml)) !== null) {
    const xml = m[0];
    if (xml.startsWith('<backup')) {
      elements.push({ kind: 'backup' });
    } else {
      const stripped = xml.replace(/<beam\b[^>]*>[^<]*<\/beam>/g, '');
      const isRest   = xml.includes('<rest');
      const isChord  = xml.includes('<chord');
      const type     = xml.match(/<type>([^<]+)<\/type>/)?.[1].trim() ?? null;
      const hasDot   = xml.includes('<dot');
      const actualNotes  = parseInt(xml.match(/<actual-notes>(\d+)<\/actual-notes>/)?.[1] ?? '1');
      const normalNotes  = parseInt(xml.match(/<normal-notes>(\d+)<\/normal-notes>/)?.[1] ?? '1');
      const tupletRatio  = actualNotes / normalNotes;  // e.g. 3/2 for triplets
      const data: NoteData = {
        original: xml, stripped, isRest, isChord, type, hasDot,
        beamable: !isRest && type !== null && BEAMABLE_TYPES.has(type),
        tupletRatio,
      };
      elements.push({ kind: 'note', data, noteIdx: notes.length });
      notes.push(data);
    }
  }

  if (notes.length === 0) return measureXml;

  // Build beam groups: consecutive beamable non-chord notes sharing the same beat.
  // A <backup> element flushes the current group and resets position (new staff section).
  const resultXmls: string[] = notes.map(n => n.stripped);

  let pos          = 0.0;
  let currentGroup: number[] = [];  // note indices
  let currentBeat  = -1;

  function flushGroup() {
    if (currentGroup.length >= 2) {
      currentGroup.forEach((ni, gi) => {
        const tag = gi === 0 ? 'begin'
                  : gi === currentGroup.length - 1 ? 'end'
                  : 'continue';
        resultXmls[ni] = resultXmls[ni].replace(
          '</note>',
          `  <beam number="1">${tag}</beam>\n      </note>`
        );
      });
    }
    currentGroup = [];
    currentBeat  = -1;
  }

  for (const el of elements) {
    if (el.kind === 'backup') {
      flushGroup();
      pos = 0.0;  // each <backup> starts a new staff section; beam independently
      continue;
    }

    const { data, noteIdx } = el;

    if (data.isChord) continue;  // chord notes share position with the previous note

    // Round to 9 decimal places before floor to avoid accumulated float drift
    // (e.g. 1.9999999999999998 must snap to 2, not floor to 1)
    const beat = Math.floor(Math.round(pos * 1e9) / 1e9);
    const baseAdv = TYPE_QN[data.type ?? 'quarter'] ?? 1;
    const adv  = (data.hasDot ? baseAdv * 1.5 : baseAdv) / data.tupletRatio;
    pos += adv;

    if (data.isRest || !data.beamable) {
      flushGroup();
      continue;
    }

    if (beat !== currentBeat && currentGroup.length > 0) {
      flushGroup();  // crossed a beat boundary
    }

    currentGroup.push(noteIdx);
    currentBeat = beat;
  }
  flushGroup();

  // Replace note XMLs in the measure, preserving all other elements
  let noteIdx2 = 0;
  return measureXml.replace(/<note\b[^>]*>[\s\S]*?<\/note>/g, () => resultXmls[noteIdx2++] ?? '');
}

/**
 * Adds or corrects <beam> elements in a MusicXML string.
 * Safe to run on already-beamed XML: existing beam elements are replaced.
 */
export function addBeams(musicXml: string): string {
  return musicXml.replace(/<measure\b[^>]*>[\s\S]*?<\/measure>/g, processMeasure);
}

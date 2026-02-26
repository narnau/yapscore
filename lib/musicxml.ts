/**
 * Splits a MusicXML document into:
 *   - skeleton: everything except the <part> elements (header, part-list, etc.)
 *   - parts:    the raw <part>...</part> blocks (the actual music)
 *   - context:  a one-line human-readable summary (instrument, key, time sig)
 *
 * This lets us send only the musical content to the LLM instead of the full file.
 */
export function extractParts(musicXml: string): {
  skeleton: string;
  parts: string;
  context: string;
} {
  const firstPart = musicXml.indexOf("<part ");
  const lastPartEnd = musicXml.lastIndexOf("</part>") + "</part>".length;

  if (firstPart === -1) throw new Error("No <part> elements found in MusicXML");

  const skeleton =
    musicXml.slice(0, firstPart) + "__PARTS__" + musicXml.slice(lastPartEnd);
  const parts = musicXml.slice(firstPart, lastPartEnd);

  return { skeleton, parts, context: buildContext(musicXml) };
}

export function reconstructMusicXml(skeleton: string, modifiedParts: string): string {
  let parts = modifiedParts.trim();

  // Strip XML declaration if the LLM included one
  parts = parts.replace(/^<\?xml[^?]*\?>\s*/i, "");

  // If the LLM returned full MusicXML instead of just <part> elements, extract the parts
  if (/<score-partwise/i.test(parts) || /<!DOCTYPE/i.test(parts)) {
    const fp = parts.indexOf("<part ");
    const lp = parts.lastIndexOf("</part>") + "</part>".length;
    if (fp !== -1) parts = parts.slice(fp, lp);
  }

  let result = skeleton.replace("__PARTS__", parts);

  // Sync <part-list>: ensure every <part id="X"> has a matching <score-part id="X">
  const partIds   = [...parts.matchAll(/<part\s+id="([^"]+)"/g)].map(m => m[1]);
  const knownIds  = new Set([...result.matchAll(/<score-part\s+id="([^"]+)"/g)].map(m => m[1]));
  for (const id of partIds) {
    if (!knownIds.has(id)) {
      result = result.replace(
        "</part-list>",
        `  <score-part id="${id}"><part-name>Part ${id}</part-name></score-part>\n  </part-list>`
      );
      knownIds.add(id);
    }
  }

  return result;
}

/**
 * Extracts only the specified measure numbers from the MusicXML parts,
 * and returns a skeleton that can be used to splice them back.
 */
export function extractSelectedMeasures(
  musicXml: string,
  measureNumbers: number[]
): { skeleton: string; selectedMeasures: string; context: string } {
  const { skeleton, parts, context } = extractParts(musicXml);
  const nums = new Set(measureNumbers);

  const selected: string[] = [];
  for (const match of parts.matchAll(/<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g)) {
    if (nums.has(parseInt(match[1]))) selected.push(match[0]);
  }

  return { skeleton, selectedMeasures: selected.join("\n"), context };
}

/**
 * Splices modified measures back into the original MusicXML,
 * replacing only the measures with the given numbers.
 *
 * If sentMeasureNumbers is provided and a sent measure is missing from the
 * LLM response, it is treated as a deletion. After splicing, all measures
 * are renumbered sequentially.
 */
export function spliceMeasuresBack(
  musicXml: string,
  modifiedMeasuresXml: string,
  sentMeasureNumbers?: number[]
): string {
  const modifiedMap = new Map<number, string>();
  for (const match of modifiedMeasuresXml.matchAll(/<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g)) {
    modifiedMap.set(parseInt(match[1]), match[0]);
  }

  // Determine which measures were deleted (sent but not returned)
  const deletedNumbers = new Set<number>();
  if (sentMeasureNumbers) {
    for (const num of sentMeasureNumbers) {
      if (!modifiedMap.has(num)) {
        deletedNumbers.add(num);
      }
    }
  }

  // Replace modified measures, remove deleted ones
  let result = musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g,
    (original, numStr) => {
      const num = parseInt(numStr);
      if (deletedNumbers.has(num)) return ""; // Remove deleted measures
      return modifiedMap.get(num) ?? original;
    }
  );

  // Renumber measures sequentially if any were deleted
  if (deletedNumbers.size > 0) {
    result = renumberMeasures(result);
  }

  return result;
}

/**
 * Renumbers all measures sequentially starting from 1, per part.
 */
export function renumberMeasures(musicXml: string): string {
  // Process each <part> independently
  return musicXml.replace(
    /<part\b[^>]*>[\s\S]*?<\/part>/g,
    (partBlock) => {
      let counter = 0;
      return partBlock.replace(
        /(<measure\b[^>]*number=")(\d+)("[^>]*>)/g,
        (match, prefix, _num, suffix) => {
          counter++;
          return `${prefix}${counter}${suffix}`;
        }
      );
    }
  );
}

/**
 * Deletes measures by number from the MusicXML and renumbers the rest.
 */
export function deleteMeasures(musicXml: string, measureNumbers: number[]): string {
  const toDelete = new Set(measureNumbers);

  let result = musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g,
    (original, numStr) => {
      return toDelete.has(parseInt(numStr)) ? "" : original;
    }
  );

  return renumberMeasures(result);
}

/**
 * Clears measures (replaces content with a whole rest) without removing them.
 * Preserves <attributes> in the first measure if present.
 */
export function clearMeasures(musicXml: string, measureNumbers: number[]): string {
  const toClear = new Set(measureNumbers);

  // Detect divisions and time signature to compute whole-measure rest duration
  const divisions = parseInt(musicXml.match(/<divisions>(\d+)<\/divisions>/)?.[1] ?? "4");
  const beats = parseInt(musicXml.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4");
  const beatType = parseInt(musicXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4");
  const wholeDuration = divisions * beats * (4 / beatType);

  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g,
    (full, numStr, content) => {
      if (!toClear.has(parseInt(numStr))) return full;

      // Preserve <attributes> block if present (key, time, clef)
      const attrMatch = content.match(/<attributes>[\s\S]*?<\/attributes>/);
      const attrs = attrMatch ? `\n      ${attrMatch[0]}` : "";

      const tag = full.match(/<measure\b[^>]*>/)?.[0] ?? `<measure number="${numStr}">`;
      return `${tag}${attrs}\n      <note><rest/><duration>${wholeDuration}</duration><type>whole</type></note>\n    </measure>`;
    }
  );
}

/**
 * Inserts empty measures (whole rests) into the score.
 * @param afterMeasure — insert after this measure number (0 = at the beginning)
 * @param count — how many empty measures to insert
 */
export function insertEmptyMeasures(
  musicXml: string,
  afterMeasure: number,
  count: number
): string {
  const divisions = parseInt(musicXml.match(/<divisions>(\d+)<\/divisions>/)?.[1] ?? "4");
  const beats = parseInt(musicXml.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4");
  const beatType = parseInt(musicXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4");
  const wholeDuration = divisions * beats * (4 / beatType);

  const emptyMeasure = `<measure number="0">\n      <note><rest/><duration>${wholeDuration}</duration><type>whole</type></note>\n    </measure>`;
  const emptyBlock = Array(count).fill(emptyMeasure).join("\n    ");

  // Process each part independently
  let result = musicXml.replace(
    /<part\b[^>]*>[\s\S]*?<\/part>/g,
    (partBlock) => {
      if (afterMeasure === 0) {
        // Insert at the beginning, right after <part ...>
        return partBlock.replace(
          /(<part\b[^>]*>)/,
          `$1\n    ${emptyBlock}`
        );
      }
      // Insert after the specified measure
      const regex = new RegExp(
        `(<measure\\b[^>]*number="${afterMeasure}"[\\s\\S]*?<\\/measure>)`
      );
      return partBlock.replace(regex, `$1\n    ${emptyBlock}`);
    }
  );

  return renumberMeasures(result);
}

/**
 * Duplicates measures and inserts the copies immediately after the source range.
 */
export function duplicateMeasures(
  musicXml: string,
  measureNumbers: number[]
): string {
  const nums = new Set(measureNumbers);

  let result = musicXml.replace(
    /<part\b[^>]*>[\s\S]*?<\/part>/g,
    (partBlock) => {
      // Collect measures to duplicate
      const toDuplicate: string[] = [];
      for (const match of partBlock.matchAll(/<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g)) {
        if (nums.has(parseInt(match[1]))) {
          // Strip <attributes> from duplicated measures to avoid duplicate key/time/clef
          let measure = match[0];
          measure = measure.replace(/<attributes>[\s\S]*?<\/attributes>\s*/, "");
          toDuplicate.push(measure);
        }
      }

      if (toDuplicate.length === 0) return partBlock;

      // Insert duplicates after the last selected measure
      const lastNum = Math.max(...measureNumbers);
      const regex = new RegExp(
        `(<measure\\b[^>]*number="${lastNum}"[\\s\\S]*?<\\/measure>)`
      );
      return partBlock.replace(regex, `$1\n    ${toDuplicate.join("\n    ")}`);
    }
  );

  return renumberMeasures(result);
}

/**
 * Transpose notes by a number of semitones.
 * @param measureNumbers — measures to transpose (null = entire score)
 * @param semitones — positive = up, negative = down
 */
export function transposeMeasures(
  musicXml: string,
  measureNumbers: number[] | null,
  semitones: number
): string {
  const nums = measureNumbers ? new Set(measureNumbers) : null;

  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g,
    (measureBlock, numStr) => {
      if (nums && !nums.has(parseInt(numStr))) return measureBlock;

      return measureBlock.replace(
        /<pitch>([\s\S]*?)<\/pitch>/g,
        (pitchBlock, inner) => {
          const stepMatch = inner.match(/<step>([A-G])<\/step>/);
          const octaveMatch = inner.match(/<octave>(\d+)<\/octave>/);
          const alterMatch = inner.match(/<alter>(-?\d+)<\/alter>/);

          if (!stepMatch || !octaveMatch) return pitchBlock;

          const step = stepMatch[1];
          const octave = parseInt(octaveMatch[1]);
          const alter = alterMatch ? parseInt(alterMatch[1]) : 0;

          const result = transposePitch(step, alter, octave, semitones);

          let newInner = inner.replace(/<step>[A-G]<\/step>/, `<step>${result.step}</step>`);
          newInner = newInner.replace(/<octave>\d+<\/octave>/, `<octave>${result.octave}</octave>`);

          if (result.alter !== 0) {
            if (alterMatch) {
              newInner = newInner.replace(/<alter>-?\d+<\/alter>/, `<alter>${result.alter}</alter>`);
            } else {
              newInner = newInner.replace(/<step>[A-G]<\/step>/, `<step>${result.step}</step><alter>${result.alter}</alter>`);
            }
          } else if (alterMatch) {
            newInner = newInner.replace(/<alter>-?\d+<\/alter>\s*/, "");
          }

          return `<pitch>${newInner}</pitch>`;
        }
      );
    }
  );
}

/**
 * Duplicates a range of measures N additional times after the range.
 * E.g., repeatSection(xml, 2, 4, 2) takes measures 2-4 and appends 2 more copies.
 */
export function repeatSection(
  musicXml: string,
  startMeasure: number,
  endMeasure: number,
  times: number
): string {
  let result = musicXml.replace(
    /<part\b[^>]*>[\s\S]*?<\/part>/g,
    (partBlock) => {
      const sectionMeasures: string[] = [];
      for (const match of partBlock.matchAll(/<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g)) {
        const num = parseInt(match[1]);
        if (num >= startMeasure && num <= endMeasure) {
          // Strip attributes from copies
          let measure = match[0];
          measure = measure.replace(/<attributes>[\s\S]*?<\/attributes>\s*/, "");
          sectionMeasures.push(measure);
        }
      }

      if (sectionMeasures.length === 0) return partBlock;

      const copies = Array(times).fill(sectionMeasures.join("\n    ")).join("\n    ");

      const regex = new RegExp(
        `(<measure\\b[^>]*number="${endMeasure}"[\\s\\S]*?<\\/measure>)`
      );
      return partBlock.replace(regex, `$1\n    ${copies}`);
    }
  );

  return renumberMeasures(result);
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

  // Normalize to 0-11 range, adjusting octave
  while (totalSemitone >= 12) { totalSemitone -= 12; newOctave++; }
  while (totalSemitone < 0) { totalSemitone += 12; newOctave--; }

  const [newStep, newAlter] = NOTES[totalSemitone];
  return { step: newStep, alter: newAlter, octave: newOctave };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildContext(musicXml: string): string {
  const instruments = [...musicXml.matchAll(/<part-name>([^<]+)<\/part-name>/g)]
    .map((m) => m[1].trim())
    .join(", ");

  const fifths = parseInt(musicXml.match(/<fifths>(-?\d+)<\/fifths>/)?.[1] ?? "0");
  const key = fifthsToKey(fifths);

  const beats = musicXml.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4";
  const beatType = musicXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4";

  const measureCount = (musicXml.match(/<measure /g) ?? []).length;

  return `Instruments: ${instruments || "unknown"} | Key: ${key} | Time: ${beats}/${beatType} | Measures: ${measureCount}`;
}

function fifthsToKey(fifths: number): string {
  const keys = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
  return (keys[fifths + 7] ?? "C") + " major";
}

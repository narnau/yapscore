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

  // Process each <part> independently to preserve part structure
  const partBlocks: string[] = [];
  for (const partMatch of parts.matchAll(/<part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/part>/g)) {
    const partId = partMatch[1];
    const partContent = partMatch[2];
    const selected: string[] = [];
    for (const m of partContent.matchAll(/<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g)) {
      if (nums.has(parseInt(m[1]))) selected.push(m[0]);
    }
    if (selected.length > 0) {
      partBlocks.push(`<part id="${partId}">\n${selected.join("\n")}\n</part>`);
    }
  }

  return { skeleton, selectedMeasures: partBlocks.join("\n"), context };
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
  const hasPartWrappers = /<part[\s>]/.test(modifiedMeasuresXml);

  if (hasPartWrappers) {
    return spliceMeasuresBackPerPart(musicXml, modifiedMeasuresXml, sentMeasureNumbers);
  }
  return spliceMeasuresBackGlobal(musicXml, modifiedMeasuresXml, sentMeasureNumbers);
}

/**
 * Path A: modified XML has <part> wrappers — do per-part replacement.
 */
function spliceMeasuresBackPerPart(
  musicXml: string,
  modifiedMeasuresXml: string,
  sentMeasureNumbers?: number[]
): string {
  // Build Map<partId, Map<measureNum, content>>
  const perPartMap = new Map<string, Map<number, string>>();
  for (const partMatch of modifiedMeasuresXml.matchAll(/<part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/part>/g)) {
    const partId = partMatch[1];
    const measureMap = new Map<number, string>();
    for (const m of partMatch[2].matchAll(/<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g)) {
      measureMap.set(parseInt(m[1]), m[0]);
    }
    perPartMap.set(partId, measureMap);
  }

  // Determine deleted measures per part
  const deletedPerPart = new Map<string, Set<number>>();
  if (sentMeasureNumbers) {
    for (const [partId, measureMap] of perPartMap) {
      const deleted = new Set<number>();
      for (const num of sentMeasureNumbers) {
        if (!measureMap.has(num)) deleted.add(num);
      }
      if (deleted.size > 0) deletedPerPart.set(partId, deleted);
    }
  }

  let anyDeleted = false;

  // Replace per-part
  let result = musicXml.replace(
    /<part\s+id="([^"]+)"[^>]*>[\s\S]*?<\/part>/g,
    (partBlock, partId) => {
      const measureMap = perPartMap.get(partId);
      if (!measureMap) return partBlock; // Part not in modified XML, keep as-is

      const deleted = deletedPerPart.get(partId) ?? new Set<number>();
      if (deleted.size > 0) anyDeleted = true;

      return partBlock.replace(
        /<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g,
        (original, numStr) => {
          const num = parseInt(numStr);
          if (deleted.has(num)) return "";
          return measureMap.get(num) ?? original;
        }
      );
    }
  );

  if (anyDeleted) {
    result = renumberMeasures(result);
  }

  return result;
}

/**
 * Path B (backward compat): bare measures without <part> wrappers.
 * Works for single-part scores and legacy LLM responses.
 */
function spliceMeasuresBackGlobal(
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

      // Preserve <attributes> and <direction> blocks (key, time, clef, tempo, dynamics)
      const attrMatch = content.match(/<attributes>[\s\S]*?<\/attributes>/);
      const attrs = attrMatch ? `\n      ${attrMatch[0]}` : "";
      const directions = [...content.matchAll(/<direction[\s\S]*?<\/direction>/g)]
        .map((m) => `\n      ${m[0]}`)
        .join("");

      const tag = full.match(/<measure\b[^>]*>/)?.[0] ?? `<measure number="${numStr}">`;
      return `${tag}${attrs}${directions}\n      <note><rest/><duration>${wholeDuration}</duration><type>whole</type></note>\n    </measure>`;
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

/**
 * Sets the tempo (BPM) of the score. Updates existing tempo markings or inserts
 * a new one in measure 1 of each part. Handles both <sound tempo="X"/> (playback)
 * and <metronome> (visual marking).
 */
export function setTempo(musicXml: string, bpm: number, beatUnit: string = "quarter"): string {
  const hasSoundTempo = /<sound\b[^>]*tempo="/i.test(musicXml);
  const hasMetronome = /<metronome/i.test(musicXml);

  if (hasSoundTempo || hasMetronome) {
    // Update existing tempo markings
    let result = musicXml;

    // Update <sound tempo="X"/>
    result = result.replace(
      /(<sound\b[^>]*tempo=")(\d+(?:\.\d+)?)("[^>]*\/>)/g,
      `$1${bpm}$3`
    );

    // Update <per-minute>X</per-minute>
    result = result.replace(
      /<per-minute>\d+(?:\.\d+)?<\/per-minute>/g,
      `<per-minute>${bpm}</per-minute>`
    );

    // Update <beat-unit> in metronome
    result = result.replace(
      /<metronome[^>]*>[\s\S]*?<\/metronome>/g,
      (metronomeBlock) => {
        return metronomeBlock.replace(
          /<beat-unit>[^<]+<\/beat-unit>/,
          `<beat-unit>${beatUnit}</beat-unit>`
        );
      }
    );

    return result;
  }

  // No existing tempo — insert in measure 1 of each part
  const tempoDirection =
    `<direction placement="above">` +
    `<direction-type><metronome parentheses="no"><beat-unit>${beatUnit}</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type>` +
    `<sound tempo="${bpm}"/>` +
    `</direction>`;

  return musicXml.replace(
    /(<measure\b[^>]*number="1"[^>]*>)([\s\S]*?)(<note\b)/g,
    (match, measureTag, between, noteTag) => {
      return `${measureTag}${between}${tempoDirection}\n      ${noteTag}`;
    }
  );
}

/**
 * Reads the current tempo from the MusicXML. Returns null if no tempo is set.
 */
export function getTempo(musicXml: string): { bpm: number; beatUnit: string } | null {
  const soundMatch = musicXml.match(/<sound\b[^>]*tempo="(\d+(?:\.\d+)?)"/);
  const metronomeMatch = musicXml.match(/<beat-unit>([^<]+)<\/beat-unit>/);

  if (!soundMatch) return null;

  return {
    bpm: parseFloat(soundMatch[1]),
    beatUnit: metronomeMatch?.[1] ?? "quarter",
  };
}

// ─── addDynamics ─────────────────────────────────────────────────────────────

const DYNAMIC_VELOCITIES: Record<string, number> = {
  pp: 36, p: 54, mp: 71, mf: 89, f: 106, ff: 124, fp: 96, sfz: 112,
};

export type DynamicMarking = "pp" | "p" | "mp" | "mf" | "f" | "ff" | "fp" | "sfz";

/**
 * Add a dynamic marking (pp, p, mp, mf, f, ff, fp, sfz) at specified measures.
 * Updates existing dynamics in-place; otherwise inserts before the first note.
 */
export function addDynamics(
  musicXml: string,
  measureNumbers: number[],
  dynamic: DynamicMarking
): string {
  const nums = new Set(measureNumbers);
  const velocity = DYNAMIC_VELOCITIES[dynamic] ?? 89;

  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g,
    (full, numStr, content) => {
      if (!nums.has(parseInt(numStr))) return full;

      const tag = full.match(/<measure\b[^>]*>/)?.[0] ?? `<measure number="${numStr}">`;

      // Check for existing <dynamics> inside a <direction>
      if (/<direction[\s\S]*?<dynamics>/.test(content)) {
        // Update existing: replace the dynamics element content and sound
        let updated = content.replace(
          /(<direction[\s\S]*?<dynamics>)[\s\S]*?(<\/dynamics>)/g,
          `$1<${dynamic}/>$2`
        );
        updated = updated.replace(
          /(<sound\s+dynamics=")(\d+)(")/g,
          `$1${velocity}$3`
        );
        return `${tag}${updated}</measure>`;
      }

      // Insert new direction before first <note>
      const directionXml =
        `<direction placement="below">` +
        `<direction-type><dynamics><${dynamic}/></dynamics></direction-type>` +
        `<sound dynamics="${velocity}"/>` +
        `</direction>`;

      const newContent = content.replace(
        /(<note\b)/,
        `${directionXml}\n      $1`
      );
      return `${tag}${newContent}</measure>`;
    }
  );
}

// ─── addArticulations ────────────────────────────────────────────────────────

export type ArticulationMarking = "staccato" | "accent" | "tenuto" | "marcato" | "staccatissimo";

/**
 * Add articulation markings to all notes (not rests) in specified measures.
 */
export function addArticulations(
  musicXml: string,
  measureNumbers: number[],
  articulation: ArticulationMarking
): string {
  const nums = new Set(measureNumbers);

  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g,
    (measureBlock, numStr) => {
      if (!nums.has(parseInt(numStr))) return measureBlock;

      return measureBlock.replace(
        /<note>([\s\S]*?)<\/note>/g,
        (noteBlock, inner) => {
          // Skip rests
          if (/<rest\s*\/>/.test(inner)) return noteBlock;

          const artElement = `<${articulation}/>`;

          // Case 1: <notations><articulations> exists — append
          if (/<articulations>/.test(inner)) {
            const updated = inner.replace(
              /<\/articulations>/,
              `${artElement}</articulations>`
            );
            return `<note>${updated}</note>`;
          }

          // Case 2: <notations> exists but no <articulations>
          if (/<notations>/.test(inner)) {
            const updated = inner.replace(
              /<\/notations>/,
              `<articulations>${artElement}</articulations></notations>`
            );
            return `<note>${updated}</note>`;
          }

          // Case 3: no <notations> at all — add before </note>
          return `<note>${inner}<notations><articulations>${artElement}</articulations></notations></note>`;
        }
      );
    }
  );
}

// ─── addRepeatBarlines ───────────────────────────────────────────────────────

/**
 * Add forward/backward repeat barlines to create a repeat section.
 */
export function addRepeatBarlines(
  musicXml: string,
  startMeasure: number,
  endMeasure: number
): string {
  const forwardBarline = `<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>`;
  const backwardBarline = `<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>`;

  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g,
    (full, numStr, content) => {
      const num = parseInt(numStr);
      const tag = full.match(/<measure\b[^>]*>/)?.[0] ?? `<measure number="${numStr}">`;

      if (num === startMeasure && num === endMeasure) {
        return `${tag}\n      ${forwardBarline}${content}${backwardBarline}\n    </measure>`;
      }
      if (num === startMeasure) {
        return `${tag}\n      ${forwardBarline}${content}</measure>`;
      }
      if (num === endMeasure) {
        return `${tag}${content}${backwardBarline}\n    </measure>`;
      }
      return full;
    }
  );
}

// ─── addVoltaBrackets ────────────────────────────────────────────────────────

/**
 * Add 1st/2nd ending (volta) brackets to measures.
 */
export function addVoltaBrackets(
  musicXml: string,
  firstEndingMeasures: number[],
  secondEndingMeasures: number[]
): string {
  const first = new Set(firstEndingMeasures);
  const second = new Set(secondEndingMeasures);
  const firstStart = Math.min(...firstEndingMeasures);
  const firstEnd = Math.max(...firstEndingMeasures);
  const secondStart = Math.min(...secondEndingMeasures);
  const secondEnd = Math.max(...secondEndingMeasures);

  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g,
    (full, numStr, content) => {
      const num = parseInt(numStr);
      const tag = full.match(/<measure\b[^>]*>/)?.[0] ?? `<measure number="${numStr}">`;

      let prefix = "";
      let suffix = "";

      // First ending
      if (num === firstStart) {
        prefix += `<barline location="left"><ending number="1" type="start"/></barline>`;
      }
      if (num === firstEnd) {
        suffix += `<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>`;
      }

      // Second ending
      if (num === secondStart) {
        prefix += `<barline location="left"><ending number="2" type="start"/></barline>`;
      }
      if (num === secondEnd) {
        suffix += `<barline location="right"><ending number="2" type="stop"/></barline>`;
      }

      if (!prefix && !suffix) return full;

      return `${tag}\n      ${prefix}${content}${suffix}\n    </measure>`;
    }
  );
}

// ─── addHairpin ──────────────────────────────────────────────────────────────

/**
 * Add a crescendo or diminuendo hairpin spanning a range of measures.
 */
export function addHairpin(
  musicXml: string,
  startMeasure: number,
  endMeasure: number,
  type: "crescendo" | "diminuendo"
): string {
  const startDirection =
    `<direction placement="below">` +
    `<direction-type><wedge type="${type}"/></direction-type>` +
    `</direction>`;
  const stopDirection =
    `<direction placement="below">` +
    `<direction-type><wedge type="stop"/></direction-type>` +
    `</direction>`;

  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g,
    (full, numStr, content) => {
      const num = parseInt(numStr);
      const tag = full.match(/<measure\b[^>]*>/)?.[0] ?? `<measure number="${numStr}">`;

      if (num === startMeasure) {
        const newContent = content.replace(
          /(<note\b)/,
          `${startDirection}\n      $1`
        );
        return `${tag}${newContent}</measure>`;
      }
      if (num === endMeasure) {
        const newContent = content.replace(
          /(<note\b)/,
          `${stopDirection}\n      $1`
        );
        return `${tag}${newContent}</measure>`;
      }
      return full;
    }
  );
}

// ─── changeKey ───────────────────────────────────────────────────────────────

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

// Fifths difference → semitone shift (each fifth = 7 semitones mod 12)
function fifthsToSemitones(oldFifths: number, newFifths: number): number {
  // Each step on the circle of fifths = 7 semitones (mod 12)
  const diff = newFifths - oldFifths;
  let semitones = (diff * 7) % 12;
  // Normalize to -6..+5 range for smallest interval
  if (semitones > 6) semitones -= 12;
  if (semitones < -6) semitones += 12;
  return semitones;
}

/**
 * Change the key signature and transpose notes to match.
 * If fromMeasure is specified, only changes from that measure onward.
 */
export function changeKey(
  musicXml: string,
  newFifths: number,
  fromMeasure?: number
): string {
  const oldFifths = parseInt(musicXml.match(/<fifths>(-?\d+)<\/fifths>/)?.[1] ?? "0");
  const semitones = fifthsToSemitones(oldFifths, newFifths);

  if (fromMeasure === undefined || fromMeasure === 1) {
    // Change the whole score: update existing <fifths> and transpose all notes
    let result = musicXml.replace(
      /<fifths>-?\d+<\/fifths>/g,
      `<fifths>${newFifths}</fifths>`
    );
    result = transposeMeasures(result, null, semitones);
    return result;
  }

  // Change from a specific measure onward
  const attributesBlock = `<attributes><key><fifths>${newFifths}</fifths></key></attributes>`;

  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g,
    (full, numStr, content) => {
      const num = parseInt(numStr);
      if (num < fromMeasure) return full;

      const tag = full.match(/<measure\b[^>]*>/)?.[0] ?? `<measure number="${numStr}">`;

      // Transpose notes in this measure
      let transposed = full;
      transposed = transposed.replace(
        /<pitch>([\s\S]*?)<\/pitch>/g,
        (pitchBlock, inner) => {
          const stepMatch = inner.match(/<step>([A-G])<\/step>/);
          const octaveMatch = inner.match(/<octave>(\d+)<\/octave>/);
          const alterMatch = inner.match(/<alter>(-?\d+)<\/alter>/);
          if (!stepMatch || !octaveMatch) return pitchBlock;

          const result = transposePitch(
            stepMatch[1],
            alterMatch ? parseInt(alterMatch[1]) : 0,
            parseInt(octaveMatch[1]),
            semitones
          );

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

      // Insert key change attributes at the start of the fromMeasure
      if (num === fromMeasure) {
        const innerContent = transposed.match(
          new RegExp(`<measure\\b[^>]*number="${numStr}"[^>]*>([\\s\\S]*?)</measure>`)
        )?.[1] ?? content;

        // If measure already has <attributes>, insert <key> inside it
        if (/<attributes>/.test(innerContent)) {
          const updatedContent = innerContent.replace(
            /<key>[\s\S]*?<\/key>/,
            `<key><fifths>${newFifths}</fifths></key>`
          );
          return `${tag}${updatedContent}</measure>`;
        }
        return `${tag}\n      ${attributesBlock}${innerContent}</measure>`;
      }

      // For measures after fromMeasure, just return the transposed version
      const innerContent = transposed.match(
        new RegExp(`<measure\\b[^>]*number="${numStr}"[^>]*>([\\s\\S]*?)</measure>`)
      )?.[1] ?? content;
      return `${tag}${innerContent}</measure>`;
    }
  );
}

// ─── scaleNoteDurations ──────────────────────────────────────────────────────

const DURATION_TYPES = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"];

/**
 * Double or halve all note durations in specified measures (augmentation/diminution).
 */
export function scaleNoteDurations(
  musicXml: string,
  measureNumbers: number[],
  factor: number
): string {
  const nums = new Set(measureNumbers);

  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g,
    (measureBlock, numStr) => {
      if (!nums.has(parseInt(numStr))) return measureBlock;

      return measureBlock.replace(
        /<note>([\s\S]*?)<\/note>/g,
        (noteBlock, inner) => {
          // Scale <duration>
          let updated = inner.replace(
            /<duration>(\d+)<\/duration>/,
            (_: string, dur: string) => `<duration>${Math.round(parseInt(dur) * factor)}</duration>`
          );

          // Scale <type>
          updated = updated.replace(
            /<type>([^<]+)<\/type>/,
            (_: string, typeName: string) => {
              const idx = DURATION_TYPES.indexOf(typeName);
              if (idx === -1) return `<type>${typeName}</type>`;
              // factor=2 → go one step toward "whole" (shorter index)
              // factor=0.5 → go one step toward "64th" (higher index)
              const shift = factor >= 2 ? -1 : factor <= 0.5 ? 1 : 0;
              const newIdx = Math.max(0, Math.min(DURATION_TYPES.length - 1, idx + shift));
              return `<type>${DURATION_TYPES[newIdx]}</type>`;
            }
          );

          return `<note>${updated}</note>`;
        }
      );
    }
  );
}

// ─── addTextAnnotation ───────────────────────────────────────────────────────

/**
 * Add a text expression or rehearsal mark at a measure.
 */
export function addTextAnnotation(
  musicXml: string,
  measureNumber: number,
  text: string,
  type: "text" | "rehearsal"
): string {
  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g,
    (full, numStr, content) => {
      if (parseInt(numStr) !== measureNumber) return full;

      const tag = full.match(/<measure\b[^>]*>/)?.[0] ?? `<measure number="${numStr}">`;

      const dirContent = type === "rehearsal"
        ? `<rehearsal enclosure="square">${text}</rehearsal>`
        : `<words font-style="italic">${text}</words>`;

      const directionXml =
        `<direction placement="above">` +
        `<direction-type>${dirContent}</direction-type>` +
        `</direction>`;

      const newContent = content.replace(
        /(<note\b)/,
        `${directionXml}\n      $1`
      );
      return `${tag}${newContent}</measure>`;
    }
  );
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

// ─── setMeasureNotes ─────────────────────────────────────────────────────────

export type NoteSpec = {
  step?: "C" | "D" | "E" | "F" | "G" | "A" | "B";
  octave?: number;
  alter?: number;      // -1 flat, 1 sharp
  duration: "whole" | "half" | "quarter" | "eighth" | "16th" |
            "dotted-whole" | "dotted-half" | "dotted-quarter" | "dotted-eighth";
  chord?: boolean;     // simultaneous with previous note
  rest?: boolean;
};

const BASE_TYPE_MAP: Record<string, { type: string; quarterMultiplier: number; dotted: boolean }> = {
  "whole":           { type: "whole",   quarterMultiplier: 4,    dotted: false },
  "half":            { type: "half",    quarterMultiplier: 2,    dotted: false },
  "quarter":         { type: "quarter", quarterMultiplier: 1,    dotted: false },
  "eighth":          { type: "eighth",  quarterMultiplier: 0.5,  dotted: false },
  "16th":            { type: "16th",    quarterMultiplier: 0.25, dotted: false },
  "dotted-whole":    { type: "whole",   quarterMultiplier: 6,    dotted: true },
  "dotted-half":     { type: "half",    quarterMultiplier: 3,    dotted: true },
  "dotted-quarter":  { type: "quarter", quarterMultiplier: 1.5,  dotted: true },
  "dotted-eighth":   { type: "eighth",  quarterMultiplier: 0.75, dotted: true },
};

function noteSpecToXml(note: NoteSpec, divisions: number): string {
  const info = BASE_TYPE_MAP[note.duration];
  if (!info) throw new Error(`Unknown duration: ${note.duration}`);

  const dur = Math.round(info.quarterMultiplier * divisions);

  if (note.rest) {
    return `<note><rest/><duration>${dur}</duration><type>${info.type}</type>${info.dotted ? "<dot/>" : ""}</note>`;
  }

  if (!note.step) throw new Error("Non-rest note must have a step");

  const chordTag = note.chord ? "<chord/>" : "";
  const alterTag = note.alter ? `<alter>${note.alter}</alter>` : "";
  const dotTag = info.dotted ? "<dot/>" : "";

  return `<note>${chordTag}<pitch><step>${note.step}</step>${alterTag}<octave>${note.octave ?? 4}</octave></pitch><duration>${dur}</duration><type>${info.type}</type>${dotTag}</note>`;
}

/**
 * Replace all notes in a specific measure of a specific part with new notes.
 * Preserves <attributes>, <direction>, <barline>, <harmony>, <print> elements.
 */
export function setMeasureNotes(
  musicXml: string,
  measureNumber: number,
  notes: NoteSpec[],
  partId: string = "P1"
): string {
  const divisions = parseInt(musicXml.match(/<divisions>(\d+)<\/divisions>/)?.[1] ?? "4");
  const notesXml = notes.map(n => noteSpecToXml(n, divisions)).join("\n      ");

  // Match the target part, then replace notes in the target measure within it
  return musicXml.replace(
    new RegExp(`(<part\\s+id="${partId}"[^>]*>)([\\s\\S]*?)(</part>)`),
    (_, partOpen, partContent, partClose) => {
      const updatedContent = partContent.replace(
        new RegExp(`(<measure\\b[^>]*number="${measureNumber}"[^>]*>)([\\s\\S]*?)(</measure>)`),
        (_: string, measureOpen: string, measureContent: string, measureClose: string) => {
          // Preserve non-note elements
          const preserved: string[] = [];
          for (const m of measureContent.matchAll(/<(attributes|direction|barline|harmony|print)[\s\S]*?<\/\1>/g)) {
            preserved.push(m[0]);
          }
          // Also preserve self-closing variants
          for (const m of measureContent.matchAll(/<(print|barline)[^>]*\/>/g)) {
            preserved.push(m[0]);
          }

          const preservedBlock = preserved.length > 0 ? "\n      " + preserved.join("\n      ") : "";
          return `${measureOpen}${preservedBlock}\n      ${notesXml}\n    ${measureClose}`;
        }
      );
      return `${partOpen}${updatedContent}${partClose}`;
    }
  );
}

// ─── setTimeSignature ────────────────────────────────────────────────────────

/**
 * Change the time signature. If fromMeasure is 1 (or omitted), replaces all
 * existing <time> elements. If fromMeasure > 1, inserts a new <attributes>
 * block at that measure.
 */
export function setTimeSignature(
  musicXml: string,
  beats: number,
  beatType: number,
  fromMeasure: number = 1
): string {
  const timeXml = `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`;

  if (fromMeasure <= 1) {
    // Replace all existing <time> elements
    return musicXml.replace(
      /<time>[\s\S]*?<\/time>/g,
      timeXml
    );
  }

  // Insert at a specific measure
  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g,
    (full, numStr, content) => {
      if (parseInt(numStr) !== fromMeasure) return full;

      const tag = full.match(/<measure\b[^>]*>/)?.[0] ?? `<measure number="${numStr}">`;

      // If measure already has <attributes>, insert/replace <time> inside it
      if (/<attributes>/.test(content)) {
        if (/<time>/.test(content)) {
          const updated = content.replace(/<time>[\s\S]*?<\/time>/, timeXml);
          return `${tag}${updated}</measure>`;
        }
        const updated = content.replace(/<\/attributes>/, `${timeXml}</attributes>`);
        return `${tag}${updated}</measure>`;
      }

      // No attributes — insert new block
      return `${tag}\n      <attributes>${timeXml}</attributes>${content}</measure>`;
    }
  );
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

  const tempo = getTempo(musicXml);
  const tempoStr = tempo ? ` | Tempo: ${tempo.bpm} BPM` : "";

  return `Instruments: ${instruments || "unknown"} | Key: ${key} | Time: ${beats}/${beatType} | Measures: ${measureCount}${tempoStr}`;
}

function fifthsToKey(fifths: number): string {
  const keys = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
  return (keys[fifths + 7] ?? "C") + " major";
}

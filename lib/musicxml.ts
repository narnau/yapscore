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
export function clearMeasures(musicXml: string, measureNumbers: number[], partId?: string): string {
  const toClear = new Set(measureNumbers);

  // Detect divisions and time signature to compute whole-measure rest duration
  const divisions = parseInt(musicXml.match(/<divisions>(\d+)<\/divisions>/)?.[1] ?? "4");
  const beats = parseInt(musicXml.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4");
  const beatType = parseInt(musicXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4");
  const wholeDuration = divisions * beats * (4 / beatType);

  function clearMatchingMeasures(block: string): string {
    return block.replace(
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

  if (partId) {
    // Only clear within the specified part
    return musicXml.replace(
      new RegExp(`(<part\\s[^>]*id="${partId}"[^>]*>)([\\s\\S]*?)(</part>)`),
      (_full, open, body, close) => `${open}${clearMatchingMeasures(body)}${close}`
    );
  }

  return clearMatchingMeasures(musicXml);
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
            "dotted-whole" | "dotted-half" | "dotted-quarter" | "dotted-eighth" |
            "half-triplet" | "quarter-triplet" | "eighth-triplet" | "16th-triplet";
  chord?: boolean;
  rest?: boolean;
  tie?: "start" | "stop" | "both";
  slur?: "start" | "stop";
  tuplet?: "start" | "stop";   // bracket around triplet group
  ornament?: "trill" | "mordent" | "inverted-mordent" | "turn";
  lyric?: { text: string; syllabic?: "single" | "begin" | "middle" | "end"; verse?: number };
};

const BASE_TYPE_MAP: Record<string, { type: string; quarterMultiplier: number; dotted: boolean; triplet?: boolean }> = {
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

function noteSpecToXml(note: NoteSpec, divisions: number, staff?: number): string {
  const info = BASE_TYPE_MAP[note.duration];
  if (!info) throw new Error(`Unknown duration: ${note.duration}`);

  const dur = Math.round(info.quarterMultiplier * divisions);
  const voiceTag = staff ? `<voice>${staff === 2 ? 5 : 1}</voice>` : "";
  const staffTag = staff ? `<staff>${staff}</staff>` : "";
  const dotTag   = info.dotted ? "<dot/>" : "";
  const timeMod  = info.triplet
    ? `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>`
    : "";

  // Tie elements go inside <note>, before <duration>
  const tieStop  = (note.tie === "stop"  || note.tie === "both") ? `<tie type="stop"/>`  : "";
  const tieStart = (note.tie === "start" || note.tie === "both") ? `<tie type="start"/>` : "";

  // Lyric block
  const lyricBlock = note.lyric
    ? `<lyric number="${note.lyric.verse ?? 1}"><syllabic>${note.lyric.syllabic ?? "single"}</syllabic><text>${note.lyric.text}</text></lyric>`
    : "";

  // Notations block
  const notItems: string[] = [];
  if (note.tie === "stop"  || note.tie === "both") notItems.push(`<tied type="stop"/>`);
  if (note.tie === "start" || note.tie === "both") notItems.push(`<tied type="start"/>`);
  if (note.slur === "start") notItems.push(`<slur type="start" number="1"/>`);
  if (note.slur === "stop")  notItems.push(`<slur type="stop" number="1"/>`);
  if (note.ornament) {
    const ornMap: Record<string, string> = {
      "trill": "<trill-mark/>", "mordent": "<mordent/>",
      "inverted-mordent": "<inverted-mordent/>", "turn": "<turn/>",
    };
    notItems.push(`<ornaments>${ornMap[note.ornament] ?? ""}</ornaments>`);
  }
  if (note.tuplet === "start") notItems.push(`<tuplet type="start" bracket="yes"/>`);
  if (note.tuplet === "stop")  notItems.push(`<tuplet type="stop"/>`);
  const notations = notItems.length > 0 ? `<notations>${notItems.join("")}</notations>` : "";

  if (note.rest) {
    return `<note><rest/>${tieStop}${tieStart}<duration>${dur}</duration>${voiceTag}<type>${info.type}</type>${dotTag}${timeMod}${staffTag}${notations}</note>`;
  }

  if (!note.step) throw new Error("Non-rest note must have a step");
  const chordTag = note.chord ? "<chord/>" : "";
  const alterTag = note.alter ? `<alter>${note.alter}</alter>` : "";

  return `<note>${chordTag}<pitch><step>${note.step}</step>${alterTag}<octave>${note.octave ?? 4}</octave></pitch>${tieStop}${tieStart}<duration>${dur}</duration>${voiceTag}<type>${info.type}</type>${dotTag}${timeMod}${staffTag}${lyricBlock}${notations}</note>`;
}

// ─── triplet division helpers ─────────────────────────────────────────────────

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
function lcmInt(a: number, b: number): number { return Math.round((a / gcd(a, b)) * b); }

/**
 * Upgrade <divisions> to the LCM of its current value and 12 so that triplet
 * durations (1/3, 1/6 of a quarter) are representable as integers.
 * Scales every existing <duration> element proportionally.
 */
function ensureTripletDivisions(musicXml: string): string {
  const current = parseInt(musicXml.match(/<divisions>(\d+)<\/divisions>/)?.[1] ?? "4");
  if (current % 3 === 0) return musicXml;           // already triplet-friendly
  const target = lcmInt(current, 12);
  const factor = target / current;
  return musicXml
    .replace(/<duration>(\d+)<\/duration>/g, (_, d) => `<duration>${parseInt(d) * factor}</duration>`)
    .replace(/<divisions>\d+<\/divisions>/g, `<divisions>${target}</divisions>`);
}

/**
 * Replace all notes in a specific measure of a specific part with new notes.
 * Preserves <attributes>, <direction>, <barline>, <harmony>, <print> elements.
 */
export function setMeasureNotes(
  musicXml: string,
  measureNumber: number,
  notes: NoteSpec[],
  partId: string = "P1",
  staff?: number   // 1 = right hand, 2 = left hand; undefined = replace all notes
): string {
  // Auto-insert missing measures so writing to measure N always works
  const firstPart = musicXml.match(/<part\b[^>]*>[\s\S]*?<\/part>/)?.[0] ?? "";
  const currentCount = (firstPart.match(/<measure\b/g) ?? []).length;
  if (measureNumber > currentCount) {
    musicXml = insertEmptyMeasures(musicXml, currentCount, measureNumber - currentCount);
  }

  // Upgrade divisions if any notes use triplet durations
  const hasTriplets = notes.some(n => BASE_TYPE_MAP[n.duration]?.triplet);
  if (hasTriplets) musicXml = ensureTripletDivisions(musicXml);

  const divisions = parseInt(musicXml.match(/<divisions>(\d+)<\/divisions>/)?.[1] ?? "4");
  const notesXml = notes.map(n => noteSpecToXml(n, divisions, staff)).join("\n      ");

  // Match the target part, then replace notes in the target measure within it
  return musicXml.replace(
    new RegExp(`(<part\\s+id="${partId}"[^>]*>)([\\s\\S]*?)(</part>)`),
    (_, partOpen, partContent, partClose) => {
      const updatedContent = partContent.replace(
        new RegExp(`(<measure\\b[^>]*number="${measureNumber}"[^>]*>)([\\s\\S]*?)(</measure>)`),
        (_: string, measureOpen: string, measureContent: string, measureClose: string) => {
          // Preserve non-note elements (attributes, direction, barline, etc.)
          const preserved: string[] = [];
          for (const m of measureContent.matchAll(/<(attributes|direction|barline|harmony|print)[\s\S]*?<\/\1>/g)) {
            preserved.push(m[0]);
          }
          for (const m of measureContent.matchAll(/<(print|barline)[^>]*\/>/g)) {
            preserved.push(m[0]);
          }
          const preservedBlock = preserved.length > 0 ? "\n      " + preserved.join("\n      ") : "";

          if (!staff) {
            // No staff targeting: replace all notes (original behaviour, single-staff instruments)
            return `${measureOpen}${preservedBlock}\n      ${notesXml}\n    ${measureClose}`;
          }

          // Staff-aware: keep the other staff's notes, replace only this staff's notes
          const otherStaff = staff === 1 ? 2 : 1;
          const otherVoice = otherStaff === 2 ? 5 : 1;

          // Extract notes belonging to the OTHER staff (we want to keep them)
          const otherNotes: string[] = [];
          for (const m of measureContent.matchAll(/<note>[\s\S]*?<\/note>/g)) {
            const noteXml = m[0];
            // A note belongs to the other staff if it has an explicit <staff>N</staff> tag,
            // or if it has no staff tag and we're writing to staff 2 (preserve unmarked = staff 1)
            const staffMatch = noteXml.match(/<staff>(\d+)<\/staff>/);
            const noteStaff = staffMatch ? parseInt(staffMatch[1]) : 1;
            if (noteStaff === otherStaff) {
              otherNotes.push(noteXml);
            }
          }

          // Calculate total measure duration for <backup>
          const measureBeats = parseInt(musicXml.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4");
          const measureBeatType = parseInt(musicXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4");
          const measureDuration = Math.round(divisions * measureBeats * (4 / measureBeatType));

          if (staff === 1) {
            // Staff 1 first, then backup, then staff 2
            const otherBlock = otherNotes.length > 0
              ? `\n      <backup><duration>${measureDuration}</duration></backup>\n      ` + otherNotes.join("\n      ")
              : "";
            return `${measureOpen}${preservedBlock}\n      ${notesXml}${otherBlock}\n    ${measureClose}`;
          } else {
            // Staff 2: keep staff 1 notes, backup, then write staff 2
            // Re-tag other (staff 1) notes to ensure they have explicit voice/staff
            const staff1Notes = otherNotes.map(n => {
              if (!n.includes("<staff>")) {
                // Insert voice+staff before </note>
                return n.replace("</note>", `<voice>${otherVoice}</voice><staff>${otherStaff}</staff></note>`);
              }
              return n;
            });
            const staff1Block = staff1Notes.length > 0 ? "\n      " + staff1Notes.join("\n      ") : "";
            const backupTag = `\n      <backup><duration>${measureDuration}</duration></backup>`;
            return `${measureOpen}${preservedBlock}${staff1Block}${backupTag}\n      ${notesXml}\n    ${measureClose}`;
          }
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

// ─── createScore ─────────────────────────────────────────────────────────────

// Short key name → fifths (for createScore)
const KEY_ROOT_TO_FIFTHS: Record<string, number> = {
  "Cb": -7, "Gb": -6, "Db": -5, "Ab": -4, "Eb": -3, "Bb": -2, "F": -1,
  "C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7,
};

// Well-known instruments that have 2 staves (grand staff)
const GRAND_STAFF_INSTRUMENTS = new Set([
  "piano", "keyboard", "organ", "harpsichord", "marimba", "vibraphone",
  "celesta", "harp", "accordion",
]);

function instrumentStaves(name: string): number {
  return GRAND_STAFF_INSTRUMENTS.has(name.toLowerCase()) ? 2 : 1;
}

export type ScoreInstrument = {
  name: string;        // e.g. "Piano", "Violin", "Voice"
  staves?: number;     // override auto-detection
  midiProgram?: number; // GM program 1–128; auto-detected from name if omitted
};

/**
 * Create an empty but fully valid MusicXML score scaffold.
 * All measures contain whole rests ready for writeNotes to fill in.
 */
export function createScore(options: {
  instruments: ScoreInstrument[];
  key?: string;        // e.g. "C", "G", "Bb" — root only, always major for now
  beats?: number;      // numerator, default 4
  beatType?: number;   // denominator, default 4
  tempo?: number;      // BPM, default 120
  measures?: number;   // default 4
  pickupBeats?: number; // number of beats in pickup (anacrusis) measure
}): string {
  const {
    instruments,
    key = "C",
    beats = 4,
    beatType = 4,
    tempo = 120,
    measures = 4,
    pickupBeats,
  } = options;

  const fifths = KEY_ROOT_TO_FIFTHS[key] ?? 0;
  const divisions = 12;
  const measureDuration = divisions * beats * (4 / beatType); // ticks per measure

  // Build <part-list>
  const partList = instruments.map((inst, i) => {
    const id = `P${i + 1}`;
    return `  <score-part id="${id}">
    <part-name>${inst.name}</part-name>
    <score-instrument id="${id}-I1">
      <instrument-name>${inst.name}</instrument-name>
    </score-instrument>
  </score-part>`;
  }).join("\n");

  // Build each <part>
  const parts = instruments.map((inst, i) => {
    const id = `P${i + 1}`;
    const staves = inst.staves ?? instrumentStaves(inst.name);

    const measuresList = Array.from({ length: measures }, (_, m) => {
      const num = m + 1;
      const isFirst = m === 0;
      const isPickup = isFirst && pickupBeats != null;

      // Attributes block (only in first measure)
      const stavesTag = staves > 1 ? `\n      <staves>${staves}</staves>` : "";
      const clefs = staves === 1
        ? `\n      <clef><sign>G</sign><line>2</line></clef>`
        : `\n      <clef number="1"><sign>G</sign><line>2</line></clef>\n      <clef number="2"><sign>F</sign><line>4</line></clef>`;
      const attributes = isFirst ? `
    <attributes>
      <divisions>${divisions}</divisions>
      <key><fifths>${fifths}</fifths></key>
      <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>${stavesTag}${clefs}
    </attributes>
    <direction placement="above">
      <direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type>
      <sound tempo="${tempo}"/>
    </direction>` : "";

      const thisDuration = isPickup
        ? Math.round(divisions * pickupBeats! * (4 / beatType))
        : measureDuration;

      // Rests per staff
      const restNotes = Array.from({ length: staves }, (_, s) => {
        const staffTag = staves > 1 ? `<voice>${s === 0 ? 1 : 5}</voice><staff>${s + 1}</staff>` : "";
        const backupTag = s > 0 ? `\n    <backup><duration>${thisDuration}</duration></backup>` : "";
        const restContent = isPickup
          ? `<note><rest/><duration>${thisDuration}</duration>${staffTag}<type>whole</type></note>`
          : `<note><rest measure="yes"/><duration>${thisDuration}</duration>${staffTag}<type>whole</type></note>`;
        return `${backupTag}\n    ${restContent}`;
      }).join("");

      const measureAttr = isPickup ? ` implicit="yes"` : "";
      return `  <measure number="${num}"${measureAttr}>${attributes}${restNotes}
  </measure>`;
    }).join("\n");

    return `<part id="${id}">\n${measuresList}\n</part>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
${partList}
  </part-list>
${parts}
</score-partwise>`;
}

// ─── addChordSymbols ──────────────────────────────────────────────────────────

export type ChordSymbol = {
  root: string;    // e.g. "C", "F#", "Bb"
  kind: string;    // shorthand: "", "m", "7", "maj7", "m7", "dim", "dim7", "aug", "m7b5", "sus2", "sus4"
  beat?: number;   // 1-based beat position in the measure (default 1)
  bass?: string;   // optional bass note for slash chords e.g. "E" for C/E
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

/**
 * Insert chord symbols (<harmony> elements) into a specific measure.
 * Inserts before the first note in the measure, using <offset> for non-beat-1 chords.
 */
export function addChordSymbols(
  musicXml: string,
  measureNumber: number,
  chords: ChordSymbol[],
  partId: string = "P1"
): string {
  const divisions  = parseInt(musicXml.match(/<divisions>(\d+)<\/divisions>/)?.[1] ?? "4");
  const beatType   = parseInt(musicXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4");
  const beatTicks  = divisions * (4 / beatType);

  const harmonyXml = chords.map(chord => {
    const rootStep  = chord.root.replace(/[b#]/, "");
    const rootAlter = chord.root.includes("#") ? 1 : chord.root.includes("b") ? -1 : null;
    const alterTag  = rootAlter !== null ? `<root-alter>${rootAlter}</root-alter>` : "";
    const kindInfo  = CHORD_KIND_MAP[chord.kind] ?? { xml: chord.kind, text: chord.kind };
    const offset    = Math.round(((chord.beat ?? 1) - 1) * beatTicks);
    const offsetTag = offset > 0 ? `<offset>${offset}</offset>` : "";
    const bassTag   = chord.bass
      ? `<bass><bass-step>${chord.bass.replace(/[b#]/, "")}</bass-step></bass>`
      : "";
    return `<harmony><root><root-step>${rootStep}</root-step>${alterTag}</root><kind text="${kindInfo.text}">${kindInfo.xml}</kind>${bassTag}${offsetTag}</harmony>`;
  }).join("\n    ");

  return musicXml.replace(
    new RegExp(`(<part\\s+id="${partId}"[^>]*>)([\\s\\S]*?)(</part>)`),
    (_, partOpen, partContent, partClose) => {
      const updated = partContent.replace(
        new RegExp(`(<measure\\b[^>]*number="${measureNumber}"[^>]*>)([\\s\\S]*?)(</measure>)`),
        (_2: string, mOpen: string, mContent: string, mClose: string) => {
          const withChords = mContent.includes("<note")
            ? mContent.replace(/(\s*<note[\s>])/, `\n    ${harmonyXml}$1`)
            : mContent + `\n    ${harmonyXml}`;
          return `${mOpen}${withChords}${mClose}`;
        }
      );
      return `${partOpen}${updated}${partClose}`;
    }
  );
}

// ─── renamePart ───────────────────────────────────────────────────────────────

/**
 * Rename a part (instrument) by updating its <part-name> and <instrument-name>.
 */
export function renamePart(musicXml: string, partId: string, name: string): string {
  return musicXml
    .replace(
      new RegExp(`(<score-part[^>]*id="${partId}"[^>]*>[\\s\\S]*?)<part-name>[^<]*</part-name>`),
      `$1<part-name>${name}</part-name>`
    )
    .replace(
      new RegExp(`(<score-part[^>]*id="${partId}"[^>]*>[\\s\\S]*?)<instrument-name>[^<]*</instrument-name>`),
      `$1<instrument-name>${name}</instrument-name>`
    );
}

/** Return the next unused MIDI channel (1-16, skipping 10 which is drums). */
function nextMidiChannel(musicXml: string): number {
  const used = new Set(
    [...musicXml.matchAll(/<midi-channel>(\d+)<\/midi-channel>/g)].map(m => parseInt(m[1]))
  );
  for (let ch = 1; ch <= 16; ch++) {
    if (ch !== 10 && !used.has(ch)) return ch;
  }
  return 1; // fallback
}

// ─── addPart ──────────────────────────────────────────────────────────────────

/**
 * Add a new instrument part to the score.
 * Creates a matching number of empty measures (whole rests) in sync with existing parts.
 */
export function addPart(musicXml: string, instrument: ScoreInstrument): string {
  // Find next available part ID
  const existingNums = [...musicXml.matchAll(/<part\s+id="P(\d+)"/g)].map(m => parseInt(m[1]));
  const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
  const partId  = `P${nextNum}`;
  const staves  = instrument.staves ?? instrumentStaves(instrument.name);

  // Read score parameters from existing content
  const firstPart    = musicXml.match(/<part\b[^>]*>[\s\S]*?<\/part>/)?.[0] ?? "";
  const measureCount = (firstPart.match(/<measure\b/g) ?? []).length;
  const divisions    = parseInt(musicXml.match(/<divisions>(\d+)<\/divisions>/)?.[1] ?? "4");
  const beats        = parseInt(musicXml.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4");
  const beatType     = parseInt(musicXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4");
  const fifths       = parseInt(musicXml.match(/<fifths>(-?\d+)<\/fifths>/)?.[1] ?? "0");
  const measureDur   = Math.round(divisions * beats * (4 / beatType));

  const stavesTag = staves > 1 ? `\n      <staves>${staves}</staves>` : "";
  const clefs     = staves === 1
    ? `\n      <clef><sign>G</sign><line>2</line></clef>`
    : `\n      <clef number="1"><sign>G</sign><line>2</line></clef>\n      <clef number="2"><sign>F</sign><line>4</line></clef>`;

  const measuresList = Array.from({ length: measureCount }, (_, i) => {
    const num     = i + 1;
    const isFirst = i === 0;
    const attrs   = isFirst ? `\n    <attributes>
      <divisions>${divisions}</divisions>
      <key><fifths>${fifths}</fifths></key>
      <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>${stavesTag}${clefs}
    </attributes>` : "";

    const rests = Array.from({ length: staves }, (_, s) => {
      const staffTag = staves > 1 ? `<voice>${s === 0 ? 1 : 5}</voice><staff>${s + 1}</staff>` : "";
      const backup   = s > 0 ? `\n    <backup><duration>${measureDur}</duration></backup>` : "";
      return `${backup}\n    <note><rest measure="yes"/><duration>${measureDur}</duration>${staffTag}<type>whole</type></note>`;
    }).join("");

    return `  <measure number="${num}">${attrs}${rests}\n  </measure>`;
  }).join("\n");

  const midiChannel = nextMidiChannel(musicXml);
  const midiProgram = instrument.midiProgram ?? 1;

  const scorePart = `  <score-part id="${partId}">
    <part-name>${instrument.name}</part-name>
    <score-instrument id="${partId}-I1">
      <instrument-name>${instrument.name}</instrument-name>
    </score-instrument>
    <midi-instrument id="${partId}-I1">
      <midi-channel>${midiChannel}</midi-channel>
      <midi-program>${midiProgram}</midi-program>
      <volume>78.7402</volume>
      <pan>0</pan>
    </midi-instrument>
  </score-part>`;

  return musicXml
    .replace("</part-list>", `${scorePart}\n  </part-list>`)
    .replace("</score-partwise>", `<part id="${partId}">\n${measuresList}\n</part>\n</score-partwise>`);
}

// ─── removePart ───────────────────────────────────────────────────────────────

/**
 * Remove a part from the score entirely (both its <score-part> header and <part> data).
 */
export function removePart(musicXml: string, partId: string): string {
  return musicXml
    .replace(new RegExp(`\\s*<score-part[^>]*id="${partId}"[^>]*>[\\s\\S]*?</score-part>`), "")
    .replace(new RegExp(`\\s*<part[^>]*id="${partId}"[^>]*>[\\s\\S]*?</part>`), "");
}

// ─── movePart ─────────────────────────────────────────────────────────────────

/**
 * Move a part up or down in the score order.
 * Reorders both the <score-part> entries in <part-list> and the <part> data blocks.
 */
export function movePart(musicXml: string, partId: string, direction: "up" | "down"): string {
  // Extract all <score-part> blocks in order
  const scorePartRe = /(<score-part\s[^>]*id="([^"]+)"[^>]*>[\s\S]*?<\/score-part>)/g;
  const scoreParts: { id: string; raw: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = scorePartRe.exec(musicXml)) !== null) {
    scoreParts.push({ id: m[2], raw: m[1] });
  }

  const idx = scoreParts.findIndex(p => p.id === partId);
  if (idx === -1) throw new Error(`Part "${partId}" not found`);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= scoreParts.length) {
    throw new Error(`Cannot move part "${partId}" ${direction} — already at boundary`);
  }

  // Swap in score-part list
  [scoreParts[idx], scoreParts[swapIdx]] = [scoreParts[swapIdx], scoreParts[idx]];

  // Extract all <part> data blocks in order
  const partRe = /(<part\s+id="([^"]+)"[\s\S]*?<\/part>)/g;
  const parts: { id: string; raw: string }[] = [];
  while ((m = partRe.exec(musicXml)) !== null) {
    parts.push({ id: m[2], raw: m[1] });
  }

  const pidx = parts.findIndex(p => p.id === partId);
  const pswap = direction === "up" ? pidx - 1 : pidx + 1;
  if (pidx !== -1 && pswap >= 0 && pswap < parts.length) {
    [parts[pidx], parts[pswap]] = [parts[pswap], parts[pidx]];
  }

  // Rebuild part-list
  const newPartList = scoreParts.map(p => `  ${p.raw}`).join("\n");
  let result = musicXml.replace(/<part-list>[\s\S]*?<\/part-list>/, `<part-list>\n${newPartList}\n  </part-list>`);

  // Rebuild part data blocks (replace all at once, in order)
  result = result.replace(/(<part\s+id="[^"]+">[\s\S]*?<\/part>)/g, () => {
    const next = parts.shift();
    return next ? next.raw : "";
  });

  return result;
}

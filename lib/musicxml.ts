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
  return skeleton.replace("__PARTS__", modifiedParts);
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
 */
export function spliceMeasuresBack(
  musicXml: string,
  modifiedMeasuresXml: string
): string {
  const modifiedMap = new Map<number, string>();
  for (const match of modifiedMeasuresXml.matchAll(/<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g)) {
    modifiedMap.set(parseInt(match[1]), match[0]);
  }

  return musicXml.replace(
    /<measure\b[^>]*number="(\d+)"[\s\S]*?<\/measure>/g,
    (original, numStr) => modifiedMap.get(parseInt(numStr)) ?? original
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

  return `Instruments: ${instruments || "unknown"} | Key: ${key} | Time: ${beats}/${beatType} | Measures: ${measureCount}`;
}

function fifthsToKey(fifths: number): string {
  const keys = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
  return (keys[fifths + 7] ?? "C") + " major";
}

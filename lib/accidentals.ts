/**
 * Post-processes MusicXML to inject <accidental> display elements wherever needed.
 *
 * Rules applied (standard engraving practice):
 *  - Notes in the key signature: no <accidental> needed.
 *  - Notes that deviate from the key signature (or from a previous accidental in the
 *    same measure on the same pitch+octave): add <accidental>.
 *  - Accidentals propagate within a measure per pitch+octave; they reset at each barline.
 *  - Notes that already have an <accidental> element are left untouched.
 */

// Circle-of-fifths order for sharps and flats
const SHARP_STEPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_STEPS  = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Returns a map of step → alter value implied by the key signature. */
function keyAccidentals(fifths: number): Map<string, number> {
  const map = new Map<string, number>();
  if (fifths > 0) {
    for (let i = 0; i < Math.min(fifths, 7); i++) map.set(SHARP_STEPS[i], 1);
  } else if (fifths < 0) {
    for (let i = 0; i < Math.min(-fifths, 7); i++) map.set(FLAT_STEPS[i], -1);
  }
  return map;
}

function alterToAccidentalType(alter: number): string | null {
  if (alter ===  1)  return 'sharp';
  if (alter === -1)  return 'flat';
  if (alter ===  0)  return 'natural';
  if (alter ===  2)  return 'double-sharp';
  if (alter === -2)  return 'flat-flat';
  return null;
}

function processNote(
  noteXml: string,
  measureState: Map<string, number>,
  keyAcc: Map<string, number>
): string {
  // Skip rests and notes that already have an explicit <accidental>
  if (noteXml.includes('<rest') || noteXml.includes('<accidental>')) return noteXml;

  const step   = noteXml.match(/<step>([A-G])<\/step>/)?.[1];
  if (!step) return noteXml;

  const alter  = parseFloat(noteXml.match(/<alter>(-?\d+(?:\.\d+)?)<\/alter>/)?.[1] ?? '0');
  const octave = noteXml.match(/<octave>(\d+)<\/octave>/)?.[1] ?? '4';
  const stateKey = `${step}${octave}`;

  // What was the effective alter before this note?
  const keyAlter  = keyAcc.get(step) ?? 0;
  const prevAlter = measureState.has(stateKey) ? measureState.get(stateKey)! : keyAlter;

  // Update measure state regardless of whether we add an accidental
  measureState.set(stateKey, alter);

  // No visual change needed
  if (alter === prevAlter) return noteXml;

  const type = alterToAccidentalType(alter);
  if (!type) return noteXml;

  // Insert <accidental> immediately after </pitch>
  return noteXml.replace('</pitch>', `</pitch>\n        <accidental>${type}</accidental>`);
}

function processMeasure(measureXml: string, keyAcc: Map<string, number>): string {
  // Fresh accidental state at every barline
  const measureState = new Map<string, number>();
  return measureXml.replace(/<note\b[^>]*>[\s\S]*?<\/note>/g, (note) =>
    processNote(note, measureState, keyAcc)
  );
}

/**
 * Fixes chord symbol duplication where the LLM puts the root note inside
 * <kind text="Dmaj7"> instead of <kind text="maj7">.
 * Verovio renders <root-step> + kind text, causing "DDmaj7".
 */
export function fixChordSymbols(musicXml: string): string {
  // Match each <harmony> block (may have attributes like default-x)
  return musicXml.replace(/<harmony\b[^>]*>[\s\S]*?<\/harmony>/g, (block) => {
    const rootStep = block.match(/<root-step>([A-G])<\/root-step>/)?.[1];
    if (!rootStep) return block;

    // Strip leading root letter (and optional flat/sharp) from kind text attribute
    return block.replace(
      /(<kind\b[^>]*\btext=")([A-G][b#♭♯]?)/,
      (_m, prefix, kindPrefix) => {
        if (kindPrefix[0] !== rootStep) return _m;
        // Strip the root letter and any immediately following accidental sign
        const remainder = kindPrefix.slice(1).replace(/^[b#♭♯]/, '');
        return prefix + remainder;
      }
    );
  });
}

/**
 * Adds missing <accidental> elements to a MusicXML string.
 * Safe to call on already-correct XML: existing <accidental> elements are preserved.
 */
export function addAccidentals(musicXml: string): string {
  // Use the first <fifths> found (handles most single-key scores)
  const fifths = parseInt(musicXml.match(/<fifths>(-?\d+)<\/fifths>/)?.[1] ?? '0');
  const keyAcc = keyAccidentals(fifths);

  return musicXml.replace(/<measure\b[^>]*>[\s\S]*?<\/measure>/g, (measure) =>
    processMeasure(measure, keyAcc)
  );
}

import { describe, test, expect } from "bun:test";
import { addAccidentals, fixChordSymbols } from "@/lib/music/accidentals";

describe("addAccidentals", () => {
  test("adds sharp accidental when note deviates from key signature (C major)", () => {
    const xml = `
<fifths>0</fifths>
<measure number="1">
  <note>
    <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    expect(result).toContain("<accidental>sharp</accidental>");
  });

  test("adds flat accidental for flatted note in C major", () => {
    const xml = `
<fifths>0</fifths>
<measure number="1">
  <note>
    <pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    expect(result).toContain("<accidental>flat</accidental>");
  });

  test("does not add accidental for notes in the key signature", () => {
    // G major: F# is in the key signature
    const xml = `
<fifths>1</fifths>
<measure number="1">
  <note>
    <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    expect(result).not.toContain("<accidental>");
  });

  test("adds natural accidental when cancelling key signature sharp", () => {
    // G major: F# is in key sig. F-natural needs a natural accidental.
    const xml = `
<fifths>1</fifths>
<measure number="1">
  <note>
    <pitch><step>F</step><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    expect(result).toContain("<accidental>natural</accidental>");
  });

  test("accidental propagates within a measure (same pitch+octave)", () => {
    // C major: first F#4 gets sharp, second F#4 in same measure does not
    const xml = `
<fifths>0</fifths>
<measure number="1">
  <note>
    <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
  <note>
    <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    // Count occurrences of <accidental>
    const matches = result.match(/<accidental>/g);
    expect(matches).toHaveLength(1);
  });

  test("accidentals reset at barline (new measure)", () => {
    const xml = `
<fifths>0</fifths>
<measure number="1">
  <note>
    <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
</measure>
<measure number="2">
  <note>
    <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    const matches = result.match(/<accidental>sharp<\/accidental>/g);
    expect(matches).toHaveLength(2); // both measures need the sharp
  });

  test("preserves existing accidental elements", () => {
    const xml = `
<fifths>0</fifths>
<measure number="1">
  <note>
    <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
    <accidental>sharp</accidental>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    // Should still have exactly one accidental (the original)
    const matches = result.match(/<accidental>/g);
    expect(matches).toHaveLength(1);
  });

  test("skips rests", () => {
    const xml = `
<fifths>0</fifths>
<measure number="1">
  <note>
    <rest/>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    expect(result).not.toContain("<accidental>");
  });

  test("handles flat key signatures correctly", () => {
    // F major (1 flat): Bb is in key sig
    const xml = `
<fifths>-1</fifths>
<measure number="1">
  <note>
    <pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    expect(result).not.toContain("<accidental>");
  });

  test("adds natural when cancelling flat in key signature", () => {
    // F major (1 flat): B-natural needs a natural sign
    const xml = `
<fifths>-1</fifths>
<measure number="1">
  <note>
    <pitch><step>B</step><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    expect(result).toContain("<accidental>natural</accidental>");
  });

  test("different octaves are tracked independently", () => {
    // C major: F#4 and F#5 both need sharps
    const xml = `
<fifths>0</fifths>
<measure number="1">
  <note>
    <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
  <note>
    <pitch><step>F</step><alter>1</alter><octave>5</octave></pitch>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    const matches = result.match(/<accidental>sharp<\/accidental>/g);
    expect(matches).toHaveLength(2);
  });

  test("handles no fifths element (defaults to C major)", () => {
    const xml = `
<measure number="1">
  <note>
    <pitch><step>C</step><octave>4</octave></pitch>
    <type>quarter</type>
  </note>
</measure>`;
    const result = addAccidentals(xml);
    expect(result).not.toContain("<accidental>");
  });
});

describe("fixChordSymbols", () => {
  test("removes duplicated root from kind text", () => {
    const xml = `<harmony>
  <root><root-step>D</root-step></root>
  <kind text="Dmaj7">major-seventh</kind>
</harmony>`;
    const result = fixChordSymbols(xml);
    expect(result).toContain('text="maj7"');
    expect(result).not.toContain('text="Dmaj7"');
  });

  test("leaves kind text alone when root does not match", () => {
    const xml = `<harmony>
  <root><root-step>C</root-step></root>
  <kind text="Dmaj7">major-seventh</kind>
</harmony>`;
    const result = fixChordSymbols(xml);
    expect(result).toContain('text="Dmaj7"');
  });

  test("handles root with accidental in kind text", () => {
    const xml = `<harmony>
  <root><root-step>B</root-step></root>
  <kind text="Bb7">dominant</kind>
</harmony>`;
    const result = fixChordSymbols(xml);
    expect(result).toContain('text="7"');
  });

  test("preserves harmony without root-step", () => {
    const xml = `<harmony><kind text="maj7">major-seventh</kind></harmony>`;
    const result = fixChordSymbols(xml);
    expect(result).toContain('text="maj7"');
  });

  test("handles empty kind text after stripping root", () => {
    const xml = `<harmony>
  <root><root-step>C</root-step></root>
  <kind text="C">major</kind>
</harmony>`;
    const result = fixChordSymbols(xml);
    expect(result).toContain('text=""');
  });
});

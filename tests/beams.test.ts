import { describe, test, expect } from "bun:test";
import { addBeams } from "@/lib/music/beams";

function measure(notes: string): string {
  return `<measure number="1">${notes}</measure>`;
}

function note(step: string, type: string, extra = ""): string {
  return `<note>${extra}
    <pitch><step>${step}</step><octave>4</octave></pitch>
    <type>${type}</type>
  </note>`;
}

function rest(type: string): string {
  return `<note>
    <rest/>
    <type>${type}</type>
  </note>`;
}

function chord(step: string, type: string): string {
  return `<note><chord/>
    <pitch><step>${step}</step><octave>4</octave></pitch>
    <type>${type}</type>
  </note>`;
}

describe("addBeams", () => {
  test("beams two consecutive eighth notes on the same beat", () => {
    const xml = measure(note("C", "eighth") + note("D", "eighth"));
    const result = addBeams(xml);
    expect(result).toContain('<beam number="1">begin</beam>');
    expect(result).toContain('<beam number="1">end</beam>');
  });

  test("does not beam a single eighth note", () => {
    const xml = measure(note("C", "eighth") + note("D", "quarter"));
    const result = addBeams(xml);
    expect(result).not.toContain("<beam");
  });

  test("does not beam quarter notes", () => {
    const xml = measure(note("C", "quarter") + note("D", "quarter"));
    const result = addBeams(xml);
    expect(result).not.toContain("<beam");
  });

  test("breaks beam at beat boundary in 4/4", () => {
    // Four eighth notes: first two on beat 0, next two on beat 1
    const xml = measure(note("C", "eighth") + note("D", "eighth") + note("E", "eighth") + note("F", "eighth"));
    const result = addBeams(xml);
    // Should produce two groups of two
    const begins = result.match(/<beam number="1">begin<\/beam>/g);
    const ends = result.match(/<beam number="1">end<\/beam>/g);
    expect(begins).toHaveLength(2);
    expect(ends).toHaveLength(2);
  });

  test("rest breaks beam group", () => {
    const xml = measure(note("C", "eighth") + rest("eighth") + note("E", "eighth") + note("F", "eighth"));
    const result = addBeams(xml);
    // First eighth is alone (no beam), last two are beamed
    const begins = result.match(/<beam number="1">begin<\/beam>/g);
    expect(begins).toHaveLength(1);
  });

  test("handles three eighth notes with continue", () => {
    // Three 16th notes on the same beat
    const xml = measure(note("C", "16th") + note("D", "16th") + note("E", "16th"));
    const result = addBeams(xml);
    expect(result).toContain('<beam number="1">begin</beam>');
    expect(result).toContain('<beam number="1">continue</beam>');
    expect(result).toContain('<beam number="1">end</beam>');
  });

  test("replaces existing beam elements", () => {
    const noteWithBeam = `<note>
    <pitch><step>C</step><octave>4</octave></pitch>
    <type>eighth</type>
    <beam number="1">wrong</beam>
  </note>`;
    const xml = measure(noteWithBeam + note("D", "eighth"));
    const result = addBeams(xml);
    expect(result).not.toContain(">wrong<");
    expect(result).toContain('<beam number="1">begin</beam>');
    expect(result).toContain('<beam number="1">end</beam>');
  });

  test("chord notes do not advance position or break beams", () => {
    const xml = measure(note("C", "eighth") + chord("E", "eighth") + note("D", "eighth") + chord("F", "eighth"));
    const result = addBeams(xml);
    // The two main notes should be beamed together
    expect(result).toContain('<beam number="1">begin</beam>');
    expect(result).toContain('<beam number="1">end</beam>');
  });

  test("handles empty measure", () => {
    const xml = `<measure number="1"><attributes/></measure>`;
    const result = addBeams(xml);
    expect(result).toBe(xml);
  });

  test("handles measure with only rests", () => {
    const xml = measure(rest("quarter") + rest("quarter"));
    const result = addBeams(xml);
    expect(result).not.toContain("<beam");
  });

  test("backup resets position for multi-staff beaming", () => {
    const backup = `<backup><duration>8</duration></backup>`;
    const xml = measure(
      // Staff 1: two eighths on beat 0
      note("C", "eighth") +
        note("D", "eighth") +
        // quarter notes to fill rest of measure
        note("E", "quarter") +
        note("F", "quarter") +
        backup +
        // Staff 2: two eighths on beat 0
        note("G", "eighth") +
        note("A", "eighth"),
    );
    const result = addBeams(xml);
    // Both staff sections should have beamed pairs
    const begins = result.match(/<beam number="1">begin<\/beam>/g);
    expect(begins).toHaveLength(2);
  });

  test("dotted eighth advances 0.75 quarter notes", () => {
    // Dotted eighth + sixteenth = 1 beat, should be beamed together
    const dottedEighth = `<note>
    <pitch><step>C</step><octave>4</octave></pitch>
    <type>eighth</type>
    <dot/>
  </note>`;
    const sixteenth = note("D", "16th");
    const xml = measure(dottedEighth + sixteenth);
    const result = addBeams(xml);
    expect(result).toContain('<beam number="1">begin</beam>');
    expect(result).toContain('<beam number="1">end</beam>');
  });
});

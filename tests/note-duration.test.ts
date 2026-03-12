import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";
import {
  changeNoteDuration,
  buildNoteMap,
  createScore,
} from "../lib/music/musicxml";

const SIMPLE = fs.readFileSync(path.join(__dirname, "fixtures/simple-score.xml"), "utf-8");

/** Extract all <duration> values from measure N */
function getMeasureDurations(xml: string, measureNum: number): number[] {
  const re = new RegExp(`<measure[^>]*number="${measureNum}"[^>]*>([\\s\\S]*?)<\\/measure>`);
  const m = xml.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/<duration>(\d+)<\/duration>/g)].map(m => Number(m[1]));
}

/** Extract all <type> values from measure N */
function getMeasureNoteTypes(xml: string, measureNum: number): string[] {
  const re = new RegExp(`<measure[^>]*number="${measureNum}"[^>]*>([\\s\\S]*?)<\\/measure>`);
  const m = xml.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/<type>([^<]+)<\/type>/g)].map(m => m[1]);
}

/** Total duration ticks in a measure */
function measureTotalDuration(xml: string, measureNum: number): number {
  return getMeasureDurations(xml, measureNum).reduce((a, b) => a + b, 0);
}

/** Get divisions from XML */
function getDivisions(xml: string): number {
  const m = xml.match(/<divisions>(\d+)<\/divisions>/);
  return m ? Number(m[1]) : 4;
}

describe("changeNoteDuration", () => {
  // Simple score: divisions=4, measure 1 has 4 quarter notes (C4 D4 E4 F4, dur=4 each)
  // Note: entry index 0 is the <direction> (tempo), so noteMap[0].entryIndex = 1

  test("quarter → eighth (key 4): shortens, rest fills gap", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[0], "4");

    const types = getMeasureNoteTypes(result, 1);
    expect(types[0]).toBe("eighth");
    // An eighth rest should fill the gap
    expect(types[1]).toBe("eighth");
    // Total duration unchanged
    expect(measureTotalDuration(result, 1)).toBe(measureTotalDuration(SIMPLE, 1));
  });

  test("quarter → half (key 6): lengthens, consumes next note", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[0], "6");

    const types = getMeasureNoteTypes(result, 1);
    expect(types[0]).toBe("half");
    // Should have 3 entries: half + 2 remaining quarters
    expect(getMeasureDurations(result, 1).length).toBe(3);
    expect(measureTotalDuration(result, 1)).toBe(measureTotalDuration(SIMPLE, 1));
  });

  test("quarter → whole (key 7): consumes entire measure", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[0], "7");

    const types = getMeasureNoteTypes(result, 1);
    expect(types[0]).toBe("whole");
    expect(getMeasureDurations(result, 1).length).toBe(1);
    expect(measureTotalDuration(result, 1)).toBe(measureTotalDuration(SIMPLE, 1));
  });

  test("quarter → 16th (key 3): fills with rests", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[0], "3");

    const types = getMeasureNoteTypes(result, 1);
    expect(types[0]).toBe("16th");
    expect(measureTotalDuration(result, 1)).toBe(measureTotalDuration(SIMPLE, 1));
  });

  test("same duration (quarter → quarter) is a no-op", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[0], "5");
    expect(getMeasureNoteTypes(result, 1)).toEqual(getMeasureNoteTypes(SIMPLE, 1));
  });

  test("changing middle note preserves total duration", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[1], "4"); // D4 quarter → eighth

    const types = getMeasureNoteTypes(result, 1);
    expect(types[0]).toBe("quarter"); // C4 unchanged
    expect(types[1]).toBe("eighth");  // D4 → eighth
    expect(measureTotalDuration(result, 1)).toBe(measureTotalDuration(SIMPLE, 1));
  });

  test("changing last note to shorter fills with rest", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[3], "4"); // F4 quarter → eighth

    expect(measureTotalDuration(result, 1)).toBe(measureTotalDuration(SIMPLE, 1));
  });

  test("changing last note to longer reverts (not enough space)", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[3], "6"); // F4 quarter → half

    // Should revert — last note stays quarter
    const types = getMeasureNoteTypes(result, 1);
    expect(types[types.length - 1]).toBe("quarter");
  });

  test("sequential: quarter → eighth → 16th", () => {
    const noteMap = buildNoteMap(SIMPLE);

    const step1 = changeNoteDuration(SIMPLE, noteMap[0], "4");
    expect(getMeasureNoteTypes(step1, 1)[0]).toBe("eighth");
    expect(measureTotalDuration(step1, 1)).toBe(measureTotalDuration(SIMPLE, 1));

    const noteMap2 = buildNoteMap(step1);
    const step2 = changeNoteDuration(step1, noteMap2[0], "3");
    expect(getMeasureNoteTypes(step2, 1)[0]).toBe("16th");
    expect(measureTotalDuration(step2, 1)).toBe(measureTotalDuration(SIMPLE, 1));
  });

  test("round-trip: quarter → eighth → quarter", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const step1 = changeNoteDuration(SIMPLE, noteMap[0], "4");

    const noteMap2 = buildNoteMap(step1);
    const step2 = changeNoteDuration(step1, noteMap2[0], "5");

    expect(getMeasureNoteTypes(step2, 1)[0]).toBe("quarter");
    expect(measureTotalDuration(step2, 1)).toBe(measureTotalDuration(SIMPLE, 1));
  });

  test("64th note scales divisions correctly", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[0], "1");

    const div = getDivisions(result);
    expect(div).toBeGreaterThanOrEqual(16);
    expect(getMeasureNoteTypes(result, 1)[0]).toBe("64th");
    // Total must be 4 beats * new divisions
    expect(measureTotalDuration(result, 1)).toBe(div * 4);
  });

  test("buildNoteMap count increases when rest is added", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const m1Count = noteMap.filter(n => n.measureNumber === 1).length;
    expect(m1Count).toBe(4);

    const result = changeNoteDuration(SIMPLE, noteMap[0], "4");
    const noteMap2 = buildNoteMap(result);
    const m1Count2 = noteMap2.filter(n => n.measureNumber === 1).length;
    expect(m1Count2).toBe(5); // eighth + rest + 3 quarters
  });

  test("entryIndex stays valid after duration change", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[0], "4");

    const noteMap2 = buildNoteMap(result);
    // After: eighth(C4), rest, quarter(D4), quarter(E4), quarter(F4)
    // noteMap2[2] should be D4
    const d4Pos = noteMap2[2];
    expect(d4Pos.measureNumber).toBe(1);

    const result2 = changeNoteDuration(result, d4Pos, "4");
    expect(measureTotalDuration(result2, 1)).toBe(measureTotalDuration(SIMPLE, 1));
  });

  test("removes measure='yes' attribute when resizing a measure rest", () => {
    // createScore produces whole rests with measure="yes" attribute
    const xml = createScore({
      title: "Test",
      instruments: [{ name: "Piano", midiProgram: 0, clef: "G" }],
      measures: 2,
      timeSignature: { beats: 4, beatType: 4 },
      tempo: 120,
    });

    // Verify the original has measure="yes"
    expect(xml).toContain('rest measure="yes"');

    const noteMap = buildNoteMap(xml);
    const result = changeNoteDuration(xml, noteMap[0], "4"); // whole → eighth

    // The changed rest should NOT have measure="yes" anymore
    // (measure="yes" tells renderers to display as full-measure rest regardless of duration)
    const m1 = result.match(/<measure[^>]*number="1"[^>]*>([\s\S]*?)<\/measure>/);
    expect(m1).toBeTruthy();
    // Find the first <note> in measure 1 (the one we changed)
    const firstNote = m1![1].match(/<note[^>]*>[\s\S]*?<\/note>/);
    expect(firstNote).toBeTruthy();
    expect(firstNote![0]).not.toContain('measure="yes"');
    expect(firstNote![0]).toContain("<type>eighth</type>");
  });

  test("multi-staff piano: duration change preserves both staves", () => {
    const xml = createScore({
      title: "Test",
      instruments: [{ name: "Piano", midiProgram: 0, clef: "G" }],
      measures: 2,
      timeSignature: { beats: 4, beatType: 4 },
      tempo: 120,
    });

    const noteMap = buildNoteMap(xml);
    const result = changeNoteDuration(xml, noteMap[0], "4"); // first staff rest → eighth

    // Both backup and staff 2 rest should still be present
    expect(result).toContain("<backup>");
    const m1 = result.match(/<measure[^>]*number="1"[^>]*>([\s\S]*?)<\/measure>/);
    expect(m1).toBeTruthy();
    // Staff 2 whole rest should be untouched
    expect(m1![1]).toContain("<staff>2</staff>");
  });

  test("does not affect other measures", () => {
    const noteMap = buildNoteMap(SIMPLE);
    const result = changeNoteDuration(SIMPLE, noteMap[0], "4");

    // Measure 2 should be untouched
    expect(measureTotalDuration(result, 2)).toBe(measureTotalDuration(SIMPLE, 2));
    expect(getMeasureNoteTypes(result, 2)).toEqual(getMeasureNoteTypes(SIMPLE, 2));
  });
});

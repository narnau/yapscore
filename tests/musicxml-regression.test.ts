/**
 * Regression tests for recently added / recently fixed musicxml.ts functions.
 *
 * Covers:
 *  - clearMeasures with staff parameter (bug: used to wipe both staves)
 *  - addChordSymbols: replaces existing chords (no stacking)
 *  - addChordSymbols: returns error for non-existent measure
 *  - addChordSymbols: basic happy path
 *  - addArticulations with partId (bug: used to apply to all parts)
 *  - removeArticulations
 *  - insertPickupMeasure preserves attributes in new first measure
 *  - setSwing / getSwing round-trip
 */

import { describe, test, expect } from "bun:test";
import {
  createScore,
  clearMeasures,
  addChordSymbols,
  addArticulations,
  removeArticulations,
  setMeasureNotes,
  insertPickupMeasure,
  setSwing,
  getSwing,
} from "../lib/music/musicxml";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a 4-measure piano score (two staves) */
function pianoScore() {
  return createScore({
    instruments: [{ name: "Piano", staves: 2 }],
    measures: 4,
  });
}

/** Build a 2-instrument score (flute + piano) */
function flutePianoScore() {
  return createScore({
    instruments: [{ name: "Flute" }, { name: "Piano" }],
    measures: 4,
  });
}

function countOccurrences(xml: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = xml.indexOf(needle, pos)) !== -1) {
    count++;
    pos++;
  }
  return count;
}

// ─── clearMeasures + staff ────────────────────────────────────────────────────

describe("clearMeasures – staff-specific", () => {
  test("clears only staff 2 notes, leaves staff 1 notes intact", () => {
    let xml = pianoScore();
    // Write distinct notes to each staff
    xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 5, duration: "whole" }], "P1", 1); // treble
    xml = setMeasureNotes(xml, 1, [{ step: "G", octave: 2, duration: "whole" }], "P1", 2); // bass

    // Clear only the bass clef (staff 2)
    const cleared = clearMeasures(xml, [1], "P1", 2);

    expect(cleared).toContain("<step>C</step>"); // treble still there
    expect(cleared).not.toContain("<step>G</step>"); // bass gone
  });

  test("clears only staff 1 notes, leaves staff 2 notes intact", () => {
    let xml = pianoScore();
    xml = setMeasureNotes(xml, 1, [{ step: "E", octave: 5, duration: "whole" }], "P1", 1);
    xml = setMeasureNotes(xml, 1, [{ step: "A", octave: 2, duration: "whole" }], "P1", 2);

    const cleared = clearMeasures(xml, [1], "P1", 1);

    expect(cleared).not.toContain("<step>E</step>"); // treble gone
    expect(cleared).toContain("<step>A</step>"); // bass still there
  });

  test("clears all staves when no staff param (original behavior)", () => {
    let xml = pianoScore();
    xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 5, duration: "whole" }], "P1", 1);
    xml = setMeasureNotes(xml, 1, [{ step: "G", octave: 2, duration: "whole" }], "P1", 2);

    const cleared = clearMeasures(xml, [1], "P1");

    expect(cleared).not.toContain("<step>C</step>");
    expect(cleared).not.toContain("<step>G</step>");
  });

  test("cleared staff gets a whole rest replacement", () => {
    let xml = pianoScore();
    xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 4, duration: "whole" }], "P1", 1);
    xml = setMeasureNotes(xml, 1, [{ step: "F", octave: 3, duration: "whole" }], "P1", 2);

    const cleared = clearMeasures(xml, [1], "P1", 2);

    // Should have a rest entry (rest element in XML)
    expect(cleared).toContain("<rest");
  });

  test("only clears the specified measure number", () => {
    let xml = pianoScore();
    xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 4, duration: "whole" }], "P1", 2);
    xml = setMeasureNotes(xml, 2, [{ step: "D", octave: 4, duration: "whole" }], "P1", 2);

    const cleared = clearMeasures(xml, [1], "P1", 2);

    // Measure 1 bass cleared, measure 2 bass still has D
    expect(cleared).toContain("<step>D</step>");
  });
});

// ─── addChordSymbols ──────────────────────────────────────────────────────────

describe("addChordSymbols", () => {
  test("adds a chord symbol to an existing measure", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const result = addChordSymbols(xml, 1, [{ root: "C", kind: "maj7" }]);

    expect(result.error).toBeUndefined();
    expect(result.xml).toContain("<harmony");
    expect(result.xml).toContain("<root-step>C</root-step>");
    expect(result.xml).toContain("major-seventh");
  });

  test("returns error for non-existent measure (does NOT silently succeed)", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    // Measure 8 does not exist in a 4-measure score
    const result = addChordSymbols(xml, 8, [{ root: "G", kind: "7" }]);

    expect(result.error).toBeDefined();
    expect(result.error).toContain("Measure 8 does not exist");
    expect(result.error).toContain("4 measures");
    // XML unchanged
    expect(result.xml).not.toContain("<harmony");
  });

  test("replaces existing chords — does NOT stack duplicates", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });

    // Add Cmaj7 first
    const first = addChordSymbols(xml, 1, [{ root: "C", kind: "maj7" }]);
    expect(first.error).toBeUndefined();

    // Overwrite with Am7 — should replace, not add on top
    const second = addChordSymbols(first.xml, 1, [{ root: "A", kind: "m7" }]);
    expect(second.error).toBeUndefined();

    // Should have exactly one <harmony> block
    const harmonyCount = countOccurrences(second.xml, "<harmony");
    expect(harmonyCount).toBe(1);

    // New chord is present, old chord is gone
    expect(second.xml).toContain("<root-step>A</root-step>");
    expect(second.xml).not.toContain("<root-step>C</root-step>");
  });

  test("adds multiple chords on different beats", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const result = addChordSymbols(xml, 1, [
      { root: "C", kind: "", beat: 1 },
      { root: "G", kind: "7", beat: 3 },
    ]);
    expect(result.error).toBeUndefined();
    expect(countOccurrences(result.xml, "<harmony")).toBe(2);
  });

  test("returns error for non-existent part", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const result = addChordSymbols(xml, 1, [{ root: "C", kind: "" }], "P99");
    expect(result.error).toContain("P99");
  });

  test("replacing chords on measure 2 does not affect measure 1", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const r1 = addChordSymbols(xml, 1, [{ root: "F", kind: "" }]);
    const r2 = addChordSymbols(r1.xml, 2, [{ root: "G", kind: "7" }]);
    // Both measures have their chord
    expect(r2.xml).toContain("<root-step>F</root-step>");
    expect(r2.xml).toContain("<root-step>G</root-step>");
  });
});

// ─── addArticulations with partId ────────────────────────────────────────────

describe("addArticulations – partId targeting", () => {
  test("applies to all parts when no partId given", () => {
    let xml = flutePianoScore();
    xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 5, duration: "quarter" }], "P1");
    xml = setMeasureNotes(xml, 1, [{ step: "G", octave: 4, duration: "quarter" }], "P2");

    const result = addArticulations(xml, [1], "staccato");

    // Both parts should have staccato
    const staccatoCount = countOccurrences(result, "<staccato/>");
    expect(staccatoCount).toBeGreaterThanOrEqual(2);
  });

  test("applies only to specified partId when given", () => {
    let xml = flutePianoScore();
    xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 5, duration: "quarter" }], "P1");
    xml = setMeasureNotes(xml, 1, [{ step: "G", octave: 4, duration: "quarter" }], "P2");

    const result = addArticulations(xml, [1], "staccato", "P1");

    // Exactly 1 staccato (only flute)
    const staccatoCount = countOccurrences(result, "<staccato/>");
    expect(staccatoCount).toBe(1);
  });

  test("does not modify the other part's notes when partId restricts", () => {
    let xml = flutePianoScore();
    xml = setMeasureNotes(xml, 1, [{ step: "D", octave: 5, duration: "quarter" }], "P1");
    xml = setMeasureNotes(xml, 1, [{ step: "B", octave: 4, duration: "quarter" }], "P2");

    // Apply only to P2 (piano)
    const result = addArticulations(xml, [1], "accent", "P2");

    // Find P1 section — should have no articulation
    const p1Start = result.indexOf('<part id="P1"');
    const p1End = result.indexOf("</part>", p1Start);
    const p1Section = result.slice(p1Start, p1End);
    expect(p1Section).not.toContain("<accent/>");

    // P2 section should have accent
    const p2Start = result.indexOf('<part id="P2"');
    const p2End = result.indexOf("</part>", p2Start);
    const p2Section = result.slice(p2Start, p2End);
    expect(p2Section).toContain("<accent/>");
  });
});

// ─── removeArticulations ─────────────────────────────────────────────────────

describe("removeArticulations", () => {
  test("removes all articulations from specified measures", () => {
    let xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 4, duration: "quarter" }], "P1");
    xml = addArticulations(xml, [1], "staccato");

    expect(xml).toContain("<staccato/>");

    const result = removeArticulations(xml, [1]);
    expect(result).not.toContain("<staccato/>");
  });

  test("removes only the specified articulation type when given", () => {
    let xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    xml = setMeasureNotes(
      xml,
      1,
      [
        { step: "C", octave: 4, duration: "quarter" },
        { step: "E", octave: 4, duration: "quarter" },
      ],
      "P1",
    );
    xml = addArticulations(xml, [1], "staccato");
    xml = addArticulations(xml, [1], "accent");

    // Remove only staccato
    const result = removeArticulations(xml, [1], "staccato");
    expect(result).not.toContain("<staccato/>");
    expect(result).toContain("<accent/>");
  });

  test("does not affect other measures", () => {
    let xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 4, duration: "quarter" }], "P1");
    xml = setMeasureNotes(xml, 2, [{ step: "D", octave: 4, duration: "quarter" }], "P1");
    xml = addArticulations(xml, [1, 2], "staccato");

    // Remove only measure 1
    const result = removeArticulations(xml, [1]);

    // Count staccatos — measure 2 should still have its staccato
    const staccatoCount = countOccurrences(result, "<staccato/>");
    expect(staccatoCount).toBeGreaterThanOrEqual(1);
  });

  test("removes only from specified part when partId given", () => {
    let xml = flutePianoScore();
    xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 5, duration: "quarter" }], "P1");
    xml = setMeasureNotes(xml, 1, [{ step: "G", octave: 4, duration: "quarter" }], "P2");
    xml = addArticulations(xml, [1], "staccato"); // both parts

    const result = removeArticulations(xml, [1], undefined, "P1");

    // P2 still has staccato, P1 doesn't
    const p1Start = result.indexOf('<part id="P1"');
    const p1End = result.indexOf("</part>", p1Start);
    expect(result.slice(p1Start, p1End)).not.toContain("<staccato/>");

    const p2Start = result.indexOf('<part id="P2"');
    const p2End = result.indexOf("</part>", p2Start);
    expect(result.slice(p2Start, p2End)).toContain("<staccato/>");
  });
});

// ─── insertPickupMeasure ──────────────────────────────────────────────────────

describe("insertPickupMeasure", () => {
  test("pickup measure contains attributes (divisions, clef, key, time)", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const result = insertPickupMeasure(xml, 2);

    // First measure should have attributes
    const firstMeasureEnd = result.indexOf("</measure>");
    const firstMeasure = result.slice(result.indexOf("<measure"), firstMeasureEnd);
    expect(firstMeasure).toContain("<divisions>");
    expect(firstMeasure).toContain("<clef number=");
  });

  test("score still has correct total measure count after pickup", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const result = insertPickupMeasure(xml, 2);

    // Should have 5 measures total (1 pickup + 4 original)
    const measureCount = countOccurrences(result, "<measure number=");
    expect(measureCount).toBe(5);
  });

  test("pickup measure has implicit=yes attribute", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const result = insertPickupMeasure(xml, 2);
    expect(result).toContain('implicit="yes"');
  });
});

// ─── setSwing / getSwing ──────────────────────────────────────────────────────

describe("setSwing / getSwing", () => {
  test("getSwing returns null on a fresh score", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    expect(getSwing(xml)).toBeNull();
  });

  test("setSwing + getSwing round-trip", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const swung = setSwing(xml, { first: 2, second: 1, swingType: "eighth" });
    const info = getSwing(swung);
    expect(info).not.toBeNull();
    expect(info!.first).toBe(2);
    expect(info!.second).toBe(1);
    expect(info!.swingType).toBe("eighth");
  });

  test("setSwing with null removes swing marking", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const swung = setSwing(xml, { first: 2, second: 1, swingType: "eighth" });
    const straight = setSwing(swung, null);
    expect(getSwing(straight)).toBeNull();
  });

  test("setting swing twice does not duplicate the marking", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const once = setSwing(xml, { first: 2, second: 1, swingType: "eighth" });
    const twice = setSwing(once, { first: 2, second: 1, swingType: "eighth" });
    // Should appear only once
    const swingTagCount = countOccurrences(twice, "<swing>");
    expect(swingTagCount).toBe(1);
  });
});

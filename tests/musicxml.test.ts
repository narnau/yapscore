import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";
import {
  extractParts,
  extractSelectedMeasures,
  reconstructMusicXml,
  spliceMeasuresBack,
  renumberMeasures,
  deleteMeasures,
  clearMeasures,
  insertEmptyMeasures,
  duplicateMeasures,
  transposeMeasures,
  repeatSection,
} from "../lib/musicxml";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures/simple-score.xml"),
  "utf-8"
);

// ─── extractParts ────────────────────────────────────────────────────────────

describe("extractParts", () => {
  test("extracts parts and produces a skeleton with __PARTS__ placeholder", () => {
    const { skeleton, parts, context } = extractParts(FIXTURE);
    expect(skeleton).toContain("__PARTS__");
    expect(skeleton).not.toContain("<measure");
    expect(parts).toContain('<part id="P1">');
    expect(parts).toContain("</part>");
    expect(parts).toContain('<measure number="1"');
    expect(parts).toContain('<measure number="4"');
  });

  test("context includes instrument, key, time sig, measure count", () => {
    const { context } = extractParts(FIXTURE);
    expect(context).toContain("Piano");
    expect(context).toContain("C major");
    expect(context).toContain("4/4");
    expect(context).toContain("Measures: 4");
  });

  test("throws on XML with no <part> elements", () => {
    expect(() => extractParts("<score-partwise></score-partwise>")).toThrow();
  });
});

// ─── reconstructMusicXml ─────────────────────────────────────────────────────

describe("reconstructMusicXml", () => {
  test("round-trips: extract then reconstruct produces valid XML", () => {
    const { skeleton, parts } = extractParts(FIXTURE);
    const result = reconstructMusicXml(skeleton, parts);
    expect(result).toContain('<part id="P1">');
    expect(result).toContain('<measure number="1"');
    expect(result).toContain('<measure number="4"');
    expect(result).toContain("</score-partwise>");
  });

  test("strips XML declaration from LLM response", () => {
    const { skeleton, parts } = extractParts(FIXTURE);
    const withDecl = '<?xml version="1.0"?>\n' + parts;
    const result = reconstructMusicXml(skeleton, withDecl);
    expect(result).toContain('<part id="P1">');
    // Should not have double XML declarations
    const declCount = (result.match(/<\?xml/g) || []).length;
    expect(declCount).toBe(1);
  });

  test("handles LLM returning full score-partwise instead of just parts", () => {
    const { skeleton } = extractParts(FIXTURE);
    // Simulate LLM returning the whole thing
    const result = reconstructMusicXml(skeleton, FIXTURE);
    expect(result).toContain('<part id="P1">');
    expect(result).toContain('<measure number="1"');
  });

  test("auto-adds score-part for new part IDs", () => {
    const { skeleton, parts } = extractParts(FIXTURE);
    const newPart = `<part id="P2"><measure number="1"><note><rest/><duration>16</duration><type>whole</type></note></measure></part>`;
    const result = reconstructMusicXml(skeleton, parts + "\n" + newPart);
    expect(result).toContain('<score-part id="P2">');
  });
});

// ─── extractSelectedMeasures ─────────────────────────────────────────────────

describe("extractSelectedMeasures", () => {
  test("extracts only the requested measure numbers", () => {
    const { selectedMeasures } = extractSelectedMeasures(FIXTURE, [2, 3]);
    expect(selectedMeasures).toContain('<measure number="2"');
    expect(selectedMeasures).toContain('<measure number="3"');
    expect(selectedMeasures).not.toContain('<measure number="1"');
    expect(selectedMeasures).not.toContain('<measure number="4"');
  });

  test("returns empty string for non-existent measure numbers", () => {
    const { selectedMeasures } = extractSelectedMeasures(FIXTURE, [99]);
    expect(selectedMeasures).toBe("");
  });
});

// ─── spliceMeasuresBack ─────────────────────────────────────────────────────

describe("spliceMeasuresBack", () => {
  test("replaces a modified measure while keeping others intact", () => {
    const modifiedMeasure2 = `<measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>`;
    const result = spliceMeasuresBack(FIXTURE, modifiedMeasure2);
    // Measure 2 should be replaced
    expect(result).toContain("<type>whole</type>");
    // Measure 1 should be untouched
    expect(result).toContain('<measure number="1"');
    expect(result).toContain("<step>C</step><octave>4</octave>");
  });

  test("deletes a measure when sentMeasureNumbers provided and measure missing from response", () => {
    // Send measure 3, return nothing → measure 3 should be deleted
    // Original had 4 measures, should now have 3
    const result = spliceMeasuresBack(FIXTURE, "", [3]);
    const measureNums = [...result.matchAll(/number="(\d+)"/g)].map((m) =>
      parseInt(m[1])
    );
    expect(measureNums).toEqual([1, 2, 3]);
    // The original measure 3 had a whole note C5, measure 4 had a rest
    // After deletion, new measure 3 should be the old measure 4 (rest)
    expect(result).toContain("<rest/>");
  });

  test("renumbers measures after deletion", () => {
    // Delete measure 2: send [2], return empty
    const result = spliceMeasuresBack(FIXTURE, "", [2]);
    // Original had 4 measures, now should have 3 numbered 1, 2, 3
    const measureNums = [...result.matchAll(/number="(\d+)"/g)].map((m) =>
      parseInt(m[1])
    );
    expect(measureNums).toEqual([1, 2, 3]);
  });

  test("keeps all measures when sentMeasureNumbers not provided and measure missing", () => {
    // Without sentMeasureNumbers, missing measures are NOT deleted (backward compat)
    const result = spliceMeasuresBack(FIXTURE, "");
    const measureNums = [...result.matchAll(/number="(\d+)"/g)].map((m) =>
      parseInt(m[1])
    );
    expect(measureNums).toEqual([1, 2, 3, 4]);
  });

  test("handles partial replacement + deletion in same operation", () => {
    // Send measures [2, 3], return only modified measure 2 → measure 3 deleted
    const modifiedMeasure2 = `<measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>`;
    const result = spliceMeasuresBack(FIXTURE, modifiedMeasure2, [2, 3]);
    // Measure 3 deleted, remaining renumbered
    const measureNums = [...result.matchAll(/number="(\d+)"/g)].map((m) =>
      parseInt(m[1])
    );
    expect(measureNums).toEqual([1, 2, 3]);
    // Measure 2 should have the whole note
    expect(result).toContain("<type>whole</type>");
  });
});

// ─── renumberMeasures ────────────────────────────────────────────────────────

describe("renumberMeasures", () => {
  test("renumbers measures sequentially from 1", () => {
    const xml = `<part id="P1">
      <measure number="1"><note/></measure>
      <measure number="5"><note/></measure>
      <measure number="10"><note/></measure>
    </part>`;
    const result = renumberMeasures(xml);
    const nums = [...result.matchAll(/number="(\d+)"/g)].map((m) =>
      parseInt(m[1])
    );
    expect(nums).toEqual([1, 2, 3]);
  });

  test("renumbers each part independently", () => {
    const xml = `<part id="P1">
      <measure number="3"><note/></measure>
      <measure number="7"><note/></measure>
    </part>
    <part id="P2">
      <measure number="3"><note/></measure>
      <measure number="7"><note/></measure>
    </part>`;
    const result = renumberMeasures(xml);
    const nums = [...result.matchAll(/number="(\d+)"/g)].map((m) =>
      parseInt(m[1])
    );
    // Both parts renumbered independently: [1,2] + [1,2]
    expect(nums).toEqual([1, 2, 1, 2]);
  });
});

// ─── delete vs clear measure scenarios ──────────────────────────────────────

describe("delete vs clear measure", () => {
  test("DELETE: omitted measure is removed, total count decreases", () => {
    // Select measure 2, LLM returns nothing → delete it
    const result = spliceMeasuresBack(FIXTURE, "", [2]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map(
      (m) => parseInt(m[1])
    );
    expect(nums).toEqual([1, 2, 3]); // was 4, now 3
    // Old measure 1 content (C D E F) should still be in measure 1
    expect(result).toContain("<step>C</step><octave>4</octave>");
  });

  test("CLEAR: measure replaced with whole rest, total count stays same", () => {
    // Select measure 2, LLM returns a cleared measure (whole rest)
    const clearedMeasure = `<measure number="2">
      <note><rest/><duration>16</duration><type>whole</type></note>
    </measure>`;
    const result = spliceMeasuresBack(FIXTURE, clearedMeasure, [2]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map(
      (m) => parseInt(m[1])
    );
    expect(nums).toEqual([1, 2, 3, 4]); // count unchanged
    // Measure 2 should now be a rest, not G A B C
    expect(result).not.toContain("<step>G</step><octave>4</octave>");
    // But original measure 2 position should have a rest
    const m2Match = result.match(
      /<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/
    );
    expect(m2Match).not.toBeNull();
    expect(m2Match![1]).toContain("<rest/>");
  });

  test("DELETE multiple consecutive measures", () => {
    // Delete measures 2 and 3
    const result = spliceMeasuresBack(FIXTURE, "", [2, 3]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map(
      (m) => parseInt(m[1])
    );
    expect(nums).toEqual([1, 2]); // was 4, now 2
  });

  test("DELETE first measure preserves attributes in new first measure", () => {
    // Delete measure 1 — the attributes (key, time, clef) were in measure 1
    // After deletion, measure 2 becomes measure 1
    const result = spliceMeasuresBack(FIXTURE, "", [1]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map(
      (m) => parseInt(m[1])
    );
    expect(nums).toEqual([1, 2, 3]);
    // New measure 1 should be old measure 2 content (G A B C)
    expect(result).toContain("<step>G</step><octave>4</octave>");
  });

  test("DELETE last measure", () => {
    const result = spliceMeasuresBack(FIXTURE, "", [4]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map(
      (m) => parseInt(m[1])
    );
    expect(nums).toEqual([1, 2, 3]);
  });
});

// ─── deleteMeasures (deterministic) ─────────────────────────────────────────

describe("deleteMeasures", () => {
  test("deletes a single measure and renumbers", () => {
    const result = deleteMeasures(FIXTURE, [2]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map(
      (m) => parseInt(m[1])
    );
    expect(nums).toEqual([1, 2, 3]);
    // Old measure 2 had G A B C — should be gone
    expect(result).not.toContain("<step>G</step><octave>4</octave>");
    // Old measure 1 content should remain
    expect(result).toContain("<step>C</step><octave>4</octave>");
  });

  test("deletes multiple measures", () => {
    const result = deleteMeasures(FIXTURE, [1, 3]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map(
      (m) => parseInt(m[1])
    );
    expect(nums).toEqual([1, 2]);
  });

  test("deletes all but one measure", () => {
    const result = deleteMeasures(FIXTURE, [1, 2, 3]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map(
      (m) => parseInt(m[1])
    );
    expect(nums).toEqual([1]);
    // Should be the old measure 4 (rest)
    expect(result).toContain("<rest/>");
  });
});

// ─── clearMeasures (deterministic) ──────────────────────────────────────────

describe("clearMeasures", () => {
  test("clears a measure, replacing content with whole rest", () => {
    const result = clearMeasures(FIXTURE, [2]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map(
      (m) => parseInt(m[1])
    );
    // Measure count unchanged
    expect(nums).toEqual([1, 2, 3, 4]);
    // Measure 2 should have a rest, not G A B C
    const m2 = result.match(
      /<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/
    );
    expect(m2).not.toBeNull();
    expect(m2![1]).toContain("<rest/>");
    expect(m2![1]).not.toContain("<step>G</step>");
  });

  test("clears first measure but preserves attributes", () => {
    const result = clearMeasures(FIXTURE, [1]);
    const m1 = result.match(
      /<measure\b[^>]*number="1"[^>]*>([\s\S]*?)<\/measure>/
    );
    expect(m1).not.toBeNull();
    // Attributes (key, time, clef) should be preserved
    expect(m1![1]).toContain("<attributes>");
    expect(m1![1]).toContain("<divisions>");
    expect(m1![1]).toContain("<key>");
    // But notes should be replaced with rest
    expect(m1![1]).toContain("<rest/>");
    expect(m1![1]).not.toContain("<step>C</step>");
  });

  test("clears multiple measures", () => {
    const result = clearMeasures(FIXTURE, [1, 2, 3]);
    // All three should be rests
    for (const num of [1, 2, 3]) {
      const m = result.match(
        new RegExp(`<measure\\b[^>]*number="${num}"[^>]*>([\\s\\S]*?)</measure>`)
      );
      expect(m).not.toBeNull();
      expect(m![1]).toContain("<rest/>");
    }
    // Measure 4 unchanged (already a rest, but untouched)
    expect(result).toContain('<measure number="4"');
  });

  test("computes correct duration for whole rest", () => {
    const result = clearMeasures(FIXTURE, [2]);
    // Fixture has divisions=4, 4/4 time → whole rest duration = 4 * 4 * (4/4) = 16
    const m2 = result.match(
      /<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/
    );
    expect(m2![1]).toContain("<duration>16</duration>");
  });
});

// ─── insertEmptyMeasures ────────────────────────────────────────────────────

describe("insertEmptyMeasures", () => {
  test("inserts one empty measure after measure 2", () => {
    const result = insertEmptyMeasures(FIXTURE, 2, 1);
    const nums = getMeasureNums(result);
    expect(nums).toEqual([1, 2, 3, 4, 5]);
    // New measure 3 should be a rest
    const m3 = getMeasureContent(result, 3);
    expect(m3).toContain("<rest/>");
    // Old measure 3 (whole note C5) is now measure 4
    const m4 = getMeasureContent(result, 4);
    expect(m4).toContain("<step>C</step><octave>5</octave>");
  });

  test("inserts at the beginning (afterMeasure=0)", () => {
    const result = insertEmptyMeasures(FIXTURE, 0, 2);
    const nums = getMeasureNums(result);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6]);
    // First two should be rests
    expect(getMeasureContent(result, 1)).toContain("<rest/>");
    expect(getMeasureContent(result, 2)).toContain("<rest/>");
    // Old measure 1 is now measure 3
    expect(getMeasureContent(result, 3)).toContain("<step>C</step><octave>4</octave>");
  });

  test("appends at the end", () => {
    const result = insertEmptyMeasures(FIXTURE, 4, 3);
    const nums = getMeasureNums(result);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Original measures unchanged
    expect(getMeasureContent(result, 1)).toContain("<step>C</step><octave>4</octave>");
  });

  test("uses correct whole rest duration", () => {
    const result = insertEmptyMeasures(FIXTURE, 1, 1);
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain("<duration>16</duration>");
  });
});

// ─── duplicateMeasures ──────────────────────────────────────────────────────

describe("duplicateMeasures", () => {
  test("duplicates a single measure", () => {
    const result = duplicateMeasures(FIXTURE, [2]);
    const nums = getMeasureNums(result);
    expect(nums).toEqual([1, 2, 3, 4, 5]);
    // Measure 3 should be a copy of measure 2 (G A B C)
    expect(getMeasureContent(result, 3)).toContain("<step>G</step>");
    expect(getMeasureContent(result, 3)).toContain("<step>A</step>");
  });

  test("duplicates a range of measures", () => {
    const result = duplicateMeasures(FIXTURE, [1, 2]);
    const nums = getMeasureNums(result);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6]);
    // Measures 3-4 should be copies of 1-2
    expect(getMeasureContent(result, 3)).toContain("<step>C</step><octave>4</octave>");
    expect(getMeasureContent(result, 4)).toContain("<step>G</step>");
  });

  test("duplicated measures don't have attributes", () => {
    // Duplicating measure 1 (which has attributes) — copy should not have them
    const result = duplicateMeasures(FIXTURE, [1]);
    const m2 = getMeasureContent(result, 2);
    expect(m2).not.toContain("<attributes>");
  });
});

// ─── transposeMeasures ──────────────────────────────────────────────────────

describe("transposeMeasures", () => {
  test("transposes up by a major third (4 semitones)", () => {
    // Measure 1 starts with C4 → should become E4
    const result = transposeMeasures(FIXTURE, [1], 4);
    const m1 = getMeasureContent(result, 1);
    expect(m1).toContain("<step>E</step>");
    // D4 → F#4
    expect(m1).toContain("<step>F</step>");
    expect(m1).toContain("<alter>1</alter>");
    // Measure 2 should be untouched (G4 still there)
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain("<step>G</step><octave>4</octave>");
  });

  test("transposes down by a perfect fifth (7 semitones)", () => {
    // G4 → C4
    const result = transposeMeasures(FIXTURE, [2], -7);
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain("<step>C</step><octave>4</octave>");
  });

  test("transposes entire score when measureNumbers is null", () => {
    // Transpose everything up an octave (12 semitones)
    const result = transposeMeasures(FIXTURE, null, 12);
    // C4 → C5
    const m1 = getMeasureContent(result, 1);
    expect(m1).toContain("<step>C</step>");
    expect(m1).toContain("<octave>5</octave>");
  });

  test("handles octave wrap correctly", () => {
    // B4 in measure 2 → up 1 semitone → C5
    const result = transposeMeasures(FIXTURE, [2], 1);
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain("<step>C</step>");
    expect(m2).toContain("<octave>5</octave>");
  });

  test("handles downward wrap correctly", () => {
    // C4 → down 1 semitone → B3
    const result = transposeMeasures(FIXTURE, [1], -1);
    const m1 = getMeasureContent(result, 1);
    expect(m1).toContain("<step>B</step>");
    expect(m1).toContain("<octave>3</octave>");
  });

  test("does not affect rests", () => {
    // Measure 4 is all rests — should be unchanged
    const result = transposeMeasures(FIXTURE, [4], 5);
    const m4 = getMeasureContent(result, 4);
    expect(m4).toContain("<rest/>");
    expect(m4).not.toContain("<pitch>");
  });
});

// ─── repeatSection ──────────────────────────────────────────────────────────

describe("repeatSection", () => {
  test("repeats measures 1-2 once (total: 2 copies)", () => {
    const result = repeatSection(FIXTURE, 1, 2, 1);
    const nums = getMeasureNums(result);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6]);
    // Measures 3-4 should be copies of 1-2
    expect(getMeasureContent(result, 3)).toContain("<step>C</step><octave>4</octave>");
    expect(getMeasureContent(result, 4)).toContain("<step>G</step>");
  });

  test("repeats a single measure twice", () => {
    const result = repeatSection(FIXTURE, 3, 3, 2);
    const nums = getMeasureNums(result);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6]);
    // Measures 4 and 5 should be copies of measure 3 (whole C5)
    expect(getMeasureContent(result, 4)).toContain("<step>C</step><octave>5</octave>");
    expect(getMeasureContent(result, 5)).toContain("<step>C</step><octave>5</octave>");
  });

  test("repeated copies don't have attributes", () => {
    const result = repeatSection(FIXTURE, 1, 1, 1);
    const m2 = getMeasureContent(result, 2);
    expect(m2).not.toContain("<attributes>");
  });
});

// ─── test helpers ───────────────────────────────────────────────────────────

function getMeasureNums(xml: string): number[] {
  return [...xml.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) =>
    parseInt(m[1])
  );
}

function getMeasureContent(xml: string, num: number): string {
  const m = xml.match(
    new RegExp(`<measure\\b[^>]*number="${num}"[^>]*>([\\s\\S]*?)</measure>`)
  );
  return m?.[1] ?? "";
}

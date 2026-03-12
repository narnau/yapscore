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
  setTempo,
  getTempo,
  addDynamics,
  addArticulations,
  addRepeatBarlines,
  addVoltaBrackets,
  addHairpin,
  changeKey,
  scaleNoteDurations,
  addTextAnnotation,
  setMeasureNotes,
  setTimeSignature,
} from "../lib/music/musicxml";
import type { NoteSpec } from "../lib/music/musicxml";

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures/simple-score.xml"), "utf-8");

const TWO_PART_FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures/two-part-score.xml"), "utf-8");

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
    expect(norm(result)).toContain("<step>C</step><octave>4</octave>");
  });

  test("deletes a measure when sentMeasureNumbers provided and measure missing from response", () => {
    // Send measure 3, return nothing → measure 3 should be deleted
    // Original had 4 measures, should now have 3
    const result = spliceMeasuresBack(FIXTURE, "", [3]);
    const measureNums = [...result.matchAll(/number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(measureNums).toEqual([1, 2, 3]);
    // The original measure 3 had a whole note C5, measure 4 had a rest
    // After deletion, new measure 3 should be the old measure 4 (rest)
    expect(result).toMatch(/<rest[\s/>]/);
  });

  test("renumbers measures after deletion", () => {
    // Delete measure 2: send [2], return empty
    const result = spliceMeasuresBack(FIXTURE, "", [2]);
    // Original had 4 measures, now should have 3 numbered 1, 2, 3
    const measureNums = [...result.matchAll(/number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(measureNums).toEqual([1, 2, 3]);
  });

  test("keeps all measures when sentMeasureNumbers not provided and measure missing", () => {
    // Without sentMeasureNumbers, missing measures are NOT deleted (backward compat)
    const result = spliceMeasuresBack(FIXTURE, "");
    const measureNums = [...result.matchAll(/number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(measureNums).toEqual([1, 2, 3, 4]);
  });

  test("handles partial replacement + deletion in same operation", () => {
    // Send measures [2, 3], return only modified measure 2 → measure 3 deleted
    const modifiedMeasure2 = `<measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>`;
    const result = spliceMeasuresBack(FIXTURE, modifiedMeasure2, [2, 3]);
    // Measure 3 deleted, remaining renumbered
    const measureNums = [...result.matchAll(/number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(measureNums).toEqual([1, 2, 3]);
    // Measure 2 should have the whole note
    expect(result).toContain("<type>whole</type>");
  });
});

// ─── renumberMeasures ────────────────────────────────────────────────────────

describe("renumberMeasures", () => {
  test("renumbers measures sequentially from 1", () => {
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">
      <measure number="1"><note><rest/><duration>4</duration><type>whole</type></note></measure>
      <measure number="5"><note><rest/><duration>4</duration><type>whole</type></note></measure>
      <measure number="10"><note><rest/><duration>4</duration><type>whole</type></note></measure>
    </part></score-partwise>`;
    const result = renumberMeasures(xml);
    const nums = getMeasureNums(result);
    expect(nums).toEqual([1, 2, 3]);
  });

  test("renumbers each part independently", () => {
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P1</part-name></score-part><score-part id="P2"><part-name>P2</part-name></score-part></part-list><part id="P1">
      <measure number="3"><note><rest/><duration>4</duration><type>whole</type></note></measure>
      <measure number="7"><note><rest/><duration>4</duration><type>whole</type></note></measure>
    </part>
    <part id="P2">
      <measure number="3"><note><rest/><duration>4</duration><type>whole</type></note></measure>
      <measure number="7"><note><rest/><duration>4</duration><type>whole</type></note></measure>
    </part></score-partwise>`;
    const result = renumberMeasures(xml);
    const nums = getMeasureNums(result);
    // Both parts renumbered independently: [1,2] + [1,2]
    expect(nums).toEqual([1, 2, 1, 2]);
  });
});

// ─── delete vs clear measure scenarios ──────────────────────────────────────

describe("delete vs clear measure", () => {
  test("DELETE: omitted measure is removed, total count decreases", () => {
    // Select measure 2, LLM returns nothing → delete it
    const result = spliceMeasuresBack(FIXTURE, "", [2]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(nums).toEqual([1, 2, 3]); // was 4, now 3
    // Old measure 1 content (C D E F) should still be in measure 1
    expect(norm(result)).toContain("<step>C</step><octave>4</octave>");
  });

  test("CLEAR: measure replaced with whole rest, total count stays same", () => {
    // Select measure 2, LLM returns a cleared measure (whole rest)
    const clearedMeasure = `<measure number="2">
      <note><rest/><duration>16</duration><type>whole</type></note>
    </measure>`;
    const result = spliceMeasuresBack(FIXTURE, clearedMeasure, [2]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(nums).toEqual([1, 2, 3, 4]); // count unchanged
    // Measure 2 should now be a rest, not G A B C
    expect(norm(result)).not.toContain("<step>G</step><octave>4</octave>");
    // But original measure 2 position should have a rest
    const m2Match = result.match(/<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/);
    expect(m2Match).not.toBeNull();
    expect(m2Match![1]).toMatch(/<rest[\s/>]/);
  });

  test("DELETE multiple consecutive measures", () => {
    // Delete measures 2 and 3
    const result = spliceMeasuresBack(FIXTURE, "", [2, 3]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(nums).toEqual([1, 2]); // was 4, now 2
  });

  test("DELETE first measure preserves attributes in new first measure", () => {
    // Delete measure 1 — the attributes (key, time, clef) were in measure 1
    // After deletion, measure 2 becomes measure 1
    const result = spliceMeasuresBack(FIXTURE, "", [1]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(nums).toEqual([1, 2, 3]);
    // New measure 1 should be old measure 2 content (G A B C)
    expect(norm(result)).toContain("<step>G</step><octave>4</octave>");
  });

  test("DELETE last measure", () => {
    const result = spliceMeasuresBack(FIXTURE, "", [4]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(nums).toEqual([1, 2, 3]);
  });
});

// ─── deleteMeasures (deterministic) ─────────────────────────────────────────

describe("deleteMeasures", () => {
  test("deletes a single measure and renumbers", () => {
    const result = deleteMeasures(FIXTURE, [2]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(nums).toEqual([1, 2, 3]);
    // Old measure 2 had G A B C — should be gone
    expect(norm(result)).not.toContain("<step>G</step><octave>4</octave>");
    // Old measure 1 content should remain
    expect(norm(result)).toContain("<step>C</step><octave>4</octave>");
  });

  test("deletes multiple measures", () => {
    const result = deleteMeasures(FIXTURE, [1, 3]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(nums).toEqual([1, 2]);
  });

  test("deletes all but one measure", () => {
    const result = deleteMeasures(FIXTURE, [1, 2, 3]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(nums).toEqual([1]);
    // Should be the old measure 4 (rest)
    expect(result).toMatch(/<rest[\s/>]/);
  });
});

// ─── clearMeasures (deterministic) ──────────────────────────────────────────

describe("clearMeasures", () => {
  test("clears a measure, replacing content with whole rest", () => {
    const result = clearMeasures(FIXTURE, [2]);
    const nums = [...result.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    // Measure count unchanged
    expect(nums).toEqual([1, 2, 3, 4]);
    // Measure 2 should have a rest, not G A B C
    const m2 = result.match(/<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/);
    expect(m2).not.toBeNull();
    expect(m2![1]).toMatch(/<rest[\s/>]/);
    expect(m2![1]).not.toContain("<step>G</step>");
  });

  test("clears first measure but preserves attributes and direction", () => {
    const result = clearMeasures(FIXTURE, [1]);
    const m1 = result.match(/<measure\b[^>]*number="1"[^>]*>([\s\S]*?)<\/measure>/);
    expect(m1).not.toBeNull();
    // Attributes (key, time, clef) should be preserved
    expect(m1![1]).toContain("<attributes>");
    expect(m1![1]).toContain("<divisions>");
    expect(m1![1]).toContain("<key>");
    // Direction (tempo marking) should be preserved
    expect(m1![1]).toContain("<direction");
    expect(m1![1]).toContain('tempo="120"');
    expect(m1![1]).toContain("<metronome");
    // But notes should be replaced with rest
    expect(m1![1]).toMatch(/<rest[\s/>]/);
    expect(m1![1]).not.toContain("<step>C</step>");
  });

  test("clears multiple measures", () => {
    const result = clearMeasures(FIXTURE, [1, 2, 3]);
    // All three should be rests
    for (const num of [1, 2, 3]) {
      const m = result.match(new RegExp(`<measure\\b[^>]*number="${num}"[^>]*>([\\s\\S]*?)</measure>`));
      expect(m).not.toBeNull();
      expect(m![1]).toMatch(/<rest[\s/>]/);
    }
    // Measure 4 unchanged (already a rest, but untouched)
    expect(result).toContain('<measure number="4"');
  });

  test("computes correct duration for whole rest", () => {
    const result = clearMeasures(FIXTURE, [2]);
    // Fixture has divisions=4, 4/4 time → whole rest duration = 4 * 4 * (4/4) = 16
    const m2 = result.match(/<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/);
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
    expect(m3).toMatch(/<rest[\s/>]/);
    // Old measure 3 (whole note C5) is now measure 4
    const m4 = getMeasureContent(result, 4);
    expect(m4).toContain("<step>C</step><octave>5</octave>");
  });

  test("inserts at the beginning (afterMeasure=0)", () => {
    const result = insertEmptyMeasures(FIXTURE, 0, 2);
    const nums = getMeasureNums(result);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6]);
    // First two should be rests
    expect(getMeasureContent(result, 1)).toMatch(/<rest[\s/>]/);
    expect(getMeasureContent(result, 2)).toMatch(/<rest[\s/>]/);
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
    expect(m4).toMatch(/<rest[\s/>]/);
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

// ─── getTempo ───────────────────────────────────────────────────────────────

describe("getTempo", () => {
  test("reads tempo from fixture", () => {
    const tempo = getTempo(FIXTURE);
    expect(tempo).not.toBeNull();
    expect(tempo!.bpm).toBe(120);
    expect(tempo!.beatUnit).toBe("quarter");
  });

  test("returns null when no tempo is set", () => {
    const noTempo = FIXTURE.replace(/<direction[\s\S]*?<\/direction>/g, "");
    expect(getTempo(noTempo)).toBeNull();
  });
});

// ─── setTempo ───────────────────────────────────────────────────────────────

describe("setTempo", () => {
  test("updates existing tempo", () => {
    const result = setTempo(FIXTURE, 140);
    const tempo = getTempo(result);
    expect(tempo!.bpm).toBe(140);
    expect(result).toContain('tempo="140"');
    expect(result).toContain("<per-minute>140</per-minute>");
    // Original tempo should be gone
    expect(result).not.toContain('tempo="120"');
    expect(result).not.toContain("<per-minute>120</per-minute>");
  });

  test("updates beat unit", () => {
    const result = setTempo(FIXTURE, 80, "half");
    expect(result).toContain("<beat-unit>half</beat-unit>");
    expect(result).not.toContain("<beat-unit>quarter</beat-unit>");
  });

  test("inserts tempo when none exists", () => {
    const noTempo = FIXTURE.replace(/<direction[\s\S]*?<\/direction>/g, "");
    expect(getTempo(noTempo)).toBeNull();

    const result = setTempo(noTempo, 100);
    const tempo = getTempo(result);
    expect(tempo!.bpm).toBe(100);
    expect(result).toContain('tempo="100"');
    expect(result).toContain("<per-minute>100</per-minute>");
    expect(result).toContain("<beat-unit>quarter</beat-unit>");
  });

  test("context includes tempo", () => {
    const { context } = extractParts(FIXTURE);
    expect(context).toContain("Tempo: 120 BPM");
  });

  test("context omits tempo when none set", () => {
    const noTempo = FIXTURE.replace(/<direction[\s\S]*?<\/direction>/g, "");
    const { context } = extractParts(noTempo);
    expect(context).not.toContain("Tempo");
  });
});

// ─── addDynamics ─────────────────────────────────────────────────────────────

describe("addDynamics", () => {
  test("inserts a dynamic marking before the first note", () => {
    const result = addDynamics(FIXTURE, [2], "ff");
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain("<dynamics><ff/></dynamics>");
    expect(m2).toContain('<sound dynamics="124"/>');
    expect(m2).toContain('placement="below"');
  });

  test("adds dynamics to multiple measures", () => {
    const result = addDynamics(FIXTURE, [1, 3], "p");
    expect(getMeasureContent(result, 1)).toContain("<dynamics><p/></dynamics>");
    expect(getMeasureContent(result, 3)).toContain("<dynamics><p/></dynamics>");
    // Measure 2 untouched
    expect(getMeasureContent(result, 2)).not.toContain("<dynamics>");
  });

  test("updates existing dynamics in-place", () => {
    // First add dynamics, then update them
    const withDynamics = addDynamics(FIXTURE, [2], "p");
    expect(getMeasureContent(withDynamics, 2)).toContain("<p/>");

    const updated = addDynamics(withDynamics, [2], "ff");
    const m2 = getMeasureContent(updated, 2);
    expect(m2).toContain("<ff/>");
    expect(m2).not.toContain("<p/>");
  });
});

// ─── addArticulations ────────────────────────────────────────────────────────

describe("addArticulations", () => {
  test("adds staccato to all notes in a measure", () => {
    const result = addArticulations(FIXTURE, [1], "staccato");
    const m1 = getMeasureContent(result, 1);
    // Measure 1 has 4 notes (C D E F) — all should get staccato
    const staccatoCount = (m1.match(/<staccato\/>/g) || []).length;
    expect(staccatoCount).toBe(4);
    expect(m1).toContain("<notations><articulations><staccato/></articulations></notations>");
  });

  test("skips rests", () => {
    const result = addArticulations(FIXTURE, [4], "accent");
    const m4 = getMeasureContent(result, 4);
    // Measure 4 is a rest — should not have articulations
    expect(m4).not.toContain("<accent/>");
    expect(m4).not.toContain("<notations>");
  });

  test("adds to multiple measures", () => {
    const result = addArticulations(FIXTURE, [1, 2], "tenuto");
    expect(getMeasureContent(result, 1)).toContain("<tenuto/>");
    expect(getMeasureContent(result, 2)).toContain("<tenuto/>");
    expect(getMeasureContent(result, 3)).not.toContain("<tenuto/>");
  });

  test("appends to existing articulations", () => {
    const withStaccato = addArticulations(FIXTURE, [1], "staccato");
    const withBoth = addArticulations(withStaccato, [1], "accent");
    const m1 = getMeasureContent(withBoth, 1);
    expect(m1).toContain("<staccato/>");
    expect(m1).toContain("<accent/>");
  });
});

// ─── addRepeatBarlines ───────────────────────────────────────────────────────

describe("addRepeatBarlines", () => {
  test("adds forward and backward repeat barlines", () => {
    const result = addRepeatBarlines(FIXTURE, 1, 4);
    const m1 = getMeasureContent(result, 1);
    const m4 = getMeasureContent(result, 4);
    expect(m1).toContain('<repeat direction="forward"/>');
    expect(m1).toContain("heavy-light");
    expect(m4).toContain('<repeat direction="backward"/>');
    expect(m4).toContain("light-heavy");
  });

  test("handles same start and end measure", () => {
    const result = addRepeatBarlines(FIXTURE, 2, 2);
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain('<repeat direction="forward"/>');
    expect(m2).toContain('<repeat direction="backward"/>');
  });

  test("does not affect other measures", () => {
    const result = addRepeatBarlines(FIXTURE, 2, 3);
    expect(getMeasureContent(result, 1)).not.toContain("<repeat");
    expect(getMeasureContent(result, 4)).not.toContain("<repeat");
  });
});

// ─── addVoltaBrackets ────────────────────────────────────────────────────────

describe("addVoltaBrackets", () => {
  test("adds 1st and 2nd ending brackets", () => {
    const result = addVoltaBrackets(FIXTURE, [3], [4]);
    const m3 = getMeasureContent(result, 3);
    const m4 = getMeasureContent(result, 4);
    expect(m3).toContain('<ending number="1" type="start"/>');
    expect(m3).toContain('<ending number="1" type="stop"/>');
    expect(m3).toContain('<repeat direction="backward"/>');
    expect(m4).toContain('<ending number="2" type="start"/>');
    expect(m4).toContain('<ending number="2" type="stop"/>');
  });

  test("handles multi-measure endings", () => {
    const result = addVoltaBrackets(FIXTURE, [2, 3], [4]);
    const m2 = getMeasureContent(result, 2);
    const m3 = getMeasureContent(result, 3);
    const m4 = getMeasureContent(result, 4);
    expect(m2).toContain('<ending number="1" type="start"/>');
    expect(m3).toContain('<ending number="1" type="stop"/>');
    expect(m4).toContain('<ending number="2" type="start"/>');
    expect(m4).toContain('<ending number="2" type="stop"/>');
  });
});

// ─── addHairpin ──────────────────────────────────────────────────────────────

describe("addHairpin", () => {
  test("adds a crescendo hairpin", () => {
    const result = addHairpin(FIXTURE, 1, 3, "crescendo");
    const m1 = getMeasureContent(result, 1);
    const m3 = getMeasureContent(result, 3);
    expect(m1).toContain('<wedge type="crescendo"/>');
    expect(m3).toContain('<wedge type="stop"/>');
    // Middle measure untouched
    expect(getMeasureContent(result, 2)).not.toContain("<wedge");
  });

  test("adds a diminuendo hairpin", () => {
    const result = addHairpin(FIXTURE, 2, 4, "diminuendo");
    const m2 = getMeasureContent(result, 2);
    const m4 = getMeasureContent(result, 4);
    expect(m2).toContain('<wedge type="diminuendo"/>');
    expect(m4).toContain('<wedge type="stop"/>');
  });

  test("hairpin directions are placed below", () => {
    const result = addHairpin(FIXTURE, 1, 2, "crescendo");
    const m1 = getMeasureContent(result, 1);
    expect(m1).toContain('placement="below"');
  });
});

// ─── changeKey ───────────────────────────────────────────────────────────────

describe("changeKey", () => {
  test("changes key of entire score from C to G major", () => {
    const result = changeKey(FIXTURE, 1); // G major = 1 fifth
    expect(result).toContain("<fifths>1</fifths>");
    // C major → G major = +7 semitones (perfect fifth up)
    // But normalized: could be +7 or -5. Circle of fifths: 1 fifth = 7 semitones
    // C4 → G4
    const m1 = getMeasureContent(result, 1);
    expect(m1).toContain("<step>G</step>");
  });

  test("changes key from C to F major", () => {
    const result = changeKey(FIXTURE, -1); // F major = -1 fifth
    expect(result).toContain("<fifths>-1</fifths>");
    // C major → F major = -7 semitones = +5 semitones (perfect fourth up)
    // C4 → F4
    const m1 = getMeasureContent(result, 1);
    expect(m1).toContain("<step>F</step>");
  });

  test("changes key from specific measure onward", () => {
    const result = changeKey(FIXTURE, 2, 3); // D major from measure 3
    // Measures 1-2 should still have original notes
    const m1 = getMeasureContent(result, 1);
    expect(m1).toContain("<step>C</step><octave>4</octave>");
    // Measure 3 should be transposed and have new key
    const m3 = getMeasureContent(result, 3);
    expect(m3).toContain("<fifths>2</fifths>");
  });
});

// ─── scaleNoteDurations ──────────────────────────────────────────────────────

describe("scaleNoteDurations", () => {
  test("doubles note durations", () => {
    const result = scaleNoteDurations(FIXTURE, [1], 2);
    const m1 = getMeasureContent(result, 1);
    // Original: duration=4, type=quarter → duration=8, type=half
    expect(m1).toContain("<duration>8</duration>");
    expect(m1).toContain("<type>half</type>");
  });

  test("halves note durations", () => {
    const result = scaleNoteDurations(FIXTURE, [1], 0.5);
    const m1 = getMeasureContent(result, 1);
    // Original: duration=4, type=quarter → duration=2, type=eighth
    expect(m1).toContain("<duration>2</duration>");
    expect(m1).toContain("<type>eighth</type>");
  });

  test("only affects specified measures", () => {
    const result = scaleNoteDurations(FIXTURE, [1], 2);
    // Measure 2 should be unchanged
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain("<duration>4</duration>");
    expect(m2).toContain("<type>quarter</type>");
  });

  test("handles whole notes", () => {
    const result = scaleNoteDurations(FIXTURE, [3], 0.5);
    const m3 = getMeasureContent(result, 3);
    // Original: duration=16, type=whole → duration=8, type=half
    expect(m3).toContain("<duration>8</duration>");
    expect(m3).toContain("<type>half</type>");
  });
});

// ─── addTextAnnotation ───────────────────────────────────────────────────────

describe("addTextAnnotation", () => {
  test("adds text expression", () => {
    const result = addTextAnnotation(FIXTURE, 1, "dolce", "text");
    const m1 = getMeasureContent(result, 1);
    expect(m1).toContain('<words font-style="italic">dolce</words>');
    expect(m1).toContain('placement="above"');
  });

  test("adds rehearsal mark", () => {
    const result = addTextAnnotation(FIXTURE, 2, "A", "rehearsal");
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain('<rehearsal enclosure="square">A</rehearsal>');
    expect(m2).toContain('placement="above"');
  });

  test("only affects the target measure", () => {
    const result = addTextAnnotation(FIXTURE, 3, "cresc.", "text");
    expect(getMeasureContent(result, 2)).not.toContain("<words");
    expect(getMeasureContent(result, 3)).toContain("cresc.");
    expect(getMeasureContent(result, 4)).not.toContain("<words");
  });

  test("inserts before first note", () => {
    const result = addTextAnnotation(FIXTURE, 1, "B", "rehearsal");
    const m1 = getMeasureContent(result, 1);
    // The direction should appear before the first <note>
    const dirIdx = m1.indexOf("<rehearsal");
    const noteIdx = m1.search(/<note[\s>]/);
    expect(dirIdx).toBeLessThan(noteIdx);
  });
});

// ─── multi-part: extractSelectedMeasures ─────────────────────────────────────

describe("extractSelectedMeasures (multi-part)", () => {
  test("wraps selected measures in <part> tags for each part", () => {
    const { selectedMeasures } = extractSelectedMeasures(TWO_PART_FIXTURE, [2]);
    expect(selectedMeasures).toContain('<part id="P1">');
    expect(selectedMeasures).toContain('<part id="P2">');
    expect(selectedMeasures).toContain('<measure number="2"');
    expect(selectedMeasures).not.toContain('<measure number="1"');
    expect(selectedMeasures).not.toContain('<measure number="3"');
  });

  test("each part contains its own measure content", () => {
    const { selectedMeasures } = extractSelectedMeasures(TWO_PART_FIXTURE, [1]);
    // P1 has octave 4, P2 has octave 3
    const p1Match = selectedMeasures.match(/<part id="P1">([\s\S]*?)<\/part>/);
    const p2Match = selectedMeasures.match(/<part id="P2">([\s\S]*?)<\/part>/);
    expect(p1Match).not.toBeNull();
    expect(p2Match).not.toBeNull();
    expect(p1Match![1]).toContain("<octave>4</octave>");
    expect(p2Match![1]).toContain("<octave>3</octave>");
  });

  test("extracts multiple measures per part", () => {
    const { selectedMeasures } = extractSelectedMeasures(TWO_PART_FIXTURE, [2, 3]);
    expect(selectedMeasures).toContain('<measure number="2"');
    expect(selectedMeasures).toContain('<measure number="3"');
    // Should have exactly 2 part blocks
    const partCount = (selectedMeasures.match(/<part /g) || []).length;
    expect(partCount).toBe(2);
  });
});

// ─── multi-part: spliceMeasuresBack ──────────────────────────────────────────

describe("spliceMeasuresBack (multi-part)", () => {
  test("replaces measure in each part independently (part-wrapped)", () => {
    const modifiedXml = `
      <part id="P1">
        <measure number="2">
          <note><pitch><step>F</step><octave>5</octave></pitch><duration>16</duration><type>whole</type></note>
        </measure>
      </part>
      <part id="P2">
        <measure number="2">
          <note><pitch><step>F</step><octave>2</octave></pitch><duration>16</duration><type>whole</type></note>
        </measure>
      </part>`;
    const result = spliceMeasuresBack(TWO_PART_FIXTURE, modifiedXml);

    // P1 measure 2 should have F5
    const p1 = result.match(/<part id="P1">([\s\S]*?)<\/part>/);
    const p1m2 = p1![1].match(/<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/);
    expect(p1m2![1]).toContain("<octave>5</octave>");
    expect(p1m2![1]).toContain("<step>F</step>");

    // P2 measure 2 should have F2
    const p2 = result.match(/<part id="P2">([\s\S]*?)<\/part>/);
    const p2m2 = p2![1].match(/<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/);
    expect(p2m2![1]).toContain("<octave>2</octave>");
    expect(p2m2![1]).toContain("<step>F</step>");

    // Unmodified measures stay intact
    const p1m1 = p1![1].match(/<measure\b[^>]*number="1"[^>]*>([\s\S]*?)<\/measure>/);
    expect(p1m1![1]).toContain("<octave>4</octave>");
  });

  test("deletes measures per-part and renumbers (part-wrapped)", () => {
    // Send measure 3, return nothing for it → deleted
    const modifiedXml = `
      <part id="P1">
      </part>
      <part id="P2">
      </part>`;
    const result = spliceMeasuresBack(TWO_PART_FIXTURE, modifiedXml, [3]);

    // Both parts should have 3 measures (was 4)
    const p1 = result.match(/<part id="P1">([\s\S]*?)<\/part>/);
    const p2 = result.match(/<part id="P2">([\s\S]*?)<\/part>/);
    const p1nums = [...p1![1].matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    const p2nums = [...p2![1].matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(p1nums).toEqual([1, 2, 3]);
    expect(p2nums).toEqual([1, 2, 3]);
  });

  test("backward compat: bare measures still work for single-part", () => {
    const modifiedMeasure = `<measure number="2">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>`;
    const result = spliceMeasuresBack(FIXTURE, modifiedMeasure);
    expect(result).toContain("<type>whole</type>");
    expect(result).toContain('<measure number="1"');
  });
});

// ─── multi-part: deterministic tools ─────────────────────────────────────────

describe("deterministic tools (multi-part)", () => {
  test("deleteMeasures removes from both parts", () => {
    const result = deleteMeasures(TWO_PART_FIXTURE, [2]);
    const p1 = result.match(/<part id="P1">([\s\S]*?)<\/part>/);
    const p2 = result.match(/<part id="P2">([\s\S]*?)<\/part>/);
    const p1nums = [...p1![1].matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    const p2nums = [...p2![1].matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
    expect(p1nums).toEqual([1, 2, 3]);
    expect(p2nums).toEqual([1, 2, 3]);
    // Old measure 2 content (G notes) should be gone from both parts
    expect(norm(p1![1])).not.toContain("<step>G</step><octave>4</octave>");
    expect(norm(p2![1])).not.toContain("<step>G</step><octave>3</octave>");
  });

  test("clearMeasures clears in both parts", () => {
    const result = clearMeasures(TWO_PART_FIXTURE, [2]);
    const p1m2 = result.match(/<part id="P1">[\s\S]*?<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/);
    const p2m2 = result.match(/<part id="P2">[\s\S]*?<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/);
    expect(p1m2![1]).toMatch(/<rest[\s/>]/);
    expect(p2m2![1]).toMatch(/<rest[\s/>]/);
    // Measure count unchanged
    const allNums = getMeasureNums(result);
    expect(allNums).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
  });

  test("addDynamics adds to both parts", () => {
    const result = addDynamics(TWO_PART_FIXTURE, [1], "f");
    const p1 = result.match(/<part id="P1">([\s\S]*?)<\/part>/);
    const p2 = result.match(/<part id="P2">([\s\S]*?)<\/part>/);
    const p1m1 = p1![1].match(/<measure\b[^>]*number="1"[^>]*>([\s\S]*?)<\/measure>/);
    const p2m1 = p2![1].match(/<measure\b[^>]*number="1"[^>]*>([\s\S]*?)<\/measure>/);
    expect(norm(p1m1![1])).toContain("<dynamics><f/></dynamics>");
    expect(norm(p2m1![1])).toContain("<dynamics><f/></dynamics>");
  });
});

// ─── multi-part: extractParts ────────────────────────────────────────────────

describe("extractParts (multi-part)", () => {
  test("extracts both parts", () => {
    const { parts, context } = extractParts(TWO_PART_FIXTURE);
    expect(parts).toContain('<part id="P1">');
    expect(parts).toContain('<part id="P2">');
    expect(context).toContain("Piano");
    expect(context).toContain("Bass");
  });
});

// ─── setMeasureNotes ─────────────────────────────────────────────────────────

describe("setMeasureNotes", () => {
  test("replaces notes with a basic melody (quarter notes)", () => {
    const notes: NoteSpec[] = [
      { step: "E", octave: 4, duration: "quarter" },
      { step: "F", octave: 4, duration: "quarter" },
      { step: "G", octave: 4, duration: "quarter" },
      { step: "A", octave: 4, duration: "quarter" },
    ];
    const result = setMeasureNotes(FIXTURE, 1, notes);
    const m1 = getMeasureContent(result, 1);
    // New notes present
    expect(m1).toContain("<step>E</step>");
    expect(m1).toContain("<step>F</step>");
    expect(m1).toContain("<step>G</step>");
    expect(m1).toContain("<step>A</step>");
    // Old notes gone (C D were in original m1)
    // Note: E and F overlap, so check C and D
    expect(m1).not.toContain("<step>C</step>");
    expect(m1).not.toContain("<step>D</step>");
    // Duration should be 4 (divisions=4, quarter=1*4)
    expect(m1).toContain("<duration>4</duration>");
    expect(m1).toContain("<type>quarter</type>");
  });

  test("writes chords with chord flag", () => {
    const notes: NoteSpec[] = [
      { step: "C", octave: 4, duration: "whole" },
      { step: "E", octave: 4, duration: "whole", chord: true },
      { step: "G", octave: 4, duration: "whole", chord: true },
    ];
    const result = setMeasureNotes(FIXTURE, 2, notes);
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain("<step>C</step>");
    expect(m2).toContain("<step>E</step>");
    expect(m2).toContain("<step>G</step>");
    expect(m2).toContain("<chord/>");
    // Should have exactly 2 chord tags (E and G)
    const chordCount = (m2.match(/<chord\/>/g) || []).length;
    expect(chordCount).toBe(2);
  });

  test("writes rests", () => {
    const notes: NoteSpec[] = [
      { rest: true, duration: "half" },
      { rest: true, duration: "half" },
    ];
    const result = setMeasureNotes(FIXTURE, 2, notes);
    const m2 = getMeasureContent(result, 2);
    expect(m2).toMatch(/<rest[\s/>]/);
    expect(m2).toContain("<duration>8</duration>"); // half = 2 * 4 = 8
    expect(m2).toContain("<type>half</type>");
    expect(m2).not.toContain("<pitch>");
  });

  test("writes dotted durations", () => {
    const notes: NoteSpec[] = [
      { step: "C", octave: 4, duration: "dotted-half" },
      { step: "D", octave: 4, duration: "quarter" },
    ];
    const result = setMeasureNotes(FIXTURE, 2, notes);
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain("<duration>12</duration>"); // dotted-half = 3 * 4 = 12
    expect(m2).toContain("<dot/>");
    expect(m2).toContain("<type>half</type>");
  });

  test("writes eighth notes", () => {
    const notes: NoteSpec[] = Array(8)
      .fill(null)
      .map((_, i) => ({
        step: "C" as const,
        octave: 4,
        duration: "eighth" as const,
      }));
    const result = setMeasureNotes(FIXTURE, 2, notes);
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain("<duration>2</duration>"); // eighth = 0.5 * 4 = 2
    expect(m2).toContain("<type>eighth</type>");
    const noteCount = (m2.match(/<note[\s>]/g) || []).length;
    expect(noteCount).toBe(8);
  });

  test("preserves attributes and direction in measure 1", () => {
    const notes: NoteSpec[] = [{ step: "G", octave: 5, duration: "whole" }];
    const result = setMeasureNotes(FIXTURE, 1, notes);
    const m1 = getMeasureContent(result, 1);
    // Attributes preserved
    expect(m1).toContain("<attributes>");
    expect(m1).toContain("<divisions>4</divisions>");
    expect(m1).toContain("<key>");
    expect(m1).toContain("<time>");
    expect(m1).toContain("<clef>");
    // Direction preserved
    expect(m1).toContain("<direction");
    expect(m1).toContain('tempo="120"');
    // New note present
    expect(m1).toContain("<step>G</step>");
    expect(m1).toContain("<octave>5</octave>");
  });

  test("targets specific part in two-part score (P2 only, P1 untouched)", () => {
    const notes: NoteSpec[] = [{ step: "F", octave: 2, duration: "whole" }];
    const result = setMeasureNotes(TWO_PART_FIXTURE, 2, notes, "P2");

    // P2 measure 2 should have F2
    const p2 = result.match(/<part id="P2">([\s\S]*?)<\/part>/);
    const p2m2 = p2![1].match(/<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/);
    expect(p2m2![1]).toContain("<step>F</step>");
    expect(p2m2![1]).toContain("<octave>2</octave>");

    // P1 measure 2 should be untouched (still G A B C at octave 4)
    const p1 = result.match(/<part id="P1">([\s\S]*?)<\/part>/);
    const p1m2 = p1![1].match(/<measure\b[^>]*number="2"[^>]*>([\s\S]*?)<\/measure>/);
    expect(p1m2![1]).toContain("<step>G</step>");
    expect(p1m2![1]).toContain("<octave>4</octave>");
  });

  test("throws for non-rest note without step", () => {
    const notes: NoteSpec[] = [{ duration: "quarter" } as NoteSpec];
    expect(() => setMeasureNotes(FIXTURE, 1, notes)).toThrow("Non-rest note must have a step");
  });

  test("writes accidentals (alter)", () => {
    const notes: NoteSpec[] = [
      { step: "F", octave: 4, alter: 1, duration: "half" },
      { step: "B", octave: 4, alter: -1, duration: "half" },
    ];
    const result = setMeasureNotes(FIXTURE, 2, notes);
    const m2 = getMeasureContent(result, 2);
    expect(m2).toContain("<alter>1</alter>");
    expect(m2).toContain("<alter>-1</alter>");
  });

  test("auto-inserts measures when writing beyond the last measure", () => {
    // FIXTURE has 4 measures — write to measure 7 (gap of 3)
    const notes: NoteSpec[] = [
      { step: "G", octave: 5, duration: "half" },
      { step: "E", octave: 5, duration: "half" },
    ];
    const result = setMeasureNotes(FIXTURE, 7, notes);

    // Score should now have 7 measures
    const firstPart = result.match(/<part\b[^>]*>[\s\S]*?<\/part>/)?.[0] ?? "";
    const measureCount = (firstPart.match(/<measure\b/g) ?? []).length;
    expect(measureCount).toBe(7);

    // The target measure should contain the written notes
    const m7 = getMeasureContent(result, 7);
    expect(m7).toContain("<step>G</step>");
    expect(m7).toContain("<step>E</step>");
  });

  test("auto-inserts exactly one measure when writing to next measure", () => {
    // FIXTURE has 4 measures — write to measure 5
    const notes: NoteSpec[] = [{ step: "C", octave: 5, duration: "whole" }];
    const result = setMeasureNotes(FIXTURE, 5, notes);

    const firstPart = result.match(/<part\b[^>]*>[\s\S]*?<\/part>/)?.[0] ?? "";
    const measureCount = (firstPart.match(/<measure\b/g) ?? []).length;
    expect(measureCount).toBe(5);

    const m5 = getMeasureContent(result, 5);
    expect(m5).toContain("<step>C</step>");
  });

  test("does not insert extra measures when writing to an existing measure", () => {
    // FIXTURE has 4 measures — writing to measure 3 should not change count
    const notes: NoteSpec[] = [{ step: "A", octave: 4, duration: "whole" }];
    const result = setMeasureNotes(FIXTURE, 3, notes);

    const firstPart = result.match(/<part\b[^>]*>[\s\S]*?<\/part>/)?.[0] ?? "";
    const measureCount = (firstPart.match(/<measure\b/g) ?? []).length;
    expect(measureCount).toBe(4);
  });
});

// ─── setTimeSignature ────────────────────────────────────────────────────────

describe("setTimeSignature", () => {
  test("changes whole score from 4/4 to 3/4", () => {
    const result = setTimeSignature(FIXTURE, 3, 4);
    expect(result).toContain("<beats>3</beats>");
    expect(result).toContain("<beat-type>4</beat-type>");
    expect(result).not.toContain("<beats>4</beats>");
  });

  test("changes from specific measure onward", () => {
    const result = setTimeSignature(FIXTURE, 6, 8, 3);
    // Measure 1 should still have 4/4
    const m1 = getMeasureContent(result, 1);
    expect(m1).toContain("<beats>4</beats>");
    // Measure 3 should have 6/8
    const m3 = getMeasureContent(result, 3);
    expect(m3).toContain("<beats>6</beats>");
    expect(m3).toContain("<beat-type>8</beat-type>");
  });

  test("changes both parts in multi-part score", () => {
    const result = setTimeSignature(TWO_PART_FIXTURE, 3, 4);
    // Both parts should have 3/4
    const p1 = result.match(/<part id="P1">([\s\S]*?)<\/part>/);
    const p2 = result.match(/<part id="P2">([\s\S]*?)<\/part>/);
    expect(p1![1]).toContain("<beats>3</beats>");
    expect(p2![1]).toContain("<beats>3</beats>");
    expect(p1![1]).not.toContain("<beats>4</beats>");
    expect(p2![1]).not.toContain("<beats>4</beats>");
  });
});

// ─── test helpers ───────────────────────────────────────────────────────────

/** Collapse whitespace between XML tags so assertions are format-agnostic */
function norm(xml: string): string {
  return xml.replace(/>\s+</g, "><");
}

function getMeasureNums(xml: string): number[] {
  return [...xml.matchAll(/<measure\b[^>]*number="(\d+)"/g)].map((m) => parseInt(m[1]));
}

function getMeasureContent(xml: string, num: number): string {
  const m = xml.match(new RegExp(`<measure\\b[^>]*number="${num}"[^>]*>([\\s\\S]*?)</measure>`));
  return norm(m?.[1] ?? "");
}

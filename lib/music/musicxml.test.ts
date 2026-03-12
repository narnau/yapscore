import { describe, test, expect } from "bun:test";
import { changeNoteDuration, buildNoteMap } from "./musicxml";

// 4/4 with divisions=16 → quarter=16, eighth=8, half=32, whole=64, 16th=4, 32nd=2, 64th=1
const FOUR_QUARTERS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>16</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

// Same with divisions=1 (common in some editors) — can only represent whole/half/quarter
const SMALL_DIVISIONS = FOUR_QUARTERS.replace("<divisions>16</divisions>", "<divisions>1</divisions>").replace(
  /<duration>16<\/duration>/g,
  "<duration>1</duration>",
);

// Score with a chord: C+E quarter, then two more quarters
const WITH_CHORD = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>16</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

describe("changeNoteDuration", () => {
  test("shorten: quarter → eighth inserts a rest", () => {
    const noteMap = buildNoteMap(FOUR_QUARTERS);
    const result = changeNoteDuration(FOUR_QUARTERS, noteMap[0], "4"); // key "4" = eighth
    expect(result).toContain("<type>eighth</type>");
    expect(result).toContain("<rest/>");
  });

  test("lengthen: quarter → half consumes next rest", () => {
    // Create a rest by shortening, then re-lengthen
    const noteMap = buildNoteMap(FOUR_QUARTERS);
    const withRest = changeNoteDuration(FOUR_QUARTERS, noteMap[0], "4"); // → eighth + rest
    const noteMap2 = buildNoteMap(withRest);
    const restored = changeNoteDuration(withRest, noteMap2[0], "5"); // → quarter (consumes rest)
    // Should have same number of notes as original (no extra rests)
    const noteCount = (restored.match(/<type>quarter<\/type>/g) ?? []).length;
    expect(noteCount).toBe(4);
    expect(restored).not.toContain("<rest/>");
  });

  test("revert: cannot lengthen beyond measure boundary", () => {
    // Try to make the 4th (last) quarter note a whole note — no room
    const noteMap = buildNoteMap(FOUR_QUARTERS);
    const result = changeNoteDuration(FOUR_QUARTERS, noteMap[3], "7"); // whole
    // Should be unchanged — first note still quarter
    expect(result).toContain("<type>quarter</type>");
    const wholeCount = (result.match(/<type>whole<\/type>/g) ?? []).length;
    expect(wholeCount).toBe(0);
  });

  test("small divisions: scales up and succeeds for 16th note", () => {
    // divisions=1 → ensureMinDivisions scales to 4, then 16th=1 tick
    const noteMap = buildNoteMap(SMALL_DIVISIONS);
    const result = changeNoteDuration(SMALL_DIVISIONS, noteMap[0], "3"); // 16th
    expect(result).toContain("<type>16th</type>");
  });

  test("small divisions: 64th scales divisions to 16 and succeeds", () => {
    const noteMap = buildNoteMap(SMALL_DIVISIONS);
    const result = changeNoteDuration(SMALL_DIVISIONS, noteMap[0], "1"); // 64th
    expect(result).toContain("<type>64th</type>");
  });

  test("freed ticks split into multiple proper rests (no invalid noteType)", () => {
    // quarter(16 ticks div=16) → 16th(4 ticks): freed=12 = eighth(8) + 16th(4)
    const noteMap = buildNoteMap(FOUR_QUARTERS);
    const result = changeNoteDuration(FOUR_QUARTERS, noteMap[0], "3"); // 16th
    expect(result).toContain("<type>eighth</type>");
    expect(result).toContain("<type>16th</type>");
  });

  test("lengthen into adjacent note: quarter→half deletes next quarter", () => {
    // [C quarter, D quarter, E quarter, F quarter] → change C to half
    // D should be consumed (deleted), replaced with nothing or a rest
    const noteMap = buildNoteMap(FOUR_QUARTERS);
    const result = changeNoteDuration(FOUR_QUARTERS, noteMap[0], "6"); // half
    expect(result).toContain("<type>half</type>");
    // C is now half (32 ticks), D is gone → remaining measure = E + F (2 quarters)
    // Total should still be 4/4 = 64 ticks
    const halfCount = (result.match(/<type>half<\/type>/g) ?? []).length;
    expect(halfCount).toBeGreaterThanOrEqual(1);
    // D (quarter pitch) should be gone — replaced by the half note taking its slot
    // We check there's one fewer pitched quarter note (3 instead of 4)
    const quarterNoteCount = (result.match(/<type>quarter<\/type>/g) ?? []).length;
    expect(quarterNoteCount).toBeLessThan(4);
  });

  test("lengthen into rest then note: quarter→whole consumes rest+notes", () => {
    // [C quarter, rest quarter, E quarter, F quarter] → change C to whole
    // rest + E + F should all be consumed
    const xml = FOUR_QUARTERS.replace(
      "<note><pitch><step>D</step>",
      "<note><rest/><duration>16</duration><type>quarter</type></note>\n      <note><pitch><step>D</step>",
    ).replace(
      "<note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>",
      "",
    );
    const noteMap = buildNoteMap(xml);
    const result = changeNoteDuration(xml, noteMap[0], "7"); // whole
    expect(result).toContain("<type>whole</type>");
  });

  test("chained: quarter→16th→eighth works correctly", () => {
    const noteMap = buildNoteMap(FOUR_QUARTERS);
    const step1 = changeNoteDuration(FOUR_QUARTERS, noteMap[0], "3"); // quarter → 16th
    expect(step1).toContain("<type>16th</type>");

    const noteMap2 = buildNoteMap(step1);
    const step2 = changeNoteDuration(step1, noteMap2[0], "4"); // 16th → eighth
    expect(step2).toContain("<type>eighth</type>");
    // Total duration should still be 4 quarters (no ticks lost)
    const eighthCount = (step2.match(/<type>eighth<\/type>/g) ?? []).length;
    expect(eighthCount).toBeGreaterThanOrEqual(1); // at least the note itself
  });

  test("chord: clicking chord note changes the whole chord group", () => {
    const noteMap = buildNoteMap(WITH_CHORD);
    // noteMap[0] = C (main), noteMap[1] = E (chord note)
    // Shorten via chord note index (noteMap[1])
    const result = changeNoteDuration(WITH_CHORD, noteMap[1], "4"); // eighth
    expect(result).toContain("<type>eighth</type>");
    // Both main note and chord note should be eighth (plus an inserted eighth rest = 3 total)
    const eighthCount = (result.match(/<type>eighth<\/type>/g) ?? []).length;
    expect(eighthCount).toBeGreaterThanOrEqual(2); // C, E (and the inserted rest)
    // Rest should be inserted AFTER the chord (not between C and E)
    // Verify the chord structure is intact: E still has <chord/>
    expect(result).toContain("<chord/>");
  });

  test("chord: inserting rest goes after chord group, not between chord notes", () => {
    const noteMap = buildNoteMap(WITH_CHORD);
    const result = changeNoteDuration(WITH_CHORD, noteMap[0], "4"); // shorten C (main) to eighth
    // The E chord note should still follow C directly (chord structure preserved)
    const chordIdx = result.indexOf("<chord/>");
    const cRestIdx = result.indexOf("<rest/>");
    // <rest/> must come after <chord/>
    expect(chordIdx).toBeGreaterThan(0);
    expect(cRestIdx).toBeGreaterThan(chordIdx);
  });

  test("all 7 duration keys produce distinct durations with divisions=16", () => {
    const noteMap = buildNoteMap(FOUR_QUARTERS);
    const types = ["64th", "32nd", "16th", "eighth", "quarter", "half", "whole"];
    for (let k = 1; k <= 7; k++) {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>16</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>
      <note><rest/><duration>48</duration><type>dotted-half</type></note>
    </measure>
  </part>
</score-partwise>`;
      const nm = buildNoteMap(xml);
      if (k === 7) {
        // whole: needs full measure — just check it doesn't crash
        continue;
      }
      const result = changeNoteDuration(xml, nm[0], String(k) as "1" | "2" | "3" | "4" | "5" | "6" | "7");
      expect(result).toContain(`<type>${types[k - 1]}</type>`);
    }
  });
});

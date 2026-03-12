/**
 * Agent integration tests — call runAgent with real LLM and verify:
 *   1. The right tool was called (inferred from the output MusicXML)
 *   2. The output is a structurally valid MusicXML
 *   3. The modification matches user intent
 *
 * These tests are marked with [slow] because they make LLM API calls.
 * Run with:   bun test tests/agent-integration.test.ts
 *
 * Requires OPENROUTER_API_KEY in environment.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { runAgent } from "../lib/agent";
import { createScore, setMeasureNotes, getTempo, getSwing, addChordSymbols } from "../lib/music/musicxml";

// ─── Setup ────────────────────────────────────────────────────────────────────

let piano4: string; // 4-measure piano score
let pianoBass: string; // piano score with distinct treble + bass notes

beforeAll(() => {
  piano4 = createScore({ instruments: [{ name: "Piano", staves: 2 }], measures: 4, tempo: 120 });

  let xml = createScore({ instruments: [{ name: "Piano", staves: 2 }], measures: 4 });
  xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 5, duration: "whole" }], "P1", 1); // treble
  xml = setMeasureNotes(xml, 1, [{ step: "G", octave: 2, duration: "whole" }], "P1", 2); // bass
  xml = setMeasureNotes(xml, 2, [{ step: "E", octave: 5, duration: "whole" }], "P1", 1);
  xml = setMeasureNotes(xml, 2, [{ step: "F", octave: 2, duration: "whole" }], "P1", 2);
  pianoBass = xml;
});

function countOccurrences(xml: string, needle: string): number {
  let n = 0,
    pos = 0;
  while ((pos = xml.indexOf(needle, pos)) !== -1) {
    n++;
    pos++;
  }
  return n;
}

// ─── Score creation ───────────────────────────────────────────────────────────

describe("[slow] score creation", () => {
  test("creates a score from scratch", async () => {
    const result = await runAgent("Create a 4-measure C major scale for piano", null, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    expect(result.musicXml).toContain("<score-partwise");
    expect(result.musicXml).toContain("<measure number=");
    expect(countOccurrences(result.musicXml, "<measure number=")).toBeGreaterThanOrEqual(4);
    expect(result.musicXml).toContain("<step>C</step>");
  }, 30_000);

  test("creates a score in a specific key", async () => {
    const result = await runAgent("Create a simple 4-measure melody in G major for piano", null, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    expect(result.musicXml).toContain("<score-partwise");
    // G major has 1 sharp (fifths=1)
    expect(result.musicXml).toContain("<fifths>1</fifths>");
  }, 30_000);
});

// ─── Tempo ────────────────────────────────────────────────────────────────────

describe("[slow] tempo changes", () => {
  test("changes tempo to 90 BPM", async () => {
    const result = await runAgent("Change the tempo to 90 BPM", piano4, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    const tempo = getTempo(result.musicXml);
    expect(tempo).not.toBeNull();
    expect(tempo!.bpm).toBe(90);
  }, 20_000);

  test("changes tempo to 140 BPM", async () => {
    const result = await runAgent("Set tempo to 140", piano4, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    const tempo = getTempo(result.musicXml);
    expect(tempo?.bpm).toBe(140);
  }, 20_000);
});

// ─── Staff-specific clearing (the bug we fixed) ───────────────────────────────

describe("[slow] staff-specific note clearing", () => {
  test("'delete left hand notes' only clears bass staff, not treble", async () => {
    const result = await runAgent("Delete all the left hand notes", pianoBass, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;

    // Treble notes (C5, E5) should still be present
    expect(result.musicXml).toContain("<step>C</step>");
    expect(result.musicXml).toContain("<step>E</step>");

    // Bass notes (G2, F2) should be gone
    // (They were below C4, so checking octave 2)
    const g2present = result.musicXml.includes("<step>G</step>") && result.musicXml.includes("<octave>2</octave>");
    expect(g2present).toBe(false);
  }, 30_000);

  test("'delete right hand notes' only clears treble staff, not bass", async () => {
    const result = await runAgent("Delete all the right hand (treble clef) notes", pianoBass, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;

    // Bass notes (G2, F2) should still be present
    expect(result.musicXml).toContain("<octave>2</octave>");
  }, 30_000);
});

// ─── Chord symbols ────────────────────────────────────────────────────────────

describe("[slow] chord symbols", () => {
  test("adds chord symbols measure by measure", async () => {
    const result = await runAgent(
      "Add these chord symbols: measure 1 = Cmaj7, measure 2 = Am7, measure 3 = Dm7, measure 4 = G7",
      piano4,
      null,
    );
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;

    expect(result.musicXml).toContain("<harmony");
    // Should have 4 chord symbols
    expect(countOccurrences(result.musicXml, "<harmony")).toBeGreaterThanOrEqual(4);
  }, 30_000);

  test("addChordSymbols for non-existent measures triggers insertEmptyMeasures", async () => {
    // 4-measure score, ask for 8 measures worth of chords
    const result = await runAgent(
      "Add a ii-V-I jazz chord progression repeating over 8 measures: Dm7, G7, Cmaj7, Cmaj7 (repeat twice)",
      piano4,
      null,
    );
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;

    // Score should have been extended to 8 measures
    const measureCount = countOccurrences(result.musicXml, "<measure number=");
    expect(measureCount).toBeGreaterThanOrEqual(8);
  }, 45_000);

  test("replacing chords does not stack duplicates", async () => {
    // First, add Cmaj7 to measure 1
    const withChords = addChordSymbols(piano4, 1, [{ root: "C", kind: "maj7" }]).xml;

    // Ask agent to change it to Fmaj7
    const result = await runAgent("Change the chord in measure 1 to Fmaj7", withChords, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;

    // Measure 1 should have exactly 1 chord symbol
    // (rough check: count harmonies in the first measure block)
    const m1Start = result.musicXml.indexOf('<measure number="1"');
    const m1End = result.musicXml.indexOf("</measure>", m1Start);
    const m1 = result.musicXml.slice(m1Start, m1End);
    expect(countOccurrences(m1, "<harmony")).toBe(1);
    expect(m1).toContain("<root-step>F</root-step>");
  }, 30_000);
});

// ─── Dynamics ────────────────────────────────────────────────────────────────

describe("[slow] dynamics", () => {
  test("adds forte dynamic", async () => {
    const result = await runAgent("Make the whole score forte", piano4, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    expect(result.musicXml).toMatch(/<dynamics>.*?<f\/>.*?<\/dynamics>/s);
  }, 20_000);

  test("adds pianissimo dynamic", async () => {
    const result = await runAgent("Make it very soft (pp)", piano4, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    expect(result.musicXml).toMatch(/<dynamics>.*?<pp\/>.*?<\/dynamics>/s);
  }, 20_000);
});

// ─── Articulations ───────────────────────────────────────────────────────────

describe("[slow] articulations", () => {
  test("adds staccato to all notes", async () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 2 });
    const withNotes = setMeasureNotes(
      xml,
      1,
      [
        { step: "C", octave: 4, duration: "quarter" },
        { step: "D", octave: 4, duration: "quarter" },
      ],
      "P1",
    );

    const result = await runAgent("Add staccato to all notes", withNotes, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    expect(result.musicXml).toContain("<staccato/>");
  }, 20_000);

  test("adds staccato only to flute in a flute+piano score", async () => {
    const xml = createScore({
      instruments: [{ name: "Flute" }, { name: "Piano" }],
      measures: 2,
    });
    const withNotes = setMeasureNotes(
      setMeasureNotes(xml, 1, [{ step: "C", octave: 5, duration: "quarter" }], "P1"),
      1,
      [{ step: "G", octave: 4, duration: "quarter" }],
      "P2",
    );

    const result = await runAgent("Add staccato only to the flute part", withNotes, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;

    // Find P2 (piano) section — should NOT have staccato
    const p2Start = result.musicXml.indexOf('<part id="P2"');
    const p2End = result.musicXml.indexOf("</part>", p2Start);
    expect(result.musicXml.slice(p2Start, p2End)).not.toContain("<staccato/>");

    // P1 (flute) should have staccato
    const p1Start = result.musicXml.indexOf('<part id="P1"');
    const p1End = result.musicXml.indexOf("</part>", p1Start);
    expect(result.musicXml.slice(p1Start, p1End)).toContain("<staccato/>");
  }, 30_000);
});

// ─── Swing ────────────────────────────────────────────────────────────────────

describe("[slow] swing", () => {
  test("enables swing/jazz feel", async () => {
    const result = await runAgent("Enable swing / jazz feel", piano4, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    const swing = getSwing(result.musicXml);
    expect(swing).not.toBeNull();
  }, 20_000);
});

// ─── Key change ──────────────────────────────────────────────────────────────

describe("[slow] key changes", () => {
  test("changes key to D major", async () => {
    const result = await runAgent("Change the key to D major", piano4, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    // D major = 2 sharps = fifths 2
    expect(result.musicXml).toContain("<fifths>2</fifths>");
  }, 20_000);
});

// ─── Structure ────────────────────────────────────────────────────────────────

describe("[slow] structural edits", () => {
  test("adds measures at the end", async () => {
    const result = await runAgent("Add 4 more empty measures at the end", piano4, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    const measureCount = countOccurrences(result.musicXml, "<measure number=");
    expect(measureCount).toBeGreaterThanOrEqual(8);
  }, 20_000);

  test("adds a pickup measure (anacrusa)", async () => {
    const result = await runAgent("Add a pickup measure (anacrusa) of 2 beats", piano4, null);
    expect(result.type).toBe("modify");
    if (result.type !== "modify") return;
    expect(result.musicXml).toContain('implicit="yes"');
    // Pickup measure must have attributes so Verovio renders correctly
    const firstMeasureStart = result.musicXml.indexOf("<measure number=");
    const firstMeasureEnd = result.musicXml.indexOf("</measure>", firstMeasureStart);
    const firstMeasure = result.musicXml.slice(firstMeasureStart, firstMeasureEnd);
    expect(firstMeasure).toContain("<divisions>");
  }, 30_000);
});

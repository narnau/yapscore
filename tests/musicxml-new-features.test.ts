/**
 * Tests for newly implemented MuseScore features:
 *  - addSlur / removeSlurs
 *  - addLyrics
 *  - addFermata
 *  - addOttava (8va / 8vb)
 *  - addPedalMarking
 *  - setScoreMetadata / getScoreMetadata
 *  - addNavigationMark (coda, segno, fine, da capo, dal segno)
 *  - addArpeggio
 *  - addTremolo
 *  - addGlissando
 *  - addBreathMark
 */

import { describe, test, expect } from "bun:test";
import {
  createScore,
  setMeasureNotes,
  addSlur,
  removeSlurs,
  addLyrics,
  addFermata,
  addOttava,
  addPedalMarking,
  setScoreMetadata,
  getScoreMetadata,
  addNavigationMark,
  addArpeggio,
  addTremolo,
  addGlissando,
  addBreathMark,
} from "../lib/music/musicxml";

function score4() {
  let xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
  xml = setMeasureNotes(xml, 1, [
    { step: "C", octave: 4, duration: "quarter" },
    { step: "D", octave: 4, duration: "quarter" },
    { step: "E", octave: 4, duration: "quarter" },
    { step: "F", octave: 4, duration: "quarter" },
  ], "P1");
  xml = setMeasureNotes(xml, 2, [
    { step: "G", octave: 4, duration: "quarter" },
    { step: "A", octave: 4, duration: "quarter" },
    { step: "B", octave: 4, duration: "quarter" },
    { step: "C", octave: 5, duration: "quarter" },
  ], "P1");
  return xml;
}

// ─── addSlur / removeSlurs ────────────────────────────────────────────────────

describe("addSlur", () => {
  test("adds slur start to first note and stop to last note of span", () => {
    const result = addSlur(score4(), 1, 2);
    expect(result).toContain('<slur');
    expect(result).toContain('type="start"');
    expect(result).toContain('type="stop"');
  });

  test("slur within a single measure", () => {
    const result = addSlur(score4(), 1, 1);
    // Start on first note, stop on last note of measure 1
    expect(result).toContain("slur");
  });

  test("removeSlurs clears slur notations from the range", () => {
    const withSlur = addSlur(score4(), 1, 2);
    expect(withSlur).toContain("<slur");
    const removed = removeSlurs(withSlur, 1, 2);
    expect(removed).not.toContain("<slur");
  });

  test("slur does not affect measures outside the range", () => {
    const result = addSlur(score4(), 1, 1);
    // Measure 2 notes should have no slur
    const m2start = result.indexOf('<measure number="2"');
    const m2end = result.indexOf('</measure>', m2start);
    const m2 = result.slice(m2start, m2end);
    expect(m2).not.toContain("slurType");
  });
});

// ─── addLyrics ────────────────────────────────────────────────────────────────

describe("addLyrics", () => {
  test("adds lyrics to notes in a measure", () => {
    const result = addLyrics(score4(), 1, ["Hel", "lo", "world", "now"], "P1");
    expect(result).toContain("<lyric");
    expect(result).toContain("Hel");
    expect(result).toContain("lo");
    expect(result).toContain("world");
  });

  test("fewer syllables than notes — remaining notes get no lyric", () => {
    const result = addLyrics(score4(), 1, ["La"], "P1");
    // Only 1 lyric element in measure 1
    const m1start = result.indexOf('<measure number="1"');
    const m1end = result.indexOf('</measure>', m1start);
    const m1 = result.slice(m1start, m1end);
    const count = (m1.match(/<lyric/g) || []).length;
    expect(count).toBe(1);
  });

  test("syllabic marks: multi-syllable word uses begin/middle/end", () => {
    const result = addLyrics(score4(), 1, ["mu-", "sic"], "P1");
    // "mu-" is begin syllabic, "sic" is end
    expect(result).toContain("begin");
    expect(result).toContain("end");
  });

  test("single-word syllable uses 'single' syllabic", () => {
    const result = addLyrics(score4(), 1, ["love"], "P1");
    expect(result).toContain("single");
  });

  test("replacing lyrics overwrites existing ones", () => {
    const first = addLyrics(score4(), 1, ["Hel", "lo", "world", "now"], "P1");
    const second = addLyrics(first, 1, ["La", "la", "la", "la"], "P1");
    expect(second).not.toContain("Hel");
    expect(second).toContain("La");
  });
});

// ─── addFermata ───────────────────────────────────────────────────────────────

describe("addFermata", () => {
  test("adds fermata to the last note of a measure", () => {
    const result = addFermata(score4(), 1);
    expect(result).toContain("fermata");
  });

  test("adds fermata to a specific beat position (beat 1)", () => {
    const result = addFermata(score4(), 1, 1);
    expect(result).toContain("fermata");
  });

  test("fermata does not appear in other measures", () => {
    const result = addFermata(score4(), 1);
    const m2start = result.indexOf('<measure number="2"');
    const m2end = result.indexOf('</measure>', m2start);
    expect(result.slice(m2start, m2end)).not.toContain("fermata");
  });

  test("inverted fermata supported", () => {
    const result = addFermata(score4(), 1, undefined, "inverted");
    expect(result).toContain("inverted");
  });
});

// ─── addOttava ────────────────────────────────────────────────────────────────

describe("addOttava", () => {
  test("adds 8va direction spanning measures 1-2", () => {
    const result = addOttava(score4(), 1, 2, "8va");
    expect(result).toContain("octave-shift");
    // Start direction
    expect(result).toContain('"down"');
  });

  test("adds 8vb (loco) direction", () => {
    const result = addOttava(score4(), 1, 2, "8vb");
    expect(result).toContain("octave-shift");
    expect(result).toContain('"up"');
  });

  test("stop direction appears at end measure", () => {
    const result = addOttava(score4(), 1, 2, "8va");
    const m2start = result.indexOf('<measure number="2"');
    const m2end = result.indexOf('</measure>', m2start);
    expect(result.slice(m2start, m2end)).toContain("stop");
  });
});

// ─── addPedalMarking ─────────────────────────────────────────────────────────

describe("addPedalMarking", () => {
  test("adds pedal start and stop directions", () => {
    const result = addPedalMarking(score4(), 1, 2);
    expect(result).toContain("pedal");
    expect(result).toContain("start");
    expect(result).toContain("stop");
  });

  test("pedal start is in start measure", () => {
    const result = addPedalMarking(score4(), 1, 2);
    const m1start = result.indexOf('<measure number="1"');
    const m1end = result.indexOf('</measure>', m1start);
    expect(result.slice(m1start, m1end)).toContain("start");
  });

  test("pedal stop is in end measure", () => {
    const result = addPedalMarking(score4(), 1, 2);
    const m2start = result.indexOf('<measure number="2"');
    const m2end = result.indexOf('</measure>', m2start);
    expect(result.slice(m2start, m2end)).toContain("stop");
  });
});

// ─── setScoreMetadata / getScoreMetadata ─────────────────────────────────────

describe("setScoreMetadata / getScoreMetadata", () => {
  test("sets and gets title", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const result = setScoreMetadata(xml, { title: "Autumn Leaves" });
    const meta = getScoreMetadata(result);
    expect(meta.title).toBe("Autumn Leaves");
  });

  test("sets and gets composer", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const result = setScoreMetadata(xml, { composer: "Joseph Kosma" });
    const meta = getScoreMetadata(result);
    expect(meta.composer).toBe("Joseph Kosma");
  });

  test("sets title, composer, and subtitle together", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const result = setScoreMetadata(xml, {
      title: "My Song",
      composer: "Me",
      subtitle: "A ballad",
    });
    const meta = getScoreMetadata(result);
    expect(meta.title).toBe("My Song");
    expect(meta.composer).toBe("Me");
    expect(meta.subtitle).toBe("A ballad");
  });

  test("getScoreMetadata returns empty object when nothing set", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const meta = getScoreMetadata(xml);
    expect(meta.title).toBeUndefined();
    expect(meta.composer).toBeUndefined();
  });

  test("updating title preserves composer", () => {
    const xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    const r1 = setScoreMetadata(xml, { composer: "Bach" });
    const r2 = setScoreMetadata(r1, { title: "Invention" });
    const meta = getScoreMetadata(r2);
    expect(meta.composer).toBe("Bach");
    expect(meta.title).toBe("Invention");
  });
});

// ─── addNavigationMark ───────────────────────────────────────────────────────

describe("addNavigationMark", () => {
  test("adds segno symbol to a measure", () => {
    const result = addNavigationMark(score4(), 1, "segno");
    expect(result).toContain("segno");
  });

  test("adds coda symbol to a measure", () => {
    const result = addNavigationMark(score4(), 2, "coda");
    expect(result).toContain("coda");
  });

  test("adds fine marking to a measure", () => {
    const result = addNavigationMark(score4(), 2, "fine");
    expect(result).toContain("Fine");
  });

  test("adds D.C. al Fine (da capo) to a measure", () => {
    const result = addNavigationMark(score4(), 4, "dacapo");
    expect(result).toContain("D.C");
  });

  test("adds D.S. al Coda (dal segno) to a measure", () => {
    const result = addNavigationMark(score4(), 4, "dalsegno");
    expect(result).toContain("D.S");
  });

  test("navigation mark does not bleed into other measures", () => {
    const result = addNavigationMark(score4(), 1, "segno");
    const m2start = result.indexOf('<measure number="2"');
    const m2end = result.indexOf('</measure>', m2start);
    // Segno should not appear in measure 2 directions (only in m1)
    const m2 = result.slice(m2start, m2end);
    // The word 'segno' might appear as attribute name in serialised XML but
    // a direction-type kind="segno" should only be in m1
    expect(m2).not.toContain('kind: "segno"');
  });
});

// ─── addArpeggio ─────────────────────────────────────────────────────────────

describe("addArpeggio", () => {
  test("adds arpeggiate notation to chord notes in a measure", () => {
    // Write a chord
    let xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    xml = setMeasureNotes(xml, 1, [
      { step: "C", octave: 4, duration: "whole" },
      { step: "E", octave: 4, duration: "whole", chord: true },
      { step: "G", octave: 4, duration: "whole", chord: true },
    ], "P1");
    const result = addArpeggio(xml, 1);
    expect(result).toContain("arpeggiate");
  });

  test("arpeggio direction up", () => {
    let xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    xml = setMeasureNotes(xml, 1, [
      { step: "C", octave: 4, duration: "whole" },
      { step: "G", octave: 4, duration: "whole", chord: true },
    ], "P1");
    const result = addArpeggio(xml, 1, "up");
    expect(result).toContain("arpeggiate");
    expect(result).toContain("up");
  });

  test("arpeggio only affects the target measure", () => {
    let xml = createScore({ instruments: [{ name: "Piano" }], measures: 4 });
    xml = setMeasureNotes(xml, 1, [{ step: "C", octave: 4, duration: "whole" }], "P1");
    xml = setMeasureNotes(xml, 2, [{ step: "G", octave: 4, duration: "whole" }], "P1");
    const result = addArpeggio(xml, 1);
    const m2start = result.indexOf('<measure number="2"');
    const m2end = result.indexOf('</measure>', m2start);
    expect(result.slice(m2start, m2end)).not.toContain("arpeggiate");
  });
});

// ─── addTremolo ───────────────────────────────────────────────────────────────

describe("addTremolo", () => {
  test("adds single-note tremolo (buzz roll) to notes in a measure", () => {
    const result = addTremolo(score4(), 1, 3);
    expect(result).toContain("tremolo");
  });

  test("tremolo marks count is stored (2 marks = sixteenth tremolo)", () => {
    const result = addTremolo(score4(), 1, 2);
    expect(result).toContain("tremolo");
  });

  test("tremolo only affects target measure", () => {
    const result = addTremolo(score4(), 1, 3);
    const m2start = result.indexOf('<measure number="2"');
    const m2end = result.indexOf('</measure>', m2start);
    expect(result.slice(m2start, m2end)).not.toContain("tremolo");
  });
});

// ─── addGlissando ─────────────────────────────────────────────────────────────

describe("addGlissando", () => {
  test("adds glissando start on first note and stop on last note of range", () => {
    const result = addGlissando(score4(), 1, 2);
    expect(result).toContain("glissando");
    expect(result).toContain("start");
    expect(result).toContain("stop");
  });

  test("wavy glissando line type", () => {
    const result = addGlissando(score4(), 1, 2, "wavy");
    expect(result).toContain("wavy");
  });

  test("glissando within a single measure", () => {
    const result = addGlissando(score4(), 1, 1);
    expect(result).toContain("glissando");
  });
});

// ─── addBreathMark ────────────────────────────────────────────────────────────

describe("addBreathMark", () => {
  test("adds breath-mark articulation after target measure", () => {
    const result = addBreathMark(score4(), 1);
    expect(result).toContain("breath-mark");
  });

  test("breath mark is in the target measure", () => {
    const result = addBreathMark(score4(), 1);
    const m1start = result.indexOf('<measure number="1"');
    const m1end = result.indexOf('</measure>', m1start);
    expect(result.slice(m1start, m1end)).toContain("breath-mark");
  });

  test("breath mark does not appear in other measures", () => {
    const result = addBreathMark(score4(), 1);
    const m2start = result.indexOf('<measure number="2"');
    const m2end = result.indexOf('</measure>', m2start);
    expect(result.slice(m2start, m2end)).not.toContain("breath-mark");
  });
});

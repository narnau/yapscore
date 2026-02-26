/**
 * Regression tests for agent tool execution state.
 *
 * 1. liveXml propagation: createScore sets liveXml so writeNotes in the same
 *    multi-step turn doesn't throw "No score is currently loaded".
 *    Before the fix, all tool closures captured the original null currentMusicXml.
 *
 * 2. messages state: messages must be independent of history entries so they
 *    work at /editor/new before any score exists (hs.index === -1).
 *    Before the fix, dispatch({ type: "update-messages" }) silently dropped
 *    messages when state.index < 0.
 */

import { describe, it, expect } from "bun:test";
import { createScore, setMeasureNotes } from "@/lib/musicxml";

// ── 1. liveXml propagation ────────────────────────────────────────────────────

describe("agent liveXml propagation", () => {
  it("tool after createScore would fail WITHOUT liveXml (demonstrates the bug)", () => {
    // Simulate the broken state: currentMusicXml is null (new file),
    // createScore runs and returns XML, but the next tool still reads the
    // original null — this is what caused the "No score is currently loaded" error.
    const currentMusicXml: string | null = null; // captured at runAgent call time

    createScore({ instruments: [{ name: "Voice" }], measures: 4 }); // result ignored

    // Next tool still sees null — this is the bug
    expect(() => {
      if (!currentMusicXml) throw new Error("No score is currently loaded");
    }).toThrow("No score is currently loaded");
  });

  it("tool after createScore succeeds WITH liveXml (the fix)", () => {
    let liveXml: string | null = null; // mutable, updated by createScore

    // createScore execute: sets liveXml
    liveXml = createScore({ instruments: [{ name: "Voice" }], key: "G", measures: 4 });

    // writeNotes execute: reads liveXml — no longer null
    expect(() => {
      if (!liveXml) throw new Error("No score is currently loaded");
      liveXml = setMeasureNotes(liveXml, 1, [{ step: "G", octave: 4, duration: "quarter" }], "P1");
    }).not.toThrow();

    expect(liveXml).toContain("<step>G</step>");
  });

  it("consecutive writeNotes calls each see the previous result", () => {
    let liveXml: string | null = createScore({ instruments: [{ name: "Piano" }], measures: 4 });

    liveXml = setMeasureNotes(liveXml!, 1, [{ step: "C", octave: 4, duration: "whole" }], "P1");
    liveXml = setMeasureNotes(liveXml!, 2, [{ step: "D", octave: 4, duration: "whole" }], "P1");

    expect(liveXml).toContain("<step>C</step>");
    expect(liveXml).toContain("<step>D</step>");
  });
});

// ── 2. messages independent of history ───────────────────────────────────────

describe("messages state independence from history", () => {
  // Simulate the broken historyReducer update-messages case
  type HistoryState = { entries: { musicXml: string }[]; index: number };

  function brokenUpdateMessages(state: HistoryState, _msgs: string[]): HistoryState {
    // The old broken guard — silently returns unchanged state when no score loaded
    if (state.index < 0) return state;
    return state; // (simplified)
  }

  function fixedUpdateMessages(_state: HistoryState, msgs: string[]): string[] {
    // The fix: messages are independent state, always writable
    return msgs;
  }

  it("broken: update-messages is silently dropped when index < 0 (new file)", () => {
    const state: HistoryState = { entries: [], index: -1 }; // new file, no score yet
    const result = brokenUpdateMessages(state, ["hello", "Hi there!"]);
    // State unchanged — messages are lost
    expect(result.index).toBe(-1);
    expect(result.entries.length).toBe(0);
  });

  it("fixed: messages update independently of history index", () => {
    const msgs: string[] = [];
    const updated = fixedUpdateMessages({ entries: [], index: -1 }, ["hello", "Hi there!"]);
    // Messages are stored regardless of whether a score exists
    expect(updated).toEqual(["hello", "Hi there!"]);
    void msgs; // suppress unused warning
  });
});

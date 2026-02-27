import { describe, test, expect } from "bun:test";
import { historyReducer, messagesAtIndex, type HistoryState } from "./editor-history";
import type { HistoryEntry } from "./files";
import type { Message } from "@/components/ChatPanel";

function makeEntry(name: string, messages: Message[] = []): HistoryEntry {
  return { musicXml: `<xml>${name}</xml>`, name, timestamp: new Date().toISOString(), messages };
}

const initial: HistoryState = { entries: [], index: -1 };

describe("historyReducer", () => {
  test("push adds entry with messages", () => {
    const msgs: Message[] = [
      { role: "user", text: "create a C major scale" },
      { role: "system", text: "Done." },
    ];
    const entry = makeEntry("v1", msgs);
    const state = historyReducer(initial, { type: "push", entry });

    expect(state.entries).toHaveLength(1);
    expect(state.index).toBe(0);
    expect(state.entries[0].messages).toEqual(msgs);
  });

  test("push branches from current index, trimming future entries", () => {
    // Build: 3 entries, then go back to index 1
    let state = historyReducer(initial, { type: "push", entry: makeEntry("v1", [{ role: "user", text: "a" }]) });
    state = historyReducer(state, { type: "push", entry: makeEntry("v2", [{ role: "user", text: "a" }, { role: "user", text: "b" }]) });
    state = historyReducer(state, { type: "push", entry: makeEntry("v3", [{ role: "user", text: "a" }, { role: "user", text: "b" }, { role: "user", text: "c" }]) });
    expect(state.entries).toHaveLength(3);
    expect(state.index).toBe(2);

    // Go back to index 1
    state = historyReducer(state, { type: "undo" });
    expect(state.index).toBe(1);

    // Push from index 1 — should discard v3
    const branchEntry = makeEntry("v2-branch", [{ role: "user", text: "a" }, { role: "user", text: "branch" }]);
    state = historyReducer(state, { type: "push", entry: branchEntry });

    expect(state.entries).toHaveLength(3); // v1, v2, v2-branch (v3 discarded)
    expect(state.index).toBe(2);
    expect(state.entries[2].name).toBe("v2-branch");
    expect(state.entries[2].messages).toEqual([
      { role: "user", text: "a" },
      { role: "user", text: "branch" },
    ]);
  });

  test("undo does not go below 0", () => {
    const state: HistoryState = { entries: [makeEntry("v1")], index: 0 };
    const next = historyReducer(state, { type: "undo" });
    expect(next).toBe(state); // same reference = no change
  });

  test("redo does not go past last entry", () => {
    const state: HistoryState = { entries: [makeEntry("v1")], index: 0 };
    const next = historyReducer(state, { type: "redo" });
    expect(next).toBe(state);
  });
});

describe("messagesAtIndex", () => {
  test("returns messages for a valid index", () => {
    const msgs: Message[] = [{ role: "user", text: "hello" }];
    const entries = [makeEntry("v1", msgs)];
    expect(messagesAtIndex(entries, 0)).toEqual(msgs);
  });

  test("returns [] for entry without messages field", () => {
    const entries: HistoryEntry[] = [{ musicXml: "<xml/>", name: "old", timestamp: "" }];
    expect(messagesAtIndex(entries, 0)).toEqual([]);
  });

  test("returns [] for out-of-bounds index", () => {
    expect(messagesAtIndex([], 0)).toEqual([]);
    expect(messagesAtIndex([], -1)).toEqual([]);
  });
});

describe("full navigation scenario", () => {
  test("navigating to older version yields only that version's messages", () => {
    const msgs1: Message[] = [
      { role: "user", text: "create a piano score" },
      { role: "system", text: "Created." },
    ];
    const msgs2: Message[] = [
      ...msgs1,
      { role: "user", text: "add violin" },
      { role: "system", text: "Added violin." },
    ];
    const msgs3: Message[] = [
      ...msgs2,
      { role: "user", text: "transpose up" },
      { role: "system", text: "Transposed." },
    ];

    let state = historyReducer(initial, { type: "push", entry: makeEntry("v1", msgs1) });
    state = historyReducer(state, { type: "push", entry: makeEntry("v2", msgs2) });
    state = historyReducer(state, { type: "push", entry: makeEntry("v3", msgs3) });

    // At latest: 6 messages
    expect(messagesAtIndex(state.entries, state.index)).toHaveLength(6);

    // Undo to v2: 4 messages
    state = historyReducer(state, { type: "undo" });
    expect(state.index).toBe(1);
    expect(messagesAtIndex(state.entries, state.index)).toHaveLength(4);
    expect(messagesAtIndex(state.entries, state.index)).toEqual(msgs2);

    // Undo to v1: 2 messages
    state = historyReducer(state, { type: "undo" });
    expect(state.index).toBe(0);
    expect(messagesAtIndex(state.entries, state.index)).toHaveLength(2);
    expect(messagesAtIndex(state.entries, state.index)).toEqual(msgs1);

    // Redo to v2: 4 messages again
    state = historyReducer(state, { type: "redo" });
    expect(state.index).toBe(1);
    expect(messagesAtIndex(state.entries, state.index)).toHaveLength(4);
  });

  test("messages sent to LLM from older version do NOT include future messages", () => {
    const msgs1: Message[] = [
      { role: "user", text: "create a scale" },
      { role: "system", text: "Done." },
    ];
    const msgs2: Message[] = [
      ...msgs1,
      { role: "user", text: "change to minor" },
      { role: "system", text: "Changed." },
    ];

    let state = historyReducer(initial, { type: "push", entry: makeEntry("v1", msgs1) });
    state = historyReducer(state, { type: "push", entry: makeEntry("v2", msgs2) });

    // Navigate back to v1
    state = historyReducer(state, { type: "undo" });

    // Simulate: what would be sent to LLM from this version
    const llmHistory = messagesAtIndex(state.entries, state.index);
    expect(llmHistory).toEqual(msgs1);
    // Crucially: does NOT contain "change to minor" or "Changed."
    expect(llmHistory.some(m => m.text.includes("minor"))).toBe(false);
  });

  test("push from older version branches and trims future messages", () => {
    const msgs1: Message[] = [{ role: "user", text: "create" }, { role: "system", text: "OK" }];
    const msgs2: Message[] = [...msgs1, { role: "user", text: "add drum" }, { role: "system", text: "Added" }];

    let state = historyReducer(initial, { type: "push", entry: makeEntry("v1", msgs1) });
    state = historyReducer(state, { type: "push", entry: makeEntry("v2", msgs2) });

    // Go back to v1
    state = historyReducer(state, { type: "undo" });

    // Push new branch from v1
    const branchMsgs: Message[] = [...msgs1, { role: "user", text: "add flute" }, { role: "system", text: "Added flute" }];
    state = historyReducer(state, { type: "push", entry: makeEntry("v1-flute", branchMsgs) });

    expect(state.entries).toHaveLength(2); // v1 + v1-flute (v2 trimmed)
    expect(state.index).toBe(1);
    expect(messagesAtIndex(state.entries, state.index)).toEqual(branchMsgs);
    // The "add drum" message from v2 is gone
    expect(state.entries.every(e => !(e.messages ?? []).some(m => m.text.includes("drum")))).toBe(true);
  });
});

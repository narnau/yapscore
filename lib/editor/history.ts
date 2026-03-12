import type { HistoryEntry } from "./files";

export type HistoryState = { entries: HistoryEntry[]; index: number };
export type HistoryAction =
  | { type: "push"; entry: HistoryEntry }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "restore"; entries: HistoryEntry[]; index: number };

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "push": {
      // Branch from current index — trim any "future" entries
      const entries = [...state.entries.slice(0, state.index + 1), action.entry];
      return { entries, index: entries.length - 1 };
    }
    case "undo":
      if (state.index <= 0) return state;
      return { ...state, index: state.index - 1 };
    case "redo":
      if (state.index >= state.entries.length - 1) return state;
      return { ...state, index: state.index + 1 };
    case "restore":
      return { entries: action.entries, index: action.index };
  }
}

/** Get messages for a given history index (backward-compat: entries without messages return []). */
export function messagesAtIndex(entries: HistoryEntry[], index: number) {
  return entries[index]?.messages ?? [];
}

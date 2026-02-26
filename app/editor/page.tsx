"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import ChatPanel from "@/components/ChatPanel";
import ScoreViewer from "@/components/ScoreViewer";
import LibraryModal from "@/components/LibraryModal";

// ── history ───────────────────────────────────────────────────────────────────

type HistoryEntry = { musicXml: string; name: string | null };
type HistoryState = { entries: HistoryEntry[]; index: number };
type HistoryAction =
  | { type: "push"; entry: HistoryEntry }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "restore"; entries: HistoryEntry[]; index: number };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "push": {
      // Always append — never discard future versions when editing from a past version
      const entries = [...state.entries, action.entry];
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

const STORAGE_KEY = "score-ai-history";

// ── component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [hs, dispatch] = useReducer(historyReducer, { entries: [], index: -1 });
  const [selectedMeasures, setSelectedMeasures] = useState<Set<number>>(new Set());
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Derived from history
  const currentEntry = hs.index >= 0 ? hs.entries[hs.index] : null;
  const musicXml  = currentEntry?.musicXml  ?? null;
  const scoreName = currentEntry?.name ?? null;
  const canUndo = hs.index > 0;
  const canRedo = hs.index < hs.entries.length - 1;

  // ── restore from localStorage on mount ─────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const { entries, index } = JSON.parse(raw) as HistoryState;
      if (Array.isArray(entries) && entries.length > 0) {
        dispatch({ type: "restore", entries, index });
      }
    } catch {
      // ignore corrupted data
    }
  }, []);

  // ── persist to localStorage whenever history changes ────────────────────────
  useEffect(() => {
    if (hs.entries.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: hs.entries, index: hs.index }));
    } catch {
      // ignore quota errors
    }
  }, [hs]);

  // ── keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "undo" });
        setSelectedMeasures(new Set());
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        dispatch({ type: "redo" });
        setSelectedMeasures(new Set());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── handlers ────────────────────────────────────────────────────────────────
  const handleMeasureClick = useCallback((measureNumber: number, addToSelection: boolean) => {
    setSelectedMeasures((prev) => {
      const next = addToSelection ? new Set(prev) : new Set<number>();
      if (next.has(measureNumber)) {
        next.delete(measureNumber);
      } else {
        next.add(measureNumber);
      }
      return next;
    });
  }, []);

  const handleNew = useCallback(() => {
    dispatch({ type: "restore", entries: [], index: -1 });
    setSelectedMeasures(new Set());
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  const handleScoreReady = useCallback(
    (xml: string, name?: string) => {
      dispatch({
        type: "push",
        entry: { musicXml: xml, name: name ?? scoreName },
      });
      setSelectedMeasures(new Set());
    },
    [scoreName]
  );

  return (
    <main className="flex h-full">
      {/* Chat — 34% */}
      <div className="w-[34%] min-w-[280px] border-r border-gray-800 flex flex-col">
        <ChatPanel
          currentMusicXml={musicXml}
          scoreName={scoreName}
          selectedMeasures={selectedMeasures}
          onClearSelection={() => setSelectedMeasures(new Set())}
          onScoreReady={handleScoreReady}
          onOpenLibrary={() => setLibraryOpen(true)}
          onNew={handleNew}
        />
      </div>

      {/* Score viewer — 66% */}
      <div className="flex-1 flex flex-col">
        <ScoreViewer
          musicXml={musicXml}
          scoreName={scoreName}
          selectedMeasures={selectedMeasures}
          onMeasureClick={handleMeasureClick}
          canUndo={canUndo}
          canRedo={canRedo}
          historyIndex={hs.index}
          historyLength={hs.entries.length}
          onUndo={() => { dispatch({ type: "undo" }); setSelectedMeasures(new Set()); }}
          onRedo={() => { dispatch({ type: "redo" }); setSelectedMeasures(new Set()); }}
          onJumpTo={(idx) => {
            dispatch({ type: "restore", entries: hs.entries, index: idx });
            setSelectedMeasures(new Set());
          }}
          historyNames={hs.entries.map((e, i) =>
            e.name ?? (i === 0 ? "Original" : `Edit ${i}`)
          )}
        />
      </div>

      {libraryOpen && (
        <LibraryModal
          onClose={() => setLibraryOpen(false)}
          onScoreReady={(xml, name) => handleScoreReady(xml, name)}
        />
      )}
    </main>
  );
}

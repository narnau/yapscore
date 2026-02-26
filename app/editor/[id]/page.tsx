"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import ChatPanel, { type Message } from "@/components/ChatPanel";
import ScoreViewer from "@/components/ScoreViewer";
import type { HistoryEntry } from "@/lib/files";

// ── history ───────────────────────────────────────────────────────────────────

type HistoryState = { entries: HistoryEntry[]; index: number };
type HistoryAction =
  | { type: "push"; entry: HistoryEntry }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "restore"; entries: HistoryEntry[]; index: number };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "push": {
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

// ── auto-save ─────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 2000;

function localKey(id: string) { return `file-${id}`; }

// ── component ─────────────────────────────────────────────────────────────────

type Usage = { plan: "free" | "pro"; used: number; limit: number | null };

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [hs, dispatch] = useReducer(historyReducer, { entries: [], index: -1 });
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMeasures, setSelectedMeasures] = useState<Set<number>>(new Set());
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [loaded, setLoaded] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);

  // Derived from history
  const currentEntry  = hs.index >= 0 ? hs.entries[hs.index] : null;
  const musicXml      = currentEntry?.musicXml ?? null;
  const scoreName     = currentEntry?.name ?? null;
  const canUndo       = hs.index > 0;
  const canRedo       = hs.index < hs.entries.length - 1;

  // Ref to always have latest state for the debounced save
  const savePayloadRef = useRef({ hs, messages });
  savePayloadRef.current = { hs, messages };

  // ── load file on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      // 1. Try localStorage cache first (instant)
      try {
        const cached = localStorage.getItem(localKey(id));
        if (cached) {
          const { history, index, messages: msgs } = JSON.parse(cached);
          if (Array.isArray(history) && history.length > 0) {
            dispatch({ type: "restore", entries: history, index });
            setMessages(msgs ?? []);
          }
        }
      } catch { /* ignore */ }

      // 2. Load from DB (source of truth)
      try {
        const res = await fetch(`/api/files/${id}`);
        if (res.status === 404) { router.replace("/editor"); return; }
        if (!res.ok) return;
        const { file } = await res.json();
        const history: HistoryEntry[] = file.history ?? [];
        const msgs: Message[] = file.messages ?? [];
        const index = history.length > 0 ? history.length - 1 : -1;

        // Seed with current_xml if history is empty (e.g. file just created with upload)
        if (history.length === 0 && file.current_xml) {
          dispatch({
            type: "restore",
            entries: [{ musicXml: file.current_xml, name: file.name, timestamp: file.updated_at }],
            index: 0,
          });
        } else {
          dispatch({ type: "restore", entries: history, index });
        }
        setMessages(msgs);
      } catch { /* ignore, use cache */ }

      setLoaded(true);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── fetch usage ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/usage").then(r => r.json()).then(setUsage).catch(() => {});
  }, []);

  // ── auto-save ───────────────────────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loaded) return;
    const { hs: h, messages: msgs } = savePayloadRef.current;
    if (h.entries.length === 0) return;

    setSaveStatus("unsaved");

    // Write to localStorage immediately
    try {
      localStorage.setItem(localKey(id), JSON.stringify({
        history: h.entries,
        index: h.index,
        messages: msgs,
      }));
    } catch { /* quota */ }

    // Debounce Supabase write
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      const { hs: latest, messages: latestMsgs } = savePayloadRef.current;
      const current = latest.index >= 0 ? latest.entries[latest.index] : null;
      try {
        await fetch(`/api/files/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: current?.name ?? "Untitled",
            current_xml: current?.musicXml ?? null,
            history: latest.entries,
            messages: latestMsgs,
          }),
        });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    }, DEBOUNCE_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hs, messages, loaded]);

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
      if (next.has(measureNumber)) next.delete(measureNumber);
      else next.add(measureNumber);
      return next;
    });
  }, []);

  const handleNew = useCallback(async () => {
    // Create a fresh file and navigate to it
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Untitled" }),
    });
    const data = await res.json();
    router.push(`/editor/${data.id}`);
  }, [router]);

  const handleScoreReady = useCallback(
    (xml: string, name?: string) => {
      dispatch({
        type: "push",
        entry: { musicXml: xml, name: name ?? scoreName ?? "Untitled", timestamp: new Date().toISOString() },
      });
      setSelectedMeasures(new Set());
    },
    [scoreName]
  );

  return (
    <main className="flex h-full">
      {/* Save indicator */}
      <div className="fixed top-2 right-3 z-50 text-[10px] text-gray-600 pointer-events-none">
        {saveStatus === "saving"  && "Saving…"}
        {saveStatus === "unsaved" && "Unsaved"}
      </div>

      {/* Chat — 34% */}
      <div className="w-[34%] min-w-[280px] border-r border-gray-800 flex flex-col">
        <ChatPanel
          currentMusicXml={musicXml}
          scoreName={scoreName}
          selectedMeasures={selectedMeasures}
          messages={messages}
          onMessagesChange={setMessages}
          onClearSelection={() => setSelectedMeasures(new Set())}
          onScoreReady={handleScoreReady}
          onNew={handleNew}
          usage={usage}
          onUsageRefresh={() => fetch("/api/usage").then(r => r.json()).then(setUsage).catch(() => {})}
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
    </main>
  );
}

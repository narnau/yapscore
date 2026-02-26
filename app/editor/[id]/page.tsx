"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import ChatPanel, { type Message } from "@/components/ChatPanel";
import ScoreViewer from "@/components/ScoreViewer";
import SingModal from "@/components/SingModal";
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
  const isNew = id === "new";
  const router = useRouter();

  const [hs, dispatch] = useReducer(historyReducer, { entries: [], index: -1 });
  const [messages, setMessages] = useState<Message[]>([]);
  const [fileName, setFileName] = useState("Untitled");
  const [selectedMeasures, setSelectedMeasures] = useState<Set<number>>(new Set());
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [loaded, setLoaded] = useState(isNew); // "new" files are immediately ready
  const [usage, setUsage] = useState<Usage | null>(null);
  const [singOpen, setSingOpen] = useState(false);

  // For "new" files: the DB record doesn't exist yet. We create it lazily on first save.
  // After creation we get a real ID and replace the URL — the component remounts with the real ID.
  const creatingDbRef = useRef(false);

  // Derived from history
  const currentEntry  = hs.index >= 0 ? hs.entries[hs.index] : null;
  const musicXml      = currentEntry?.musicXml ?? null;
  const canUndo       = hs.index > 0;
  const canRedo       = hs.index < hs.entries.length - 1;

  // Ref to always have latest state for the debounced save
  const savePayloadRef = useRef({ hs, messages, fileName });
  savePayloadRef.current = { hs, messages, fileName };

  // ── load file on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    // "new" files have no DB record yet — start fresh
    if (isNew) return;

    async function load() {
      // 1. Try localStorage cache first (instant)
      try {
        const cached = localStorage.getItem(localKey(id));
        if (cached) {
          const { history, index, messages: msgs, fileName: name } = JSON.parse(cached);
          if (Array.isArray(history) && history.length > 0) {
            dispatch({ type: "restore", entries: history, index });
          }
          if (msgs) setMessages(msgs);
          if (name) setFileName(name);
        }
      } catch { /* ignore */ }

      // 2. Load from DB (source of truth)
      try {
        const res = await fetch(`/api/files/${id}`);
        if (res.status === 404) { router.replace("/editor"); return; }
        if (!res.ok) return;
        const { file } = await res.json();
        const history: HistoryEntry[] = file.history ?? [];
        const index = history.length > 0 ? history.length - 1 : -1;

        setFileName(file.name ?? "Untitled");
        if (file.messages) setMessages(file.messages);

        // Seed with current_xml if history is empty (e.g. file just created with upload)
        if (history.length === 0 && file.current_xml) {
          dispatch({
            type: "restore",
            entries: [{ musicXml: file.current_xml, name: file.name, timestamp: file.updated_at, messages: [] }],
            index: 0,
          });
        } else {
          dispatch({ type: "restore", entries: history, index });
        }
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
    const { hs: h, messages: msgs, fileName: name } = savePayloadRef.current;
    if (h.entries.length === 0 && msgs.length === 0) return; // nothing to save
    if (isNew && h.entries.length === 0) return; // don't create DB record until score exists

    setSaveStatus("unsaved");

    // Write to localStorage immediately (use "new" key for unsaved files)
    try {
      localStorage.setItem(localKey(id), JSON.stringify({
        history: h.entries,
        index: h.index,
        messages: msgs,
        fileName: name,
      }));
    } catch { /* quota */ }

    // Debounce DB write
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      const { hs: latest, messages: latestMsgs, fileName: latestName } = savePayloadRef.current;
      const current = latest.index >= 0 ? latest.entries[latest.index] : null;
      const body = {
        name: latestName || "Untitled",
        current_xml: current?.musicXml ?? null,
        history: latest.entries,
        messages: latestMsgs,
      };

      try {
        if (isNew) {
          // Lazy creation: first time we have content, create the DB record
          if (creatingDbRef.current) return;
          creatingDbRef.current = true;

          const createRes = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: latestName || "Untitled" }),
          });
          const { id: realId } = await createRes.json();

          // Save content to the new record
          await fetch(`/api/files/${realId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          // Pre-write localStorage under the real key so the remount finds data instantly
          try {
            localStorage.setItem(localKey(realId), JSON.stringify({
              history: latest.entries,
              index: latest.index,
              messages: latestMsgs,
              fileName: latestName,
            }));
            localStorage.removeItem(localKey("new"));
          } catch { /* quota */ }

          setSaveStatus("saved");
          router.replace(`/editor/${realId}`);
        } else {
          await fetch(`/api/files/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          setSaveStatus("saved");
        }
      } catch {
        setSaveStatus("unsaved");
        if (isNew) creatingDbRef.current = false; // allow retry
      }
    }, DEBOUNCE_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hs, messages, fileName, loaded]);

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

  const handleNew = useCallback(() => {
    router.push("/editor/new");
  }, [router]);

  const handleScoreReady = useCallback(
    (xml: string, label?: string) => {
      dispatch({
        type: "push",
        entry: { musicXml: xml, name: label ?? null, timestamp: new Date().toISOString() },
      });
      setSelectedMeasures(new Set());
    },
    []
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
          fileName={fileName}
          onFileNameChange={setFileName}
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
          scoreName={fileName}
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
          historyEntries={hs.entries.map((e, i) => ({
            name: e.name ?? (i === 0 ? "Original" : `Edit ${i}`),
            timestamp: e.timestamp,
          }))}
          onPlaybackStop={() => setSelectedMeasures(new Set())}
          onSingClick={musicXml ? () => setSingOpen(true) : undefined}
        />
      </div>
      {singOpen && musicXml && (
        <SingModal
          bpm={(() => {
            const m = musicXml.match(/<sound\b[^>]*tempo="(\d+(?:\.\d+)?)"/);
            return m ? Math.round(parseFloat(m[1])) : 120;
          })()}
          beats={parseInt(musicXml.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4")}
          beatType={parseInt(musicXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4")}
          totalMeasures={(() => {
            const fp = musicXml.match(/<part\b[^>]*>[\s\S]*?<\/part>/);
            return fp ? (fp[0].match(/<measure\b/g) ?? []).length : 0;
          })()}
          selectedMeasures={selectedMeasures}
          musicXml={musicXml}
          onInsert={(updatedXml, label) => {
            handleScoreReady(updatedXml, label);
            setSingOpen(false);
          }}
          onClose={() => setSingOpen(false)}
        />
      )}
    </main>
  );
}

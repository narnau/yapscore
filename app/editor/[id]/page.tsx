"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import ChatPanel, { type Message } from "@/components/ChatPanel";
import ScoreViewer from "@/components/ScoreViewer";
import SingModal from "@/components/SingModal";
import type { HistoryEntry } from "@/lib/files";
import { historyReducer, messagesAtIndex } from "@/lib/editor-history";

// ── auto-save ─────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 2000;

function localKey(id: string) { return `file-${id}`; }

// ── component ─────────────────────────────────────────────────────────────────

type Usage = { plan: "free" | "pro"; used: number; limit: number | null };

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [hs, dispatch] = useReducer(historyReducer, { entries: [], index: -1 });
  const [messages, setMessagesRaw] = useState<Message[]>([]);
  const [fileName, setFileName] = useState("Untitled");
  const [selectedMeasures, setSelectedMeasures] = useState<Set<number>>(new Set());
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [loaded, setLoaded] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [singOpen, setSingOpen] = useState(false);

  // Refs that are always up-to-date (synchronous) — used in callbacks with stale closures
  const messagesRef = useRef<Message[]>([]);
  const hsRef = useRef(hs);
  hsRef.current = hs;

  // Update both state and ref so handleScoreReady can read messages synchronously
  const setMessages = useCallback((msgs: Message[]) => {
    messagesRef.current = msgs;
    setMessagesRaw(msgs);
  }, []);

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
    async function load() {
      // 1. Try localStorage cache first (instant)
      try {
        const cached = localStorage.getItem(localKey(id));
        if (cached) {
          const { history, index, fileName: name } = JSON.parse(cached);
          if (Array.isArray(history) && history.length > 0) {
            dispatch({ type: "restore", entries: history, index });
            setMessages(messagesAtIndex(history, index));
          }
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

        // Backward compat: migrate global messages into the latest entry
        if (file.messages?.length > 0 && index >= 0 && !history[index].messages?.length) {
          history[index].messages = file.messages;
        }

        if (history.length === 0 && file.current_xml) {
          const entries = [{ musicXml: file.current_xml, name: file.name, timestamp: file.updated_at, messages: [] as Message[] }];
          dispatch({ type: "restore", entries, index: 0 });
          setMessages([]);
        } else {
          dispatch({ type: "restore", entries: history, index });
          setMessages(messagesAtIndex(history, index));
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

    setSaveStatus("unsaved");

    // Write to localStorage immediately (messages are inside entries)
    try {
      localStorage.setItem(localKey(id), JSON.stringify({
        history: h.entries,
        index: h.index,
        fileName: name,
      }));
    } catch { /* quota */ }

    // Debounce DB write
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      const { hs: latest, fileName: latestName } = savePayloadRef.current;
      const current = latest.index >= 0 ? latest.entries[latest.index] : null;
      try {
        await fetch(`/api/files/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: latestName || "Untitled",
            current_xml: current?.musicXml ?? null,
            history: latest.entries,
            messages: current?.messages ?? [],
          }),
        });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    }, DEBOUNCE_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hs, messages, fileName, loaded]);

  // ── navigation helpers (sync messages with history) ─────────────────────────

  const navigateTo = useCallback((index: number) => {
    dispatch({ type: "restore", entries: hsRef.current.entries, index });
    setMessages(messagesAtIndex(hsRef.current.entries, index));
    setSelectedMeasures(new Set());
  }, [setMessages]);

  const handleUndo = useCallback(() => {
    if (hsRef.current.index <= 0) return;
    navigateTo(hsRef.current.index - 1);
  }, [navigateTo]);

  const handleRedo = useCallback(() => {
    if (hsRef.current.index >= hsRef.current.entries.length - 1) return;
    navigateTo(hsRef.current.index + 1);
  }, [navigateTo]);

  // ── keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo]);

  // ── handlers ────────────────────────────────────────────────────────────────
  const handleMeasureClick = useCallback((measureNumber: number, addToSelection: boolean) => {
    setSelectedMeasures((prev) => {
      const next = addToSelection ? new Set(prev) : new Set<number>();
      if (next.has(measureNumber)) next.delete(measureNumber);
      else next.add(measureNumber);
      return next;
    });
  }, []);

  const [leaveModalOpen, setLeaveModalOpen] = useState(false);

  const isEmpty = !musicXml && messages.length === 0;
  const isUntitled = fileName === "Untitled" || fileName === "";

  function handleBack() {
    if (isUntitled) {
      setLeaveModalOpen(true);
    } else {
      router.push("/editor");
    }
  }

  async function handleLeaveDelete() {
    await fetch(`/api/files/${id}`, { method: "DELETE" });
    router.push("/editor");
  }

  async function handleLeaveRename(name: string) {
    setFileName(name);
    // Update localStorage immediately so the fast-path cache has the correct name
    try {
      const cached = localStorage.getItem(localKey(id));
      if (cached) {
        localStorage.setItem(localKey(id), JSON.stringify({ ...JSON.parse(cached), fileName: name }));
      }
    } catch { /* ignore */ }
    // Save to DB immediately — debounced effect won't fire (component is about to unmount)
    const { hs: h } = savePayloadRef.current;
    const current = h.index >= 0 ? h.entries[h.index] : null;
    await fetch(`/api/files/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        current_xml: current?.musicXml ?? null,
        history: h.entries,
        messages: current?.messages ?? [],
      }),
    });
    router.push("/editor");
  }

  const handleNew = useCallback(() => {
    router.push("/editor");
  }, [router]);

  const handleScoreReady = useCallback(
    (xml: string, label?: string) => {
      dispatch({
        type: "push",
        entry: {
          musicXml: xml,
          name: label ?? null,
          timestamp: new Date().toISOString(),
          messages: [...messagesRef.current],
        },
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
          onUndo={handleUndo}
          onRedo={handleRedo}
          onJumpTo={navigateTo}
          historyEntries={hs.entries.map((e, i) => ({
            name: e.name ?? (i === 0 ? "Original" : `Edit ${i}`),
            timestamp: e.timestamp,
          }))}
          onPlaybackStop={() => setSelectedMeasures(new Set())}
          onSingClick={musicXml ? () => setSingOpen(true) : undefined}
          onBack={handleBack}
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

      {/* Leave confirmation modal */}
      {leaveModalOpen && (
        <LeaveModal
          onDelete={handleLeaveDelete}
          onRename={handleLeaveRename}
        />
      )}
    </main>
  );
}

// ── Leave modal ───────────────────────────────────────────────────────────────

function LeaveModal({ onDelete, onRename }: {
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-80 space-y-4 shadow-2xl">
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-100">Untitled file</p>
          <p className="text-xs text-gray-400">Give it a name or delete it.</p>
        </div>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onRename(name.trim());
          }}
          placeholder="e.g. Symphony No. 1"
          className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-indigo-500 transition"
        />
        <div className="flex gap-2">
          <button
            onClick={onDelete}
            className="flex-1 px-3 py-2 rounded-lg bg-red-900/50 hover:bg-red-800 text-red-300 text-sm transition"
          >
            Delete
          </button>
          <button
            onClick={() => { if (name.trim()) onRename(name.trim()); }}
            disabled={!name.trim()}
            className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm transition"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

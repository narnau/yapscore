"use client";

import { useRef, useState } from "react";

type Usage = { plan: "free" | "pro"; used: number; limit: number | null };

type Props = {
  fileName: string;
  onFileNameChange: (name: string) => void;
  saveStatus: "saved" | "saving" | "unsaved";
  usage: Usage | null;
  onBack: () => void;
  onNew: () => void;
  currentMusicXml: string | null;
  // History controls
  canUndo: boolean;
  canRedo: boolean;
  historyIndex: number;
  historyLength: number;
  historyEntries: { name: string; timestamp: string }[];
  onUndo: () => void;
  onRedo: () => void;
  onJumpTo: (index: number) => void;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const BTN = "text-xs px-2 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-30 transition shrink-0";

export default function EditorTopBar({
  fileName,
  onFileNameChange,
  saveStatus,
  usage,
  onBack,
  onNew,
  currentMusicXml,
  canUndo,
  canRedo,
  historyIndex,
  historyLength,
  historyEntries,
  onUndo,
  onRedo,
  onJumpTo,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const statusColor =
    saveStatus === "saved"
      ? "bg-green-400"
      : saveStatus === "saving"
      ? "bg-yellow-400"
      : "bg-gray-400";

  const statusLabel =
    saveStatus === "saved"
      ? "Saved"
      : saveStatus === "saving"
      ? "Saving..."
      : "Unsaved";

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-200 bg-white shrink-0">
      {/* Back */}
      <button
        onClick={onBack}
        className={BTN}
        title="All files"
      >
        <span className="hidden md:inline">← Files</span>
        <span className="md:hidden">←</span>
      </button>

      <span className="text-gray-300 hidden md:inline text-xs">|</span>

      {/* File name (editable) */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={fileName}
            onChange={(e) => onFileNameChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditing(false);
            }}
            className="flex-1 min-w-0 bg-gray-50 border border-gray-200 text-sm text-gray-900 px-2 py-0.5 rounded outline-none focus:ring-1 focus:ring-brand-primary"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-gray-900 truncate max-w-[140px] md:max-w-none hover:text-brand-primary transition"
            title="Click to rename"
          >
            {fileName}
          </button>
        )}

        {/* Save status dot */}
        <div className="flex items-center gap-1 shrink-0" title={statusLabel}>
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="hidden md:inline text-xs text-brand-secondary">
            {statusLabel}
          </span>
        </div>
      </div>

      <span className="text-gray-300 hidden md:inline text-xs">|</span>

      {/* Undo / Redo */}
      <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" className={BTN}>↩</button>
      <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)" className={BTN}>↪</button>

      {/* History dropdown */}
      {historyLength > 0 && (
        <div className="relative shrink-0">
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            title="Version history"
            className={BTN}
          >
            v{historyIndex + 1}/{historyLength}
          </button>
          {historyOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setHistoryOpen(false)}
              />
              <div ref={historyListRef} className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-xl min-w-[300px] max-h-64 overflow-y-auto">
                {historyEntries.map((entry, i) => (
                  <button
                    key={i}
                    {...(i === historyIndex ? { "data-active": "" } : {})}
                    onClick={() => { onJumpTo(i); setHistoryOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition flex items-center gap-2 ${
                      i === historyIndex ? "text-brand-primary font-semibold" : "text-gray-700"
                    }`}
                  >
                    <span className="text-brand-secondary tabular-nums w-5 shrink-0">{i + 1}.</span>
                    <span className="truncate flex-1">{entry.name}</span>
                    <span className="text-brand-secondary shrink-0 tabular-nums">
                      {timeAgo(entry.timestamp)}
                    </span>
                    {i === historyIndex && <span className="text-brand-primary">←</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <span className="text-gray-300 hidden md:inline text-xs">|</span>

      {/* Usage badge */}
      {usage && usage.plan === "pro" && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary font-medium shrink-0 hidden md:inline">
          Pro
        </span>
      )}
      {usage && usage.limit !== null && usage.plan === "free" && (
        <span
          className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-brand-secondary shrink-0 hidden md:inline"
          title={`${usage.used} of ${usage.limit} free edits used`}
        >
          {usage.used}/{usage.limit} edits
        </span>
      )}

      {/* + New */}
      {currentMusicXml && (
        <button
          onClick={onNew}
          className={BTN}
          title="New score"
        >
          <span className="hidden md:inline">+ New</span>
          <span className="md:hidden">+</span>
        </button>
      )}
    </div>
  );
}

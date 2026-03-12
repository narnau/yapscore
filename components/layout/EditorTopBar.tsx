"use client";

import { useRef, useState } from "react";
import Logo from "../shared/Logo";

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
  onDocsOpen: () => void;
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

const GHOST_BTN =
  "p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-900 disabled:opacity-30 transition shrink-0";

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
  onDocsOpen,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const statusColor =
    saveStatus === "saved" ? "bg-green-400" : saveStatus === "saving" ? "bg-yellow-400" : "bg-gray-400";

  const statusLabel = saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving..." : "Unsaved";

  return (
    <div className="relative flex items-center px-3 py-2 border-b border-gray-200 bg-white shrink-0">
      {/* Centered logo (absolute so it doesn't affect layout) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <Logo size={18} className="text-brand-primary mr-1" />
        <span className="text-sm font-bold text-gray-900 tracking-tight">
          Yap<span className="text-brand-primary">Score</span>
        </span>
        <span className="ml-1.5 text-[9px] font-semibold tracking-wide uppercase px-1.5 rounded-full bg-brand-accent/15 border border-brand-accent/30 text-amber-700">
          Beta
        </span>
      </div>
      {/* Left zone — Back */}
      <div className="flex items-center shrink-0">
        <button onClick={onBack} className={GHOST_BTN} title="All files">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path
              fillRule="evenodd"
              d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Center zone — File name + save status */}
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
            className="max-w-[200px] md:max-w-[300px] bg-gray-50 border border-gray-200 text-sm text-gray-900 px-1.5 rounded outline-none focus:ring-1 focus:ring-brand-primary"
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

        <div className="flex items-center gap-1 shrink-0" title={statusLabel}>
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="hidden md:inline text-xs text-brand-secondary">{statusLabel}</span>
        </div>
      </div>

      {/* Right zone — Undo, Redo, History, Pro badge, New */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Unified history group: Undo + Redo + Version dropdown */}
        <div className="hidden md:flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="p-1 rounded-md hover:bg-white text-gray-500 hover:text-gray-900 disabled:opacity-30 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path
                fillRule="evenodd"
                d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="p-1 rounded-md hover:bg-white text-gray-500 hover:text-gray-900 disabled:opacity-30 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path
                fillRule="evenodd"
                d="M12.207 2.232a.75.75 0 0 1 1.06-.025l5.5 5.25a.75.75 0 0 1 0 1.085l-5.5 5.25a.75.75 0 0 1-1.036-1.085l4.146-3.957H6.375a3.875 3.875 0 0 0 0 7.75h2.875a.75.75 0 0 1 0 1.5H6.375a5.375 5.375 0 0 1 0-10.75h10.003L12.232 3.293a.75.75 0 0 1-.025-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {historyLength > 0 && (
            <div className="relative shrink-0">
              <div className="w-px h-4 bg-gray-300 mx-0.5" />
            </div>
          )}

          {historyLength > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={() => setHistoryOpen((o) => !o)}
                title={`Version history (${historyIndex + 1}/${historyLength})`}
                className="p-1 rounded-md hover:bg-white text-gray-500 hover:text-gray-900 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {historyOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setHistoryOpen(false)} />
                  <div
                    ref={historyListRef}
                    role="listbox"
                    className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-xl min-w-[300px] max-h-64 overflow-y-auto"
                  >
                    {historyEntries.map((entry, i) => (
                      <button
                        key={i}
                        role="option"
                        aria-selected={i === historyIndex}
                        {...(i === historyIndex ? { "data-active": "" } : {})}
                        onClick={() => {
                          onJumpTo(i);
                          setHistoryOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition flex items-center gap-2 ${
                          i === historyIndex ? "text-brand-primary font-semibold" : "text-gray-700"
                        }`}
                      >
                        <span className="text-brand-secondary tabular-nums w-5 shrink-0">{i + 1}.</span>
                        <span className="truncate flex-1">{entry.name}</span>
                        <span className="text-brand-secondary shrink-0 tabular-nums">{timeAgo(entry.timestamp)}</span>
                        {i === historyIndex && <span className="text-brand-primary">←</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Pro badge */}
        {usage && usage.plan === "pro" && (
          <span className="text-xs px-1.5 rounded-full bg-brand-primary/10 text-brand-primary font-medium shrink-0 hidden md:inline">
            Pro
          </span>
        )}
        {usage && usage.limit !== null && usage.plan === "free" && (
          <span
            className="text-xs px-1.5 rounded-full bg-gray-100 text-brand-secondary shrink-0 hidden md:inline"
            title={`${usage.used} of ${usage.limit} free edits used`}
          >
            {usage.used}/{usage.limit} edits
          </span>
        )}

        {/* New file */}
        <button onClick={onNew} className={GHOST_BTN} title="New file">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
        </button>

        {/* Docs */}
        <button onClick={onDocsOpen} className={GHOST_BTN} title="Documentation">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

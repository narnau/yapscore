"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/shared/Logo";
import NewScoreModal from "./NewScoreModal";
import { capture } from "@/lib/telemetry/posthog";

type FileEntry = {
  id: string;
  name: string;
  updated_at: string;
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

export default function DashboardClient({ initialFiles }: { initialFiles: FileEntry[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [upgraded, setUpgraded] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>(initialFiles);
  const [creating, setCreating] = useState(false);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    capture("dashboard_loaded", { fileCount: initialFiles.length });
  }, [initialFiles.length]);

  useEffect(() => {
    if (searchParams.get("upgraded") === "true") {
      setUpgraded(true);
      window.history.replaceState({}, "", "/editor");
    }
    if (searchParams.get("plan") === "pro") {
      window.history.replaceState({}, "", "/editor");
      fetch("/api/stripe/checkout", { method: "POST" })
        .then((r) => r.json())
        .then(({ url }) => {
          if (url) window.location.href = url;
        });
    }
  }, [searchParams]);

  async function createBlank(prompt?: string) {
    capture("file_created");
    setCreating(true);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled" }),
      });
      const { id } = await res.json();
      const url = prompt ? `/editor/${id}?prompt=${encodeURIComponent(prompt)}` : `/editor/${id}`;
      router.push(url);
    } finally {
      setCreating(false);
    }
  }

  async function createFromMelody(xml: string, name: string) {
    capture("file_created_from_melody", { melody: name });
    setCreating(true);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const { id } = await res.json();
      const welcomeMsg = {
        role: "system" as const,
        text: `I've loaded "${name}" for you! Ask me to make any changes.`,
        suggestions: [
          "Transpose to G major",
          "Change the tempo to 120 BPM",
          "Add a forte at measure 1",
          "Add a crescendo from measure 1 to 4",
        ],
      };
      await fetch(`/api/files/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_xml: xml,
          history: [{ musicXml: xml, name, timestamp: new Date().toISOString(), messages: [welcomeMsg] }],
          messages: [welcomeMsg],
        }),
      });
      router.push(`/editor/${id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload(file: File) {
    setCreating(true);
    try {
      const name = file.name.replace(/\.(mscz|mxl|musicxml|xml)$/i, "");

      // .mscz and .mxl need server-side conversion; .musicxml/.xml are plain text
      let musicXml: string;
      if (/\.(mscz|mxl)$/i.test(file.name)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/load", { method: "POST", body: form });
        const data = await res.json();
        if (!data.musicXml) throw new Error("Conversion failed");
        musicXml = data.musicXml;
      } else {
        musicXml = await file.text();
      }

      // Create a new file in DB with the XML as current_xml
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const { id } = await res.json();

      // Save the XML immediately
      const uploadWelcomeMsg = {
        role: "system" as const,
        text: `I've loaded "${name}" for you! Ask me to make any changes.`,
        suggestions: [
          "Transpose to G major",
          "Change the tempo to 120 BPM",
          "Add a forte at measure 1",
          "Add a crescendo from measure 1 to 4",
        ],
      };
      await fetch(`/api/files/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_xml: musicXml,
          history: [{ musicXml, name, timestamp: new Date().toISOString(), messages: [uploadWelcomeMsg] }],
          messages: [uploadWelcomeMsg],
        }),
      });

      router.push(`/editor/${id}`);
    } finally {
      setCreating(false);
    }
  }

  async function deleteFile(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this file?")) return;
    await fetch(`/api/files/${id}`, { method: "DELETE" });
    setFiles((f) => f.filter((x) => x.id !== id));
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      {/* Upgrade success banner */}
      {upgraded && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-emerald-800">
            <span className="text-base">🎉</span>
            <span>
              <strong>Welcome to Pro!</strong> You now have unlimited AI edits.
            </span>
          </div>
          <button
            onClick={() => setUpgraded(false)}
            className="text-emerald-600 hover:text-emerald-800 transition text-lg leading-none"
          >
            ✕
          </button>
        </div>
      )}
      {/* Header */}
      <header className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight flex items-center">
          <Logo size={24} className="text-brand-primary mr-1.5" />
          Yap<span className="text-brand-primary">Score</span>
          <span className="ml-2 text-[10px] font-semibold tracking-wide uppercase px-1.5 rounded-full bg-brand-accent/15 border border-brand-accent/30 text-amber-700">
            Beta
          </span>
        </h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setNewModalOpen(true)}
            disabled={creating}
            title="New file"
            className="flex items-center gap-1.5 px-2 md:px-4 py-2 rounded-lg bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 text-white text-sm font-medium transition shadow-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5 shrink-0"
            >
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            <span className="hidden md:inline">New file</span>
          </button>
          <Link
            href="/settings"
            title="Settings"
            className="flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-lg text-brand-secondary hover:text-gray-900 hover:bg-gray-50 text-sm transition"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5 shrink-0"
            >
              <path
                fillRule="evenodd"
                d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                clipRule="evenodd"
              />
            </svg>
            <span className="hidden md:inline">Settings</span>
          </Link>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              title="Log out"
              className="flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-lg text-brand-secondary hover:text-gray-900 hover:bg-gray-50 text-sm transition"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-5 h-5 shrink-0"
              >
                <path
                  fillRule="evenodd"
                  d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z"
                  clipRule="evenodd"
                />
                <path
                  fillRule="evenodd"
                  d="M6 10a.75.75 0 0 1 .75-.75h9.546l-1.048-.943a.75.75 0 1 1 1.004-1.114l2.5 2.25a.75.75 0 0 1 0 1.114l-2.5 2.25a.75.75 0 1 1-1.004-1.114l1.048-.943H6.75A.75.75 0 0 1 6 10Z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="hidden md:inline">Log out</span>
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-8">
        {/* Upload drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleUpload(f);
          }}
          className="mb-8 border-2 border-dashed border-gray-200 hover:border-brand-primary rounded-xl px-6 py-8 text-center cursor-pointer transition group"
        >
          <p className="text-brand-secondary group-hover:text-gray-900 transition text-sm">
            Drop a <strong>.mscz</strong>, <strong>.mxl</strong> or <strong>.musicxml</strong> file here, or click to
            upload
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".mscz,.mxl,.musicxml,.xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
        </div>

        {/* File list */}
        {files.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <p className="text-gray-700">No files yet.</p>
            <p className="text-sm text-brand-secondary">Upload a score or create a blank file to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-brand-secondary uppercase tracking-wider mb-3">Recent files</p>
            {files.map((f) => (
              <Link
                key={f.id}
                href={`/editor/${f.id}`}
                className="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-100 hover:border-gray-200 transition group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate text-gray-900">{f.name}</p>
                  <p className="text-xs text-brand-secondary mt-0.5">{timeAgo(f.updated_at)}</p>
                </div>
                <button
                  onClick={(e) => deleteFile(f.id, e)}
                  className="ml-4 text-gray-400 hover:text-red-500 transition text-xs px-2 py-1 rounded"
                  title="Delete"
                >
                  Delete
                </button>
              </Link>
            ))}
          </div>
        )}
      </main>

      {newModalOpen && (
        <NewScoreModal
          onPrompt={(p) => {
            setNewModalOpen(false);
            createBlank(p);
          }}
          onMelody={(xml, name) => {
            setNewModalOpen(false);
            createFromMelody(xml, name);
          }}
          onClose={() => setNewModalOpen(false)}
        />
      )}

      {creating && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
          <p className="text-sm text-brand-secondary animate-pulse">Creating...</p>
        </div>
      )}
    </div>
  );
}

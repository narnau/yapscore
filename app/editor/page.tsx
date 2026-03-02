"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import { capture } from "@/lib/posthog";

type FileEntry = {
  id: string;
  name: string;
  updated_at: string;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function FilesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [upgraded, setUpgraded] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchParams.get("upgraded") === "true") {
      setUpgraded(true);
      // Remove the query param from the URL without a page reload
      window.history.replaceState({}, "", "/editor");
    }
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/files")
      .then((r) => r.json())
      .then((d) => {
        const list = d.files ?? [];
        setFiles(list);
        capture("dashboard_loaded", { fileCount: list.length });
      })
      .finally(() => setLoading(false));
  }, []);

  async function createBlank() {
    capture("file_created");
    setCreating(true);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled" }),
      });
      const { id } = await res.json();
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
      await fetch(`/api/files/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_xml: musicXml,
          history: [{ musicXml, name, timestamp: new Date().toISOString() }],
          messages: [],
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
            <span><strong>Welcome to Pro!</strong> You now have unlimited AI edits.</span>
          </div>
          <button onClick={() => setUpgraded(false)} className="text-emerald-600 hover:text-emerald-800 transition text-lg leading-none">✕</button>
        </div>
      )}
      {/* Header */}
      <header className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight flex items-center"><Logo size={24} className="text-brand-primary mr-1.5" />Yap<span className="text-brand-primary">Score</span></h1>
        <div className="flex items-center gap-2">
          <button
            onClick={createBlank}
            disabled={creating}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 text-white text-sm font-medium transition shadow-sm"
          >
            + New file
          </button>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="px-3 py-2 rounded-lg text-brand-secondary hover:text-gray-900 hover:bg-gray-50 text-sm transition"
            >
              Log out
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
            Drop a <strong>.mscz</strong>, <strong>.mxl</strong> or <strong>.musicxml</strong> file here, or click to upload
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
        {loading ? (
          <p className="text-sm text-brand-secondary animate-pulse">Loading…</p>
        ) : files.length === 0 ? (
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

      {creating && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
          <p className="text-sm text-brand-secondary animate-pulse">Creating…</p>
        </div>
      )}
    </div>
  );
}

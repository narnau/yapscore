"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/files")
      .then((r) => r.json())
      .then((d) => setFiles(d.files ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function createBlank() {
    setCreating(true);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled" }),
      });
      const data = await res.json();
      router.push(`/editor/${data.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload(file: File) {
    setCreating(true);
    try {
      const name = file.name.replace(/\.(mscz|musicxml|xml)$/i, "");

      // Convert .mscz if needed
      let musicXml: string;
      if (file.name.endsWith(".mscz")) {
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
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">score-ai</h1>
        <button
          onClick={createBlank}
          disabled={creating}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium transition"
        >
          + New file
        </button>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-8">
        {/* Upload drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          className="mb-8 border-2 border-dashed border-gray-700 hover:border-indigo-500 rounded-xl px-6 py-8 text-center cursor-pointer transition group"
        >
          <p className="text-gray-400 group-hover:text-gray-200 transition text-sm">
            Drop a <strong>.mscz</strong> or <strong>.musicxml</strong> file here, or click to upload
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".mscz,.musicxml,.xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
        </div>

        {/* File list */}
        {loading ? (
          <p className="text-sm text-gray-500 animate-pulse">Loading…</p>
        ) : files.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <p className="text-gray-400">No files yet.</p>
            <p className="text-sm text-gray-600">Upload a score or create a blank file to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-3">Recent files</p>
            {files.map((f) => (
              <Link
                key={f.id}
                href={`/editor/${f.id}`}
                className="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 transition group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{f.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{timeAgo(f.updated_at)}</p>
                </div>
                <button
                  onClick={(e) => deleteFile(f.id, e)}
                  className="ml-4 text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition text-xs px-2 py-1 rounded"
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <p className="text-sm text-gray-300 animate-pulse">Creating…</p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type ScoreEntry = {
  id: string;
  name: string;
  description: string;
  uploadedAt: string;
};

export default function LibraryPage() {
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchScores() {
    const res = await fetch("/api/library");
    const data = await res.json();
    setScores(data.scores ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchScores();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("description", description.trim());
      form.append("file", file);
      const res = await fetch("/api/library", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setName("");
        setDescription("");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        await fetchScores();
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/library/${id}`, { method: "DELETE" });
    await fetchScores();
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-8 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/editor" className="text-sm text-indigo-400 hover:text-indigo-300 transition">
          ← Back to editor
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Score Library</h1>
      </div>

      {/* Upload form */}
      <form onSubmit={handleUpload} className="bg-gray-900 rounded-xl p-5 mb-8 space-y-3 border border-gray-800">
        <h2 className="text-sm font-medium text-gray-300 mb-1">Add a score</h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Score name"
          className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
        />
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 cursor-pointer hover:bg-gray-700 transition"
          onClick={() => fileRef.current?.click()}
        >
          <span className="text-xs text-gray-300 truncate">
            {file ? file.name : "Click to select .mscz file…"}
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".mscz"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={!name.trim() || !file || uploading}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-sm font-medium transition"
        >
          {uploading ? "Uploading…" : "Add to Library"}
        </button>
      </form>

      {/* Score list */}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : scores.length === 0 ? (
        <p className="text-gray-500 text-sm">No scores yet. Upload one above.</p>
      ) : (
        <ul className="space-y-3">
          {scores.map((s) => (
            <li key={s.id} className="bg-gray-900 rounded-xl px-4 py-3 border border-gray-800 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{s.name}</p>
                {s.description && (
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{s.description}</p>
                )}
                <p className="text-xs text-gray-600 mt-1">
                  {new Date(s.uploadedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(s.id)}
                className="text-xs text-red-400 hover:text-red-300 transition shrink-0 mt-0.5"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

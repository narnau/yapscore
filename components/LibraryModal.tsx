"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ScoreEntry = {
  id: string;
  name: string;
  description: string;
  uploadedAt: string;
};

type Props = {
  onClose: () => void;
  onScoreReady: (musicXml: string, name: string) => void;
};

export default function LibraryModal({ onClose, onScoreReady }: Props) {
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => setScores(d.scores ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function handleLoad(id: string) {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/library/${id}/load`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        onScoreReady(data.musicXml, data.name);
        onClose();
      }
    } catch {
      setError("Network error");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md mx-4 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-base">Score Library</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition text-lg leading-none">
            ✕
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
        ) : scores.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            No scores yet.{" "}
            <Link href="/editor/library" className="text-indigo-400 hover:text-indigo-300">
              Add some →
            </Link>
          </p>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {scores.map((s) => (
              <li key={s.id} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  {s.description && (
                    <p className="text-xs text-gray-400 truncate mt-0.5">{s.description}</p>
                  )}
                </div>
                <button
                  onClick={() => handleLoad(s.id)}
                  disabled={loadingId !== null}
                  className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg transition shrink-0"
                >
                  {loadingId === s.id ? "Loading…" : "Load"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

        <div className="mt-4 pt-3 border-t border-gray-700">
          <Link href="/editor/library" className="text-xs text-indigo-400 hover:text-indigo-300 transition">
            Manage library →
          </Link>
        </div>
      </div>
    </div>
  );
}

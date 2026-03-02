"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function SettingsPage() {
  const router = useRouter();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    fetchKeys();
  }, []);

  async function fetchKeys() {
    setLoading(true);
    const res = await fetch("/api/keys");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys ?? []);
    }
    setLoading(false);
  }

  async function createKey() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setCreatedKey(data.key);
      setNewKeyName("");
      setShowCreateForm(false);
      fetchKeys();
    }
    setCreating(false);
  }

  async function revokeKey(id: string) {
    setRevoking(id);
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (res.ok || res.status === 204) {
      setKeys((prev) => prev.map((k) => k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k));
    }
    setRevoking(null);
  }

  async function copyKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold tracking-tight text-gray-900">YapScore</Link>
          <Link href="/editor" className="text-sm text-brand-secondary hover:text-gray-900 transition">
            Dashboard →
          </Link>
        </div>
      </nav>

      <div className="pt-24 pb-20 px-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Settings</h1>
          <p className="mt-2 text-brand-secondary">Manage your API keys for programmatic access.</p>

          <div className="mt-10 bg-white rounded-2xl border border-gray-100 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-base font-semibold text-gray-900">API Keys</h2>
                <p className="text-sm text-brand-secondary mt-0.5">
                  Use these keys to access the{" "}
                  <Link href="/developers" className="text-brand-primary hover:underline">
                    YapScore API
                  </Link>
                  .
                </p>
              </div>
              {!showCreateForm && (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="text-sm px-4 py-2 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition"
                >
                  Create key
                </button>
              )}
            </div>

            {/* Create form */}
            {showCreateForm && (
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                <p className="text-sm font-medium text-gray-900 mb-3">New API key</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="Key name (e.g. My App)"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createKey()}
                    className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary"
                    autoFocus
                  />
                  <button
                    onClick={createKey}
                    disabled={creating || !newKeyName.trim()}
                    className="text-sm px-4 py-2 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition disabled:opacity-50"
                  >
                    {creating ? "Creating…" : "Create"}
                  </button>
                  <button
                    onClick={() => { setShowCreateForm(false); setNewKeyName(""); }}
                    className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-300 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Key list */}
            {loading ? (
              <div className="px-6 py-10 text-sm text-brand-secondary text-center">Loading…</div>
            ) : activeKeys.length === 0 && revokedKeys.length === 0 ? (
              <div className="px-6 py-10 text-sm text-brand-secondary text-center">
                No API keys yet. Create one to get started.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {activeKeys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between px-6 py-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{k.name}</p>
                      <p className="text-xs text-brand-secondary mt-0.5 font-mono">
                        {k.key_prefix}••••••••
                      </p>
                      <p className="text-xs text-brand-secondary mt-0.5">
                        Created {formatDate(k.created_at)} · Last used {formatDate(k.last_used_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => revokeKey(k.id)}
                      disabled={revoking === k.id}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                    >
                      {revoking === k.id ? "Revoking…" : "Revoke"}
                    </button>
                  </li>
                ))}
                {revokedKeys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between px-6 py-4 opacity-50">
                    <div>
                      <p className="text-sm font-medium text-gray-500 line-through">{k.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5 font-mono">
                        {k.key_prefix}••••••••
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Revoked {formatDate(k.revoked_at)}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">Revoked</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* One-time key reveal modal */}
      {createdKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900">Your new API key</h3>
            <p className="text-sm text-brand-secondary mt-1">
              Copy it now — we won&apos;t show it again.
            </p>

            <div className="mt-4 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <code className="flex-1 text-xs font-mono text-gray-800 break-all">{createdKey}</code>
              <button
                onClick={copyKey}
                className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Store this key securely. It will not be shown again.
            </p>

            <button
              onClick={() => setCreatedKey(null)}
              className="mt-4 w-full text-sm py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-300 transition"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

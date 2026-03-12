"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/shared/Logo";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface UsageData {
  plan: "free" | "pro";
  used: number;
  limit: number | null;
}

interface UserData {
  email: string;
  name: string;
}

interface SettingsClientProps {
  initialUser: UserData;
  initialUsage: UsageData;
  initialKeys: ApiKey[];
}

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function SettingsClient({ initialUser, initialUsage, initialKeys }: SettingsClientProps) {
  const router = useRouter();

  // Account & usage
  const user = initialUser;
  const usage = initialUsage;

  // API keys
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  // Delete account
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  // --- API key handlers ---
  async function fetchKeys() {
    const res = await fetch("/api/keys");
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys ?? []);
    }
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
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k)));
    }
    setRevoking(null);
  }

  async function copyKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // --- Subscription handlers ---
  async function manageSubscription() {
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const { url } = await res.json();
    if (url) window.location.href = url;
  }

  async function upgradeToPro() {
    const res = await fetch("/api/stripe/checkout", { method: "POST" });
    const { url } = await res.json();
    if (url) window.location.href = url;
  }

  // --- Delete account ---
  async function deleteAccount() {
    setDeleting(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (res.ok) {
        router.push("/");
      }
    } finally {
      setDeleting(false);
    }
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white border-b border-gray-100">
        <div className="px-4 h-12 flex items-center gap-2">
          {/* Back arrow — same style as editor/[id] */}
          <Link
            href="/editor"
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition"
            title="Dashboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
                clipRule="evenodd"
              />
            </svg>
          </Link>

          {/* Logo — left, same as /editor dashboard */}
          <Link href="/" className="flex items-center text-lg font-bold text-gray-900 tracking-tight">
            <Logo size={20} className="text-brand-primary mr-1" />
            Yap<span className="text-brand-primary">Score</span>
          </Link>
        </div>
      </nav>

      <div className="pt-24 pb-20 px-6">
        <div className="max-w-2xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Settings</h1>
            <p className="mt-2 text-brand-secondary">Manage your account, subscription, and API keys.</p>
          </div>

          {/* --- Section 1: Account --- */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Account</h2>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-brand-secondary">Name</span>
                <span className="text-sm text-gray-900">{user.name || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-brand-secondary">Email</span>
                <span className="text-sm text-gray-900">{user.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-brand-secondary">Plan</span>
                <span className="text-sm font-medium text-gray-900">{usage.plan === "pro" ? "Pro" : "Free"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-brand-secondary">AI edits used</span>
                <span className="text-sm text-gray-900">
                  {usage.used}
                  {usage.limit !== null ? ` / ${usage.limit}` : " (unlimited)"}
                </span>
              </div>
            </div>
          </section>

          {/* --- Section 2: Subscription --- */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Subscription</h2>
            </div>
            <div className="px-6 py-5">
              {usage.plan === "pro" ? (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-brand-secondary">
                    You&apos;re on the <strong className="text-gray-900">Pro</strong> plan with unlimited AI edits.
                  </p>
                  <button
                    onClick={manageSubscription}
                    className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-300 transition"
                  >
                    Manage subscription
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-brand-secondary">
                    You&apos;re on the <strong className="text-gray-900">Free</strong> plan ({usage.used}/{usage.limit}{" "}
                    edits used).
                  </p>
                  <button
                    onClick={upgradeToPro}
                    className="text-sm px-4 py-2 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition"
                  >
                    Upgrade to Pro
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* --- Section 3: API Keys --- */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm">
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
                    {creating ? "Creating..." : "Create"}
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateForm(false);
                      setNewKeyName("");
                    }}
                    className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-300 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Key list */}
            {activeKeys.length === 0 && revokedKeys.length === 0 ? (
              <div className="px-6 py-10 text-sm text-brand-secondary text-center">
                No API keys yet. Create one to get started.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {activeKeys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between px-6 py-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{k.name}</p>
                      <p className="text-xs text-brand-secondary mt-0.5 font-mono">{k.key_prefix}••••••••</p>
                      <p className="text-xs text-brand-secondary mt-0.5">
                        Created {formatDate(k.created_at)} · Last used {formatDate(k.last_used_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => revokeKey(k.id)}
                      disabled={revoking === k.id}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                    >
                      {revoking === k.id ? "Revoking..." : "Revoke"}
                    </button>
                  </li>
                ))}
                {revokedKeys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between px-6 py-4 opacity-50">
                    <div>
                      <p className="text-sm font-medium text-gray-500 line-through">{k.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5 font-mono">{k.key_prefix}••••••••</p>
                      <p className="text-xs text-gray-400 mt-0.5">Revoked {formatDate(k.revoked_at)}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">Revoked</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* --- Section 4: Danger Zone --- */}
          <section className="bg-white rounded-2xl border border-red-200 shadow-sm">
            <div className="px-6 py-5 border-b border-red-100">
              <h2 className="text-base font-semibold text-red-600">Danger Zone</h2>
            </div>
            <div className="px-6 py-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Delete account</p>
                <p className="text-sm text-brand-secondary mt-0.5">
                  Permanently delete your account, files, and subscription.
                </p>
              </div>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="text-sm px-4 py-2 rounded-lg border border-red-200 text-red-600 font-medium hover:bg-red-50 transition"
              >
                Delete account
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* One-time key reveal modal */}
      {createdKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900">Your new API key</h3>
            <p className="text-sm text-brand-secondary mt-1">Copy it now — we won&apos;t show it again.</p>

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

      {/* Delete account confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-red-600">Delete your account?</h3>
            <p className="text-sm text-brand-secondary mt-2">
              This action is <strong>permanent and irreversible</strong>. All your files, chat history, API keys, and
              subscription will be deleted.
            </p>
            <p className="text-sm text-gray-900 mt-4">
              Type <strong>delete</strong> to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="delete"
              className="mt-2 w-full text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
              autoFocus
            />
            <div className="mt-4 flex gap-3">
              <button
                onClick={deleteAccount}
                disabled={deleteConfirm !== "delete" || deleting}
                className="flex-1 text-sm py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? "Deleting..." : "Delete my account"}
              </button>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirm("");
                }}
                className="flex-1 text-sm py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-300 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

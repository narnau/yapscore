"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

type OAuthProvider = "google" | "azure" | "apple";

const isDev = process.env.NODE_ENV === "development";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") || "/editor";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devMode, setDevMode] = useState<"signin" | "signup">("signin");

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    if (devMode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        await fetch("/api/auth/profile", { method: "POST" });
        router.push(returnTo);
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else {
        setError("Check your email to confirm your account.");
      }
    }
    setLoading(false);
  }

  async function handleOAuth(provider: OAuthProvider) {
    const supabase = createClient();
    const callbackUrl = `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(returnTo)}`;
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl },
    });
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full space-y-6">
        <div className="text-center">
          <Link href="/" className="text-2xl font-bold text-gray-900 tracking-tight flex items-center justify-center">
            <Logo size={28} className="text-brand-primary mr-1.5" />Yap<span className="text-brand-primary">Score</span>
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-gray-900 mt-6">Welcome to YapScore</h1>
          <p className="text-sm text-brand-secondary mt-2">Sign in to access your scores and editor.</p>
        </div>

        <div className="space-y-3">
          {/* Google */}
          <button
            onClick={() => handleOAuth("google")}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>

          {/* Microsoft */}
          <button
            onClick={() => handleOAuth("azure")}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#F25022" d="M1 1h10v10H1z" />
              <path fill="#7FBA00" d="M13 1h10v10H13z" />
              <path fill="#00A4EF" d="M1 13h10v10H1z" />
              <path fill="#FFB900" d="M13 13h10v10H13z" />
            </svg>
            Continue with Microsoft
          </button>

          {/* Apple */}
          <button
            onClick={() => handleOAuth("apple")}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black text-white rounded-xl text-sm font-medium hover:bg-gray-900 transition shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
            Continue with Apple
          </button>
        </div>

        {isDev && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-brand-secondary">dev only</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-medium">
              <button type="button" onClick={() => { setDevMode("signin"); setError(null); }} className={`flex-1 py-2 transition ${devMode === "signin" ? "bg-gray-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>Sign in</button>
              <button type="button" onClick={() => { setDevMode("signup"); setError(null); }} className={`flex-1 py-2 transition ${devMode === "signup" ? "bg-gray-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>Sign up</button>
            </div>
            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition"
              />
              {error && <p className="text-red-500 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white rounded-xl text-sm font-medium transition"
              >
                {loading ? (devMode === "signin" ? "Signing in…" : "Signing up…") : (devMode === "signin" ? "Sign in" : "Sign up")}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

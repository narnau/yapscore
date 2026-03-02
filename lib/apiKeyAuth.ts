import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash, randomBytes } from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

// API is Pro-only. Free users get a 403 before any LLM call.
// Daily cap protects against runaway scripts from Pro users.
// At ~$0.006/call (Gemini 2.5 Flash, ~3 agent steps avg), 20 calls/day = ~$3.60/mo worst case.
// Revisit once real usage data is available — this is a beta limit.
export const API_DAILY_LIMIT = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthSuccess = { ok: true; userId: string };
type AuthFailure = { ok: false; response: NextResponse };
export type ApiKeyAuthResult = AuthSuccess | AuthFailure;

type AccessOk  = { ok: true };
type AccessFail = { ok: false; response: NextResponse };
export type ApiAccessResult = AccessOk | AccessFail;

// ─── Key generation ───────────────────────────────────────────────────────────

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  // ys_ + 32 random bytes (base64url) → ~46 chars total
  const raw = randomBytes(32).toString("base64url");
  const key = `ys_${raw}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 12);
  return { key, hash, prefix };
}

// ─── Step 1: validate the API key → get userId ───────────────────────────────

export async function getApiKeyUser(req: NextRequest): Promise<ApiKeyAuthResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ys_")) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 }),
    };
  }

  const key = authHeader.slice("Bearer ".length);
  const hash = createHash("sha256").update(key).digest("hex");

  const admin = createAdminClient();
  const { data: apiKey, error } = await admin
    .from("api_keys")
    .select("id, user_id, revoked_at")
    .eq("key_hash", hash)
    .single();

  if (error || !apiKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid API key" }, { status: 401 }),
    };
  }

  if (apiKey.revoked_at) {
    return {
      ok: false,
      response: NextResponse.json({ error: "API key has been revoked" }, { status: 401 }),
    };
  }

  // Fire-and-forget last_used_at update — don't block the request
  void admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id);

  return { ok: true, userId: apiKey.user_id };
}

// ─── Step 2: Pro-only gate + daily rate limit ─────────────────────────────────

export async function checkApiAccess(userId: string): Promise<ApiAccessResult> {
  const admin = createAdminClient();

  // Pro-only — free users cannot use the API
  const { data: profile } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();

  if (profile?.plan !== "pro") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "API access requires a Pro subscription", upgrade_url: "https://yapscore.ai/settings" },
        { status: 403 }
      ),
    };
  }

  // Atomic daily rate limit check + increment (resets at midnight UTC)
  const { data: allowed } = await admin.rpc("check_and_increment_api_calls", {
    p_user_id:     userId,
    p_daily_limit: API_DAILY_LIMIT,
  });

  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Daily API limit reached", limit: API_DAILY_LIMIT, resets: "midnight UTC" },
        { status: 429 }
      ),
    };
  }

  return { ok: true };
}

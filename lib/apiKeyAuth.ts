import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash, randomBytes } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

type ApiKeyAuthSuccess = { ok: true; userId: string };
type ApiKeyAuthFailure = { ok: false; response: NextResponse };
export type ApiKeyAuthResult = ApiKeyAuthSuccess | ApiKeyAuthFailure;

// ─── Key generation ───────────────────────────────────────────────────────────

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  // ys_ + 32 random bytes (base64url) → ~46 chars total
  const raw = randomBytes(32).toString("base64url");
  const key = `ys_${raw}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 12);
  return { key, hash, prefix };
}

// ─── Request validation ───────────────────────────────────────────────────────

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

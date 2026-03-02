import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/apiKeyAuth";

// GET /api/keys — list user's API keys
export async function GET() {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }

  return NextResponse.json({ keys: data });
}

// POST /api/keys — create a new API key
export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { key, hash, prefix } = generateApiKey();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("api_keys")
    .insert({ user_id: auth.userId, name, key_hash: hash, key_prefix: prefix })
    .select("id, name, key_prefix, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }

  // Return the full key only once — never stored in plain text
  return NextResponse.json({ ...data, key }, { status: 201 });
}

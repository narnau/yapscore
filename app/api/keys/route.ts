import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/auth/api-key";

const createKeySchema = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .transform((s) => s.trim()),
});

// GET /api/keys — list user's API keys
export async function GET() {
  try {
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
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/keys — create a new API key
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const parsed = createKeySchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message ?? "Invalid request";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { name } = parsed.data;
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
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

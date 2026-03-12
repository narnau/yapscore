import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// DELETE /api/keys/[id] — revoke an API key
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin = createAdminClient();

  // Verify ownership before revoking
  const { data: existing } = await admin.from("api_keys").select("user_id").eq("id", id).single();

  if (!existing || existing.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await admin.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

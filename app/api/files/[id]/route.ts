import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFile, saveFile, deleteFile } from "@/lib/files";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const admin = createAdminClient();
    const file = await getFile(admin, auth.userId, id);
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ file });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const patch: Parameters<typeof saveFile>[3] = {};
    if ("name"        in body) patch.name        = body.name;
    if ("current_xml" in body) patch.current_xml = body.current_xml;
    if ("history"     in body) patch.history     = body.history;
    if ("messages"    in body) patch.messages    = body.messages;

    const admin = createAdminClient();
    await saveFile(admin, auth.userId, id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const admin = createAdminClient();
    await deleteFile(admin, auth.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

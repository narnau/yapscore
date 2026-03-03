import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFile, saveFile, deleteFile } from "@/lib/files";
import { fixPercussionDisplayOctave } from "@/lib/musicxml";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const admin = createAdminClient();
    const file = await getFile(admin, auth.userId, id);
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Fix percussion display-octave on the fly for any stored file
    if (file.current_xml) file.current_xml = fixPercussionDisplayOctave(file.current_xml);
    if (file.history) {
      for (const entry of file.history) {
        if (entry.musicXml) entry.musicXml = fixPercussionDisplayOctave(entry.musicXml);
      }
    }
    return NextResponse.json({ file });
  } catch (err) {
    console.error("[files/id] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
    if ("swing"       in body) patch.swing       = body.swing;

    const admin = createAdminClient();
    await saveFile(admin, auth.userId, id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[files/id] PATCH error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
    console.error("[files/id] DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

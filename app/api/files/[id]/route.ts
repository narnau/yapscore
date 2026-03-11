import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFile, saveFile, deleteFile } from "@/lib/files";
import { fixPercussionDisplayOctave } from "@/lib/music/musicxml";

const patchSchema = z.object({
  name: z.string().max(200).optional(),
  current_xml: z.string().nullable().optional(),
  history: z.array(z.object({
    musicXml: z.string(),
    name: z.string().nullable(),
    timestamp: z.string(),
    messages: z.array(z.object({ role: z.enum(["user", "system"]), text: z.string() })).optional(),
  })).optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "system"]),
    text: z.string(),
    suggestions: z.array(z.string()).optional(),
  })).optional(),
  swing: z.boolean().nullable().optional(),
}).strict();

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

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const admin = createAdminClient();
    await saveFile(admin, auth.userId, id, parsed.data);
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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listFiles, createFile } from "@/lib/editor/files";

const createSchema = z.object({
  name: z.string().max(200).optional().default("Untitled"),
});

export async function GET() {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  try {
    const admin = createAdminClient();
    const files = await listFiles(admin, auth.userId);
    return NextResponse.json({ files });
  } catch (err) {
    console.error("[files] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { id } = await createFile(admin, auth.userId, parsed.data.name);
    return NextResponse.json({ id });
  } catch (err) {
    console.error("[files] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

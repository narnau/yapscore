import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listFiles, createFile } from "@/lib/files";

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
    const name: string = body.name ?? "Untitled";

    const admin = createAdminClient();
    const { id } = await createFile(admin, auth.userId, name);
    return NextResponse.json({ id });
  } catch (err) {
    console.error("[files] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

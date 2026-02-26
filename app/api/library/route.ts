import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { listScores, addScore } from "@/lib/library";

export async function GET() {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const scores = await listScores(auth.supabase, auth.userId);
  return NextResponse.json({ scores });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const formData = await req.formData();
  const name = formData.get("name") as string | null;
  const description = (formData.get("description") as string | null) ?? "";
  const file = formData.get("file") as File | null;

  if (!name || !file) {
    return NextResponse.json({ error: "Missing name or file" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const entry = await addScore(auth.supabase, auth.userId, name, description, buffer);
    return NextResponse.json({ id: entry.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getScoreBuffer } from "@/lib/library";
import { toMusicXml } from "@/lib/mscore";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const result = await getScoreBuffer(auth.supabase, auth.userId, id);

  if (!result) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }

  try {
    const converted = await toMusicXml(result.buffer);
    if (!converted.ok) {
      return NextResponse.json({ error: converted.error }, { status: 500 });
    }
    return NextResponse.json({ musicXml: converted.content, name: result.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

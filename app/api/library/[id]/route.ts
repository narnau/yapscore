import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { deleteScore } from "@/lib/library";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const ok = await deleteScore(auth.supabase, auth.userId, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

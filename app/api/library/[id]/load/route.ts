import { NextRequest, NextResponse } from "next/server";
import { getScorePath, listScores } from "@/lib/library";
import { toMusicXml } from "@/lib/mscore";
import fs from "fs";
import os from "os";
import path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const scorePath = getScorePath(id);
  if (!scorePath) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }

  const scores = listScores();
  const entry = scores.find((s) => s.id === id);
  const name = entry?.name ?? "Untitled";

  const tmpXml = path.join(os.tmpdir(), `score-ai-lib-${Date.now()}.xml`);
  try {
    const result = toMusicXml(scorePath, tmpXml);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ musicXml: result.content, name });
  } finally {
    if (fs.existsSync(tmpXml)) fs.rmSync(tmpXml);
  }
}

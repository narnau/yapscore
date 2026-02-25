import { NextRequest, NextResponse } from "next/server";
import { unzipMscz } from "@/lib/score";
import { toMusicXml } from "@/lib/mscore";
import fs from "fs";
import os from "os";
import path from "path";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "score-ai-load-"));
  const tmpMscz = path.join(os.tmpdir(), `score-ai-load-${Date.now()}.mscz`);
  const tmpXml = tmpMscz.replace(".mscz", ".xml");

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(tmpMscz, buffer);

    const result = toMusicXml(tmpMscz, tmpXml);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ musicXml: result.content });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpMscz, { force: true });
    fs.rmSync(tmpXml, { force: true });
  }
}

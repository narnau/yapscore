import { NextRequest, NextResponse } from "next/server";
import { toMusicXml } from "@/lib/music/mscore";
import { fixPercussionDisplayOctave } from "@/lib/music/musicxml";
import { getAuthUser } from "@/lib/auth";
import AdmZip from "adm-zip";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_EXTENSIONS = [".mscz", ".mxl", ".xml", ".musicxml"];

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  // File size guard — prevent memory exhaustion
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 50 MB)" }, { status: 413 });
  }

  // Extension allowlist — reject anything we don't handle
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    // .mxl is a ZIP archive containing a MusicXML file
    if (name.endsWith(".mxl")) {
      const zip = new AdmZip(buffer);
      // The main score is listed in META-INF/container.xml, but conventionally
      // it's score.xml or the first .xml entry outside META-INF.
      const entry =
        zip.getEntry("score.xml") ??
        zip.getEntries().find((e) => !e.entryName.startsWith("META-INF") && e.entryName.endsWith(".xml"));
      if (!entry) return NextResponse.json({ error: "No XML found inside .mxl" }, { status: 400 });
      const musicXml = entry.getData().toString("utf8");
      return NextResponse.json({ musicXml });
    }

    // .mscz / .xml / .musicxml → MusicXML via mscore CLI
    const result = await toMusicXml(buffer);
    if (!result.ok) {
      console.error("[load] toMusicXml failed:", result.error);
      return NextResponse.json({ error: "Failed to convert file to MusicXML" }, { status: 500 });
    }
    return NextResponse.json({ musicXml: fixPercussionDisplayOctave(result.content) });
  } catch (err) {
    console.error("[load] error:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Failed to process file" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { toMusicXml } from "@/lib/mscore";
import { fixPercussionDisplayOctave } from "@/lib/musicxml";
import { getAuthUser } from "@/lib/auth";
import AdmZip from "adm-zip";

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    // .mxl is a ZIP archive containing a MusicXML file
    if (file.name.toLowerCase().endsWith(".mxl")) {
      const zip = new AdmZip(buffer);
      // The main score is listed in META-INF/container.xml, but conventionally
      // it's score.xml or the first .xml entry outside META-INF.
      const entry =
        zip.getEntry("score.xml") ??
        zip.getEntries().find(
          (e) => !e.entryName.startsWith("META-INF") && e.entryName.endsWith(".xml")
        );
      if (!entry) return NextResponse.json({ error: "No XML found inside .mxl" }, { status: 400 });
      const musicXml = entry.getData().toString("utf8");
      return NextResponse.json({ musicXml });
    }

    // .mscz → MusicXML via mscore CLI
    const result = await toMusicXml(buffer);
    if (!result.ok) {
      console.error("[load] toMusicXml failed:", result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ musicXml: fixPercussionDisplayOctave(result.content) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

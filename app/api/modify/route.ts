import { NextRequest, NextResponse } from "next/server";
import { extractParts, extractSelectedMeasures, reconstructMusicXml, spliceMeasuresBack } from "@/lib/musicxml";
import { modifyXml } from "@/lib/llm";
import { addAccidentals, fixChordSymbols } from "@/lib/accidentals";
import { addBeams } from "@/lib/beams";
import { getAuthUser } from "@/lib/auth";

export const maxDuration = 300;

const MAX_ATTEMPTS = 3;

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const formData = await req.formData();
  const musicXml = formData.get("musicXml") as string | null;
  const instruction = formData.get("instruction") as string | null;
  const selectedRaw = formData.get("selectedMeasures") as string | null;

  if (!musicXml || !instruction) {
    return NextResponse.json({ error: "Missing musicXml or instruction" }, { status: 400 });
  }

  const selectedMeasures = selectedRaw
    ? (JSON.parse(selectedRaw) as number[])
    : null;

  // Decide what to send to the LLM
  let skeleton: string;
  let partsToSend: string;
  let context: string;
  const isPartialEdit = selectedMeasures && selectedMeasures.length > 0;

  try {
    if (isPartialEdit) {
      ({ skeleton, selectedMeasures: partsToSend, context } =
        extractSelectedMeasures(musicXml, selectedMeasures));
      console.log(`[modify] partial edit — measures: ${selectedMeasures.join(", ")}`);
    } else {
      ({ skeleton, parts: partsToSend, context } = extractParts(musicXml));
      console.log(`[modify] full edit`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to parse MusicXML: ${message}` }, { status: 400 });
  }

  console.log(`[modify] context   : ${context}`);
  console.log(`[modify] sending   : ${partsToSend.length} chars (full xml: ${musicXml.length})`);

  let errorMsg: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[modify] attempt ${attempt}/${MAX_ATTEMPTS} — calling LLM...`);
    const t0 = Date.now();

    let modified: string;
    try {
      modified = await modifyXml(partsToSend, context, instruction, errorMsg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `LLM error: ${message}` }, { status: 500 });
    }

    console.log(`[modify] LLM responded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Validate: must contain at least one measure element (unless deleting)
    if (!modified.includes("<measure") && !isPartialEdit) {
      errorMsg = "Response did not contain any <measure> elements";
      console.log(`[modify] validation failed: ${errorMsg}`);
      continue;
    }

    // Reconstruct the full MusicXML
    const result = isPartialEdit
      ? spliceMeasuresBack(musicXml, modified, selectedMeasures ?? undefined)
      : reconstructMusicXml(skeleton, modified);

    console.log(`[modify] success on attempt ${attempt}`);
    return NextResponse.json({ musicXml: addBeams(fixChordSymbols(addAccidentals(result))) });
  }

  return NextResponse.json({ error: `Failed after ${MAX_ATTEMPTS} attempts` }, { status: 422 });
}

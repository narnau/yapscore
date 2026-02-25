import { NextRequest, NextResponse } from "next/server";
import { detectIntent, LibraryItem } from "@/lib/agent";
import { getScorePath, listScores } from "@/lib/library";
import { toMusicXml } from "@/lib/mscore";
import { extractParts, extractSelectedMeasures, reconstructMusicXml, spliceMeasuresBack } from "@/lib/musicxml";
import { modifyXml, generateXml } from "@/lib/llm";
import { addAccidentals } from "@/lib/accidentals";
import fs from "fs";
import os from "os";
import path from "path";

export const maxDuration = 300;

const MAX_ATTEMPTS = 3;

async function loadScoreById(id: string): Promise<{ musicXml: string; name: string } | { error: string }> {
  const scorePath = getScorePath(id);
  if (!scorePath) return { error: `Score with id "${id}" not found in library` };

  const scores = listScores();
  const entry = scores.find((s) => s.id === id);
  const name = entry?.name ?? "Untitled";

  const tmpXml = path.join(os.tmpdir(), `score-ai-agent-${Date.now()}.xml`);
  try {
    const result = toMusicXml(scorePath, tmpXml);
    if (!result.ok) return { error: result.error };
    return { musicXml: result.content, name };
  } finally {
    if (fs.existsSync(tmpXml)) fs.rmSync(tmpXml);
  }
}

async function applyModification(
  musicXml: string,
  instruction: string,
  selectedMeasures: number[] | null
): Promise<{ musicXml: string } | { error: string }> {
  let skeleton: string;
  let partsToSend: string;
  let context: string;
  const isPartialEdit = selectedMeasures && selectedMeasures.length > 0;

  try {
    if (isPartialEdit) {
      ({ skeleton, selectedMeasures: partsToSend, context } = extractSelectedMeasures(musicXml, selectedMeasures));
    } else {
      ({ skeleton, parts: partsToSend, context } = extractParts(musicXml));
    }
  } catch (err) {
    return { error: `Failed to parse MusicXML: ${err instanceof Error ? err.message : String(err)}` };
  }

  let errorMsg: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[agent] modify attempt ${attempt}/${MAX_ATTEMPTS}`);
    let modified: string;
    try {
      modified = await modifyXml(partsToSend, context, instruction, errorMsg);
    } catch (err) {
      return { error: `LLM error: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!modified.includes("<measure")) {
      errorMsg = "Response did not contain any <measure> elements";
      continue;
    }

    const result = isPartialEdit
      ? spliceMeasuresBack(musicXml, modified)
      : reconstructMusicXml(skeleton, modified);

    return { musicXml: addAccidentals(result) };
  }

  return { error: `Failed after ${MAX_ATTEMPTS} attempts` };
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const message = formData.get("message") as string | null;
  const currentMusicXml = formData.get("musicXml") as string | null;
  const selectedRaw = formData.get("selectedMeasures") as string | null;
  const libraryRaw = formData.get("library") as string | null;

  if (!message) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  const selectedMeasures = selectedRaw ? (JSON.parse(selectedRaw) as number[]) : null;
  const library: LibraryItem[] = libraryRaw ? (JSON.parse(libraryRaw) as LibraryItem[]) : [];

  // Step 1: detect intent
  let intent;
  try {
    intent = await detectIntent(message, library, !!currentMusicXml);
  } catch (err) {
    return NextResponse.json(
      { error: `Intent detection failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  console.log(`[agent] intent: ${JSON.stringify(intent)}`);

  // Step 2: execute intent
  if (intent.action === "chat") {
    return NextResponse.json({ type: "chat", message: intent.response });
  }

  if (intent.action === "load") {
    const loaded = await loadScoreById(intent.scoreId);
    if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: 404 });
    return NextResponse.json({ type: "load", musicXml: loaded.musicXml, name: loaded.name });
  }

  if (intent.action === "load_and_modify") {
    const loaded = await loadScoreById(intent.scoreId);
    if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: 404 });

    const modified = await applyModification(loaded.musicXml, intent.instruction, null);
    if ("error" in modified) return NextResponse.json({ error: modified.error }, { status: 422 });

    return NextResponse.json({ type: "load", musicXml: modified.musicXml, name: loaded.name });
  }

  if (intent.action === "generate") {
    console.log(`[agent] generating from scratch: ${intent.description}`);
    let musicXml: string;
    try {
      musicXml = await generateXml(intent.description);
    } catch (err) {
      return NextResponse.json(
        { error: `Generation failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      );
    }

    if (!musicXml.includes("<measure")) {
      return NextResponse.json({ error: "Generated XML has no measures" }, { status: 422 });
    }

    // Extract a short name from the description
    const name = intent.description.split(",")[0].trim();
    return NextResponse.json({ type: "load", musicXml: addAccidentals(musicXml), name });
  }

  if (intent.action === "modify") {
    if (!currentMusicXml) {
      return NextResponse.json({ error: "No score is currently loaded" }, { status: 400 });
    }
    const modified = await applyModification(currentMusicXml, intent.instruction, selectedMeasures);
    if ("error" in modified) return NextResponse.json({ error: modified.error }, { status: 422 });

    return NextResponse.json({ type: "modify", musicXml: modified.musicXml });
  }

  return NextResponse.json({ error: "Unknown intent action" }, { status: 400 });
}

import { NextRequest, NextResponse } from "next/server";
import { getApiKeyUser, checkApiAccess } from "@/lib/apiKeyAuth";
import { runAgent } from "@/lib/agent";
import { setLlmUserId } from "@/lib/llm";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await getApiKeyUser(req);
  if (!auth.ok) return auth.response;

  const access = await checkApiAccess(auth.userId);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));
  const prompt   = typeof body.prompt   === "string" ? body.prompt.trim()   : "";
  const musicxml = typeof body.musicxml === "string" ? body.musicxml        : null;

  if (!prompt)   return NextResponse.json({ error: "prompt is required" },   { status: 400 });
  if (!musicxml) return NextResponse.json({ error: "musicxml is required" }, { status: 400 });

  try {
    setLlmUserId(auth.userId);
    const result = await runAgent(prompt, musicxml, null, []);

    if (result.type === "modify" || result.type === "load") {
      return NextResponse.json({ musicxml: result.musicXml });
    }
    if (result.type === "chat") {
      return NextResponse.json({ musicxml, message: result.message });
    }

    return NextResponse.json({ error: "Unexpected result" }, { status: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[v1/modify] error:", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    setLlmUserId(null);
  }
}

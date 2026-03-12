import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiKeyUser, checkApiAccess } from "@/lib/auth/api-key";
import { runAgent } from "@/lib/agent";
import { setLlmUserId } from "@/lib/agent/llm";

export const maxDuration = 300;

const modifySchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  musicxml: z.string().min(1, "musicxml is required"),
  selectedMeasures: z.array(z.number()).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await getApiKeyUser(req);
  if (!auth.ok) return auth.response;

  const access = await checkApiAccess(auth.userId);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));
  const parsed = modifySchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid request";
    return NextResponse.json({ error: firstError }, { status: 400 });
  }

  const { prompt, musicxml } = parsed.data;

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

import { NextRequest, NextResponse } from "next/server";
import { getApiKeyUser } from "@/lib/apiKeyAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAgent } from "@/lib/agent";
import { setLlmUserId } from "@/lib/llm";

export const maxDuration = 300;

const FREE_LIMIT = 5;

export async function POST(req: NextRequest) {
  const auth = await getApiKeyUser(req);
  if (!auth.ok) return auth.response;

  // Check usage limits
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, interactions_used")
    .eq("id", auth.userId)
    .single();

  const plan = profile?.plan ?? "free";
  const used = profile?.interactions_used ?? 0;

  if (plan === "free" && used >= FREE_LIMIT) {
    return NextResponse.json(
      { error: "limit_reached", usage: { used, limit: FREE_LIMIT } },
      { status: 402 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  try {
    setLlmUserId(auth.userId);
    const result = await runAgent(prompt, null, null, []);

    await admin.rpc("increment_interactions", { user_id: auth.userId });

    if (result.type === "modify" || result.type === "load") {
      return NextResponse.json({ musicxml: result.musicXml, message: (result as { message?: string }).message ?? "" });
    }

    if (result.type === "chat") {
      return NextResponse.json({ musicxml: null, message: result.message });
    }

    return NextResponse.json({ error: "Unexpected result" }, { status: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[v1/generate] error:", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    setLlmUserId(null);
  }
}

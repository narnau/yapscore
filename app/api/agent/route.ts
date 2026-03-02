import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const FREE_LIMIT = 5;

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
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

  const formData = await req.formData();
  const message = formData.get("message") as string | null;
  const currentMusicXml = formData.get("musicXml") as string | null;
  const selectedRaw = formData.get("selectedMeasures") as string | null;

  if (!message) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  const selectedMeasures = selectedRaw ? (JSON.parse(selectedRaw) as number[]) : null;

  const historyRaw = formData.get("history") as string | null;
  const history: { role: "user" | "assistant"; content: string }[] = historyRaw
    ? JSON.parse(historyRaw)
    : [];

  try {
    const result = await runAgent(message, currentMusicXml, selectedMeasures, history);

    await admin.rpc("increment_interactions", { user_id: auth.userId });

    if (result.type === "chat")   return NextResponse.json({ type: "chat",   message: result.message });
    if (result.type === "load")   return NextResponse.json({ type: "load",   musicXml: result.musicXml, name: result.name });
    if (result.type === "modify") return NextResponse.json({ type: "modify", musicXml: result.musicXml, message: result.message });

    return NextResponse.json({ error: "Unknown result type" }, { status: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[agent] fatal error:", msg);
    // Never surface raw errors to the user — return as a chat message
    return NextResponse.json({
      type: "chat",
      message: "Sorry, something went wrong. Please try again.",
    });
  }
}

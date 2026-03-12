import { NextRequest, NextResponse, after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { runAgent } from "@/lib/agent";
import { getAuthUser } from "@/lib/auth";
import { setLlmUserId } from "@/lib/agent/llm";
import { logger } from "@/lib/telemetry/logger";
import { createRateLimiter } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { checkUsageLimit } from "@/lib/services/usage";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const rateLimiter = createRateLimiter(RATE_LIMITS.AGENT);

const agentSchema = z.object({
  message: z.string().min(1, "Missing message").max(2_000, "Message too long (max 2000 chars)"),
  currentMusicXml: z.string().max(500_000, "Score too large").optional().nullable(),
  selectedMeasures: z.array(z.number()).optional().nullable(),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })).optional().nullable(),
  scoreName: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  // Burst rate limit check
  if (!rateLimiter.check(auth.userId)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  // Check usage limits
  const usage = await checkUsageLimit(auth.userId);
  if (!usage.allowed) {
    return NextResponse.json(usage.errorResponse.body, { status: usage.errorResponse.status });
  }

  const formData = await req.formData();

  // Safe JSON parsing for structured fields
  let selectedMeasures: number[] | null = null;
  const selectedRaw = formData.get("selectedMeasures") as string | null;
  if (selectedRaw) {
    try {
      selectedMeasures = JSON.parse(selectedRaw) as number[];
    } catch {
      // fall through — will be validated by Zod below
    }
  }

  let history: { role: "user" | "assistant"; content: string }[] = [];
  const historyRaw = formData.get("history") as string | null;
  if (historyRaw) {
    try {
      history = JSON.parse(historyRaw);
    } catch {
      history = []; // non-critical — degrade gracefully without crashing
    }
  }

  const parsed = agentSchema.safeParse({
    message: formData.get("message"),
    currentMusicXml: formData.get("musicXml") as string | null,
    selectedMeasures,
    history,
    scoreName: formData.get("scoreName") as string | null,
  });

  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid request";
    return NextResponse.json({ error: firstError }, { status: 400 });
  }

  const { message, currentMusicXml } = parsed.data;

  try {
    setLlmUserId(auth.userId);
    const result = await runAgent(message, currentMusicXml ?? null, selectedMeasures, history, auth.userId);

    await createAdminClient().rpc("increment_interactions", { user_id: auth.userId });

    after(() => logger.flush());

    if (result.type === "chat")   return NextResponse.json({ type: "chat",   message: result.message });
    if (result.type === "load")   return NextResponse.json({ type: "load",   musicXml: result.musicXml, name: result.name });
    if (result.type === "modify") return NextResponse.json({ type: "modify", musicXml: result.musicXml, message: result.message });

    return NextResponse.json({ error: "Unknown result type" }, { status: 500 });
  } catch (err) {
    Sentry.captureException(err, { extra: { userId: auth.userId } });
    logger.error("agent.error", { userId: auth.userId, error: err instanceof Error ? err.message : String(err) });
    after(() => logger.flush());
    return NextResponse.json({
      type: "chat",
      message: "Sorry, something went wrong. Please try again.",
    });
  } finally {
    setLlmUserId(null);
  }
}

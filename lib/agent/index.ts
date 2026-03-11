import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { logger } from "@/lib/logger";
import { extractParts, extractSelectedMeasures, extractChordMap } from "@/lib/music/musicxml";
import { createTools } from "./tools";
import { buildSystemPrompt } from "./system-prompt";
import type { AgentContext, ScoreCapture } from "./types";

export type { AgentResult } from "./types";

const MAX_AGENT_ATTEMPTS = 2;
const MAX_TOOL_STEPS = 15;

export async function runAgent(
  message: string,
  currentMusicXml: string | null,
  selectedMeasures: number[] | null,
  history: { role: "user" | "assistant"; content: string }[] = [],
  userId?: string
): Promise<import("./types").AgentResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
  const modelName = (process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-preview").trim();
  const fallbackModelName = "openai/gpt-4.1-mini";

  // If measures are selected, only show those measures to the model
  const currentScoreCtx = (() => {
    if (!currentMusicXml) return "none";
    if (selectedMeasures && selectedMeasures.length > 0) {
      try {
        const { selectedMeasures: xml } = extractSelectedMeasures(currentMusicXml, selectedMeasures);
        return xml;
      } catch { return currentMusicXml; }
    }
    return currentMusicXml;
  })();

  const selectionCtx =
    selectedMeasures && selectedMeasures.length > 0
      ? `\nSelected measures: ${selectedMeasures.join(", ")}`
      : "";

  // Extract chord symbols already in the score and present them as a clean
  // table so the LLM doesn't have to parse them out of raw MusicXML.
  const chordMap = currentMusicXml ? extractChordMap(currentMusicXml) : "";
  const chordCtx = chordMap ? `\nChord map: ${chordMap}` : "";

  // Truncate message in logs to avoid leaking sensitive user content
  const msgPreview = message.length > 120 ? message.slice(0, 120) + "…" : message;
  console.log("╔══════════════════════════════════════════════════════════════");
  console.log(`║ [agent] model   : ${modelName}`);
  console.log(`║ [agent] message : ${msgPreview}`);
  const logCtx = currentMusicXml
    ? (() => { try { return extractParts(currentMusicXml).context; } catch { return "loaded"; } })()
    : "none";
  console.log(`║ [agent] score   : ${logCtx}`);
  if (selectionCtx) console.log(`║ [agent]${selectionCtx}`);
  console.log("╚══════════════════════════════════════════════════════════════");

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_AGENT_ATTEMPTS; attempt++) {
    // Reset capture on each attempt
    const capture: { result: ScoreCapture | null } = { result: null };
    // liveXml tracks the current XML within this attempt — updated by createScore so
    // subsequent tools in the same multi-step turn can use the freshly created score.
    const ctx: AgentContext = { liveXml: currentMusicXml, capture };
    const attemptModelName = attempt === 1 ? modelName : fallbackModelName;
    const model = openrouter(attemptModelName);
    if (attempt > 1) console.log(`│ [agent] retrying (attempt ${attempt}/${MAX_AGENT_ATTEMPTS}) with ${attemptModelName}…`);

    try {
  const { text } = await generateText({
    model,
    maxSteps: MAX_TOOL_STEPS,
    experimental_telemetry: {
      isEnabled: true,
      metadata: { posthogDistinctId: userId ?? "anonymous" },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onStepFinish({ stepType, toolCalls, toolResults, finishReason, usage, text: stepText }: any) {
      console.log("┌──────────────────────────────────────────────────────────────");
      console.log(`│ [agent] step        : ${stepType}  finish: ${finishReason}`);
      if (usage) {
        console.log(`│ [agent] tokens      : in=${usage.promptTokens}  out=${usage.completionTokens}  total=${usage.totalTokens}`);
      }
      for (const tc of toolCalls ?? []) {
        console.log(`│ [agent] tool call   : ${tc.toolName}`);
        console.log(`│          args       : ${JSON.stringify(tc.args)}`);
      }
      for (const tr of toolResults ?? []) {
        console.log(`│ [agent] tool result : ${tr.toolName} → ${JSON.stringify(tr.result)}`);
      }
      if (stepText) {
        console.log(`│ [agent] text        : ${stepText.slice(0, 200)}${stepText.length > 200 ? "…" : ""}`);
      }
      console.log("└──────────────────────────────────────────────────────────────");

      logger.info("agent.step", {
        userId,
        model: modelName,
        stepType,
        finishReason,
        inputTokens:  usage?.promptTokens,
        outputTokens: usage?.completionTokens,
        totalTokens:  usage?.totalTokens,
        tools: (toolCalls ?? []).map((tc: any) => tc.toolName).join(",") || undefined,
        text: stepText ? stepText.slice(0, 200) : undefined,
      });
    },
    system: buildSystemPrompt(currentScoreCtx, selectionCtx, chordCtx),
    messages: [...history, { role: "user" as const, content: message }],
    tools: createTools(ctx, selectedMeasures),
  });

      const r = capture.result;
      if (r) {
        const resultType = r.resultType === "modify" ? "modify" : `load (${r.name})`;
        console.log(`╔══ [agent] result: ${resultType}  xml=${r.musicXml.length} chars`);
        if (r.resultType === "modify") return { type: "modify", musicXml: r.musicXml, message: text || "Score updated." };
        return { type: "load", musicXml: r.musicXml, name: r.name! };
      }

      if (!text.trim()) throw new Error("Empty response from model");

      console.log(`╔══ [agent] result: chat — "${text.slice(0, 120)}${text.length > 120 ? "…" : ""}"`);
      return { type: "chat", message: text };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`│ [agent] ⚠ attempt ${attempt} failed: ${msg}`);
      lastError = err;
      // Retry on tool-name errors or tool argument validation errors (LLM can self-correct)
      const isRetryable =
        msg.includes("unavailable tool") ||
        msg.includes("No such tool") ||
        msg.includes("Invalid arguments for tool") ||
        msg.includes("Type validation failed") ||
        msg.includes("Invalid JSON") ||
        msg.includes("Empty response from model");
      if (!isRetryable) break;
    }
  }

  throw lastError;
}

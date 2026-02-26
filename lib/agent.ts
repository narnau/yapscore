import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { getScoreBuffer } from "./library";
import { toMusicXml } from "./mscore";
import {
  extractParts,
  extractSelectedMeasures,
  reconstructMusicXml,
  spliceMeasuresBack,
  deleteMeasures,
  clearMeasures,
  insertEmptyMeasures,
  duplicateMeasures,
  transposeMeasures,
  repeatSection,
} from "./musicxml";
import { modifyXml, generateXml } from "./llm";
import { addAccidentals, fixChordSymbols } from "./accidentals";
import { addBeams } from "./beams";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LibraryItem = { id: string; name: string; description: string };

export type AgentResult =
  | { type: "load";   musicXml: string; name: string }
  | { type: "modify"; musicXml: string }
  | { type: "chat";   message: string };

// ─── helpers ─────────────────────────────────────────────────────────────────

async function loadScoreById(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<{ musicXml: string; name: string }> {
  const scoreData = await getScoreBuffer(supabase, userId, id);
  if (!scoreData) throw new Error(`Score "${id}" not found in library`);

  const result = await toMusicXml(scoreData.buffer);
  if (!result.ok) throw new Error(result.error);
  return { musicXml: result.content, name: scoreData.name };
}

const MAX_ATTEMPTS = 3;

async function applyModification(
  musicXml: string,
  instruction: string,
  selectedMeasures: number[] | null
): Promise<string> {
  const isPartialEdit = selectedMeasures && selectedMeasures.length > 0;

  let skeleton: string;
  let partsToSend: string;
  let context: string;

  if (isPartialEdit) {
    ({ skeleton, selectedMeasures: partsToSend, context } =
      extractSelectedMeasures(musicXml, selectedMeasures));
  } else {
    ({ skeleton, parts: partsToSend, context } = extractParts(musicXml));
  }

  let errorMsg: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[agent] modify attempt ${attempt}/${MAX_ATTEMPTS}`);
    const modified = await modifyXml(partsToSend, context, instruction, errorMsg);

    // For deletions: LLM returns no measures — that's valid if we sent specific measures
    if (!modified.includes("<measure") && !isPartialEdit) {
      errorMsg = "Response did not contain any <measure> elements";
      continue;
    }

    const result = isPartialEdit
      ? spliceMeasuresBack(musicXml, modified, selectedMeasures)
      : reconstructMusicXml(skeleton, modified);

    // Sanity-check: the result must still contain <part> elements
    if (!result.includes("<part ") && !result.includes("<part>")) {
      errorMsg = "Reconstruction produced XML with no <part> elements";
      continue;
    }

    return addBeams(fixChordSymbols(addAccidentals(result)));
  }

  throw new Error(`Modification failed after ${MAX_ATTEMPTS} attempts`);
}

// ─── agent ───────────────────────────────────────────────────────────────────

export async function runAgent(
  message: string,
  library: LibraryItem[],
  currentMusicXml: string | null,
  selectedMeasures: number[] | null,
  supabase: SupabaseClient,
  userId: string
): Promise<AgentResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-preview";

  const libraryText =
    library.length > 0
      ? library.map((s) => `- "${s.name}" (id: ${s.id}): ${s.description}`).join("\n")
      : "(empty — no scores stored yet)";

  const currentScoreCtx = currentMusicXml
    ? (() => { try { return extractParts(currentMusicXml).context; } catch { return "loaded"; } })()
    : "none";

  const selectionCtx =
    selectedMeasures && selectedMeasures.length > 0
      ? `\nSelected measures: ${selectedMeasures.join(", ")}`
      : "";

  // Capture the tool result so we can return it after generateText resolves.
  // Wrapped in an object so TypeScript tracks mutations inside async closures.
  type ScoreCapture = { musicXml: string; name?: string; resultType: "load" | "modify" };
  const capture: { result: ScoreCapture | null } = { result: null };

  const { text } = await generateText({
    model: openrouter(model),
    maxSteps: 3,
    system: `You are a music score editor assistant. Use the available tools to fulfil the user's request.

Library scores:
${libraryText}

Current score: ${currentScoreCtx}${selectionCtx}

Rules:
- Match library scores fuzzily — partial names, typos, and different languages all count.
- If a library score needs adaptation for a different instrument, use loadAndModifyScore with a transposition instruction.
- If the song is not in the library but is a well-known melody, use generateScore.
- If a score is already loaded and the user asks for changes, use modifyCurrentScore.
- Prefer taking action over chatting.`,
    messages: [{ role: "user", content: message }],
    tools: {
      loadScore: {
        description:
          "Load a score from the library as-is, without any modification.",
        parameters: z.object({
          id: z.string().describe("Score ID from the library"),
        }),
        execute: async ({ id }) => {
          const loaded = await loadScoreById(supabase, userId, id);
          capture.result = { musicXml: loaded.musicXml, name: loaded.name, resultType: "load" };
          return { ok: true, name: loaded.name };
        },
      },

      loadAndModifyScore: {
        description:
          "Load a library score and immediately apply a modification " +
          "(e.g. transpose for a different instrument, extract melody, change key).",
        parameters: z.object({
          id: z.string().describe("Score ID from the library"),
          instruction: z.string().describe(
            "Detailed modification instruction in English. " +
            "Include transposition intervals if changing instrument."
          ),
        }),
        execute: async ({ id, instruction }) => {
          const loaded = await loadScoreById(supabase, userId, id);
          const modified = await applyModification(loaded.musicXml, instruction, null);
          capture.result = { musicXml: modified, name: loaded.name, resultType: "load" };
          return { ok: true, name: loaded.name };
        },
      },

      modifyCurrentScore: {
        description:
          "Apply a modification to the currently loaded score. " +
          "Only use when a score is already open.",
        parameters: z.object({
          instruction: z.string().describe("Detailed modification instruction in English."),
        }),
        execute: async ({ instruction }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const modified = await applyModification(
            currentMusicXml,
            instruction,
            selectedMeasures
          );
          capture.result = { musicXml: modified, resultType: "modify" };
          return { ok: true };
        },
      },

      generateScore: {
        description:
          "Generate a new score from musical knowledge. " +
          "Use when the user asks for a well-known song or melody that is NOT in the library.",
        parameters: z.object({
          description: z.string().describe(
            "What to generate: song title, instrument, key, time signature, style."
          ),
        }),
        execute: async ({ description }) => {
          const musicXml = await generateXml(description);
          const name = description.split(",")[0].trim();
          capture.result = {
            musicXml: addBeams(fixChordSymbols(addAccidentals(musicXml))),
            name,
            resultType: "load",
          };
          return { ok: true, name };
        },
      },

      deleteMeasures: {
        description:
          "Delete (remove) measures from the score entirely. The score gets shorter " +
          "and remaining measures are renumbered. Use when the user says 'delete', " +
          "'remove', or 'cut' measures.",
        parameters: z.object({
          measureNumbers: z.array(z.number()).describe(
            "Measure numbers to delete. Use the selected measures if the user says " +
            "'this measure' or 'these measures'."
          ),
        }),
        execute: async ({ measureNumbers }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = deleteMeasures(currentMusicXml, measureNumbers);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, deleted: measureNumbers };
        },
      },

      clearMeasures: {
        description:
          "Clear the content of measures, replacing all notes with rests. The measures " +
          "stay in the score (same length) but become empty. Use when the user says " +
          "'clear', 'empty', or 'blank out' measures.",
        parameters: z.object({
          measureNumbers: z.array(z.number()).describe(
            "Measure numbers to clear. Use the selected measures if the user says " +
            "'this measure' or 'these measures'."
          ),
        }),
        execute: async ({ measureNumbers }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = clearMeasures(currentMusicXml, measureNumbers);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, cleared: measureNumbers };
        },
      },

      insertEmptyMeasures: {
        description:
          "Insert empty measures (whole rests) into the score. Use when the user says " +
          "'add measures', 'insert bars', 'add empty bars', etc.",
        parameters: z.object({
          afterMeasure: z.number().describe(
            "Insert after this measure number. Use 0 to insert at the beginning. " +
            "Use the last measure number to append at the end."
          ),
          count: z.number().min(1).describe("Number of empty measures to insert"),
        }),
        execute: async ({ afterMeasure, count }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = insertEmptyMeasures(currentMusicXml, afterMeasure, count);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, inserted: count, after: afterMeasure };
        },
      },

      duplicateMeasures: {
        description:
          "Duplicate (copy) measures and insert the copies right after the originals. " +
          "Use when the user says 'duplicate', 'copy', or 'repeat these measures'.",
        parameters: z.object({
          measureNumbers: z.array(z.number()).describe(
            "Measure numbers to duplicate. Use the selected measures if applicable."
          ),
        }),
        execute: async ({ measureNumbers }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = duplicateMeasures(currentMusicXml, measureNumbers);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, duplicated: measureNumbers };
        },
      },

      transposeMeasures: {
        description:
          "Transpose notes up or down by a number of semitones. Use for key changes, " +
          "instrument transposition, or interval shifts. Common intervals: " +
          "minor 2nd=1, major 2nd=2, minor 3rd=3, major 3rd=4, perfect 4th=5, " +
          "tritone=6, perfect 5th=7, minor 6th=8, major 6th=9, minor 7th=10, " +
          "major 7th=11, octave=12.",
        parameters: z.object({
          semitones: z.number().describe(
            "Number of semitones to transpose. Positive = up, negative = down."
          ),
          allMeasures: z.boolean().describe(
            "Set to true to transpose the entire score."
          ),
          measureNumbers: z.array(z.number()).optional().describe(
            "Specific measures to transpose. Omit (or leave empty) when allMeasures is true."
          ),
        }),
        execute: async ({ semitones, allMeasures, measureNumbers }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const measures = allMeasures ? null : (measureNumbers ?? null);
          const result = transposeMeasures(currentMusicXml, measures, semitones);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, semitones, measures: measureNumbers ?? "all" };
        },
      },

      repeatSection: {
        description:
          "Repeat a range of measures by duplicating them N additional times after " +
          "the range. E.g., repeat measures 2-4 twice = measures 2-4 appear 3 times total. " +
          "Use when the user says 'repeat this section N times'.",
        parameters: z.object({
          startMeasure: z.number().describe("First measure of the section"),
          endMeasure: z.number().describe("Last measure of the section"),
          times: z.number().min(1).describe("How many additional copies to append"),
        }),
        execute: async ({ startMeasure, endMeasure, times }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = repeatSection(currentMusicXml, startMeasure, endMeasure, times);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, repeated: `${startMeasure}-${endMeasure}`, times };
        },
      },
    },
  });

  const r = capture.result;
  if (r) {
    if (r.resultType === "modify") return { type: "modify", musicXml: r.musicXml };
    return { type: "load", musicXml: r.musicXml, name: r.name! };
  }

  return { type: "chat", message: text };
}

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
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
  setTempo,
  getTempo,
  addDynamics,
  addArticulations,
  addRepeatBarlines,
  addVoltaBrackets,
  addHairpin,
  changeKey,
  scaleNoteDurations,
  addTextAnnotation,
  setMeasureNotes,
  setTimeSignature,
} from "./musicxml";
import type { DynamicMarking, ArticulationMarking, NoteSpec } from "./musicxml";
import { modifyXml, generateXml } from "./llm";
import { addAccidentals, fixChordSymbols } from "./accidentals";
import { addBeams } from "./beams";

export type AgentResult =
  | { type: "load";   musicXml: string; name: string }
  | { type: "modify"; musicXml: string }
  | { type: "chat";   message: string };

// ─── helpers ─────────────────────────────────────────────────────────────────

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

    if (!modified.includes("<measure") && !isPartialEdit) {
      errorMsg = "Response did not contain any <measure> elements";
      continue;
    }

    const result = isPartialEdit
      ? spliceMeasuresBack(musicXml, modified, selectedMeasures)
      : reconstructMusicXml(skeleton, modified);

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
  currentMusicXml: string | null,
  selectedMeasures: number[] | null
): Promise<AgentResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-preview";

  const currentScoreCtx = currentMusicXml
    ? (() => { try { return extractParts(currentMusicXml).context; } catch { return "loaded"; } })()
    : "none";

  const selectionCtx =
    selectedMeasures && selectedMeasures.length > 0
      ? `\nSelected measures: ${selectedMeasures.join(", ")}`
      : "";

  type ScoreCapture = { musicXml: string; name?: string; resultType: "load" | "modify" };

  console.log("╔══════════════════════════════════════════════════════════════");
  console.log(`║ [agent] model   : ${model}`);
  console.log(`║ [agent] message : ${message}`);
  console.log(`║ [agent] score   : ${currentScoreCtx}`);
  if (selectionCtx) console.log(`║ [agent]${selectionCtx}`);
  console.log("╚══════════════════════════════════════════════════════════════");

  const MAX_AGENT_ATTEMPTS = 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_AGENT_ATTEMPTS; attempt++) {
    // Reset capture on each attempt
    const capture: { result: ScoreCapture | null } = { result: null };
    if (attempt > 1) console.log(`│ [agent] retrying (attempt ${attempt}/${MAX_AGENT_ATTEMPTS})…`);

    try {
  const { text } = await generateText({
    model: openrouter(model),
    maxSteps: 3,
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
    },
    system: `You are a music score editor assistant. Use the available tools to fulfil the user's request.

Current score: ${currentScoreCtx}${selectionCtx}

Rules:
- If the user asks for a well-known song or melody, use generateScore.
- If a score is already loaded and the user asks for changes, use the appropriate tool.
- For composing, reharmonizing, writing melodies, adding bass lines, or any note-level changes, use writeNotes (one call per measure). This is faster and more reliable than modifyCurrentScore.
- Only use modifyCurrentScore for complex structural changes that cannot be expressed as note sequences.
- Prefer taking action over chatting.`,
    messages: [{ role: "user", content: message }],
    tools: {
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
          "Use when the user asks for a well-known song or melody, or asks to create something new.",
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
          allMeasures: z.boolean().describe("Set to true to transpose the entire score."),
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

      setTempo: {
        description:
          "Set or change the tempo (BPM) of the score. Use when the user says " +
          "'set tempo to 120', 'make it faster/slower', 'change speed', etc. " +
          "Common tempos: Largo=50, Adagio=70, Andante=90, Moderato=110, " +
          "Allegro=130, Vivace=160, Presto=180.",
        parameters: z.object({
          bpm: z.number().min(20).max(300).describe(
            "Beats per minute. Use the current tempo context to adjust relatively " +
            "(e.g., 'faster' = +20 BPM from current)."
          ),
          beatUnit: z.string().optional().describe(
            "Note value for the beat: 'quarter' (default), 'half', 'eighth', 'whole'. " +
            "Only change if the user explicitly requests a different beat unit."
          ),
        }),
        execute: async ({ bpm, beatUnit }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const currentTempo = getTempo(currentMusicXml);
          const result = setTempo(currentMusicXml, bpm, beatUnit ?? "quarter");
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, bpm, previous: currentTempo?.bpm ?? "none" };
        },
      },

      addDynamics: {
        description:
          "Add a dynamic marking to measures. Use when the user says " +
          "'make it louder', 'piano', 'fortissimo', 'add forte', 'pp', 'mf', etc.",
        parameters: z.object({
          measureNumbers: z.array(z.number()).describe(
            "Measure numbers to add the dynamic to. Use selected measures if applicable."
          ),
          dynamic: z.enum(["pp", "p", "mp", "mf", "f", "ff", "fp", "sfz"] as const).describe(
            "The dynamic marking to add."
          ),
        }),
        execute: async ({ measureNumbers, dynamic }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = addDynamics(currentMusicXml, measureNumbers, dynamic as DynamicMarking);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, dynamic, measures: measureNumbers };
        },
      },

      addArticulations: {
        description:
          "Add articulation markings to all notes in measures. Use when the user says " +
          "'staccato', 'accent', 'tenuto', 'marcato', 'staccatissimo', " +
          "'make it short/detached', 'add accents'.",
        parameters: z.object({
          measureNumbers: z.array(z.number()).describe(
            "Measure numbers to add articulations to. Use selected measures if applicable."
          ),
          articulation: z.enum(["staccato", "accent", "tenuto", "marcato", "staccatissimo"] as const).describe(
            "The articulation to add to each note."
          ),
        }),
        execute: async ({ measureNumbers, articulation }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = addArticulations(currentMusicXml, measureNumbers, articulation as ArticulationMarking);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, articulation, measures: measureNumbers };
        },
      },

      addRepeatBarlines: {
        description:
          "Add repeat barlines around a section. Creates a forward repeat at the " +
          "start and backward repeat at the end. Use when the user says 'add repeat signs', " +
          "'add repeat barlines', 'make this section repeat'.",
        parameters: z.object({
          startMeasure: z.number().describe("First measure of the repeat section"),
          endMeasure: z.number().describe("Last measure of the repeat section"),
        }),
        execute: async ({ startMeasure, endMeasure }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = addRepeatBarlines(currentMusicXml, startMeasure, endMeasure);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, section: `${startMeasure}-${endMeasure}` };
        },
      },

      addVoltaBrackets: {
        description:
          "Add 1st and 2nd ending (volta) brackets to measures. Use when the user says " +
          "'add first and second endings', 'add volta brackets', '1st/2nd time bars'.",
        parameters: z.object({
          firstEndingMeasures: z.array(z.number()).describe("Measure numbers for the 1st ending."),
          secondEndingMeasures: z.array(z.number()).describe("Measure numbers for the 2nd ending."),
        }),
        execute: async ({ firstEndingMeasures, secondEndingMeasures }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = addVoltaBrackets(currentMusicXml, firstEndingMeasures, secondEndingMeasures);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, firstEnding: firstEndingMeasures, secondEnding: secondEndingMeasures };
        },
      },

      addHairpin: {
        description:
          "Add a crescendo or diminuendo hairpin spanning measures. Use when the user says " +
          "'crescendo', 'decrescendo', 'diminuendo', 'get louder', 'get softer', " +
          "'gradually increase/decrease volume'.",
        parameters: z.object({
          startMeasure: z.number().describe("Measure where the hairpin starts"),
          endMeasure: z.number().describe("Measure where the hairpin ends"),
          type: z.enum(["crescendo", "diminuendo"] as const).describe(
            "Type of hairpin: crescendo (getting louder) or diminuendo (getting softer)."
          ),
        }),
        execute: async ({ startMeasure, endMeasure, type }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = addHairpin(currentMusicXml, startMeasure, endMeasure, type);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, type, section: `${startMeasure}-${endMeasure}` };
        },
      },

      changeKey: {
        description:
          "Change the key signature of the score and transpose notes to match. " +
          "Use when the user says 'change key to G major', 'transpose to D minor', " +
          "'change to a different key'. Common keys: C major, G major, D major, " +
          "A major, F major, Bb major, Eb major, A minor, E minor, D minor.",
        parameters: z.object({
          key: z.string().describe(
            "Target key name, e.g. 'G major', 'D minor', 'Bb major', 'F# minor'."
          ),
          fromMeasure: z.number().optional().describe(
            "Start the key change from this measure. Omit to change the whole score."
          ),
        }),
        execute: async ({ key, fromMeasure }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const KEY_MAP: Record<string, number> = {
            "Cb major": -7, "Gb major": -6, "Db major": -5, "Ab major": -4,
            "Eb major": -3, "Bb major": -2, "F major": -1, "C major": 0,
            "G major": 1,  "D major": 2,   "A major": 3,   "E major": 4,
            "B major": 5,  "F# major": 6,  "C# major": 7,
            "Ab minor": -7, "Eb minor": -6, "Bb minor": -5, "F minor": -4,
            "C minor": -3,  "G minor": -2,  "D minor": -1,  "A minor": 0,
            "E minor": 1,   "B minor": 2,   "F# minor": 3,  "C# minor": 4,
            "G# minor": 5,  "D# minor": 6,  "A# minor": 7,
          };
          const fifths = KEY_MAP[key];
          if (fifths === undefined) throw new Error(`Unknown key: ${key}`);
          const result = changeKey(currentMusicXml, fifths, fromMeasure);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, key, fromMeasure: fromMeasure ?? "all" };
        },
      },

      scaleNoteDurations: {
        description:
          "Double or halve all note durations in measures (augmentation/diminution). " +
          "Use when the user says 'double the note lengths', 'halve the durations', " +
          "'augmentation', 'diminution', 'make notes longer/shorter'.",
        parameters: z.object({
          measureNumbers: z.array(z.number()).describe(
            "Measure numbers to scale. Use selected measures if applicable."
          ),
          factor: z.enum(["double", "halve"] as const).describe(
            "Whether to double or halve the durations."
          ),
        }),
        execute: async ({ measureNumbers, factor }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const numericFactor = factor === "double" ? 2 : 0.5;
          const result = scaleNoteDurations(currentMusicXml, measureNumbers, numericFactor);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, factor, measures: measureNumbers };
        },
      },

      addTextAnnotation: {
        description:
          "Add a text expression or rehearsal mark at a measure. Use when the user says " +
          "'add text', 'mark as', 'add rehearsal mark', 'label this section', " +
          "'add expression marking', 'dolce', 'con fuoco', 'add letter A/B/C'.",
        parameters: z.object({
          measureNumber: z.number().describe("Measure number to add the annotation to."),
          text: z.string().describe("The text content to display."),
          type: z.enum(["text", "rehearsal"] as const).describe(
            "Type: 'text' for expression text (italic), 'rehearsal' for rehearsal marks (boxed)."
          ),
        }),
        execute: async ({ measureNumber, text, type }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = addTextAnnotation(currentMusicXml, measureNumber, text, type);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, text, type, measure: measureNumber };
        },
      },

      writeNotes: {
        description:
          "Write specific notes into a measure of a specific part. Use for composing melodies, " +
          "writing chords, reharmonizing, adding bass lines, or any note-level changes. " +
          "Call once per measure. Each note specifies step, octave, duration, and optional " +
          "accidental (alter) or chord flag. Use rest: true for rests. " +
          "Durations: whole, half, quarter, eighth, 16th, dotted-whole, dotted-half, " +
          "dotted-quarter, dotted-eighth. For chords, set chord: true on the 2nd+ notes.",
        parameters: z.object({
          measureNumber: z.number().describe("Measure number to write notes into."),
          partId: z.string().optional().describe(
            "Part ID to target (e.g. 'P1', 'P2'). Defaults to 'P1'."
          ),
          notes: z.array(z.object({
            step: z.enum(["C", "D", "E", "F", "G", "A", "B"] as const).optional()
              .describe("Note name (required for pitched notes, omit for rests)."),
            octave: z.number().optional().describe("Octave number (default 4)."),
            alter: z.number().optional().describe("-1 for flat, 1 for sharp, 0 or omit for natural."),
            duration: z.enum([
              "whole", "half", "quarter", "eighth", "16th",
              "dotted-whole", "dotted-half", "dotted-quarter", "dotted-eighth",
            ] as const).describe("Note duration."),
            chord: z.boolean().optional().describe("True if this note is simultaneous with the previous note (chord)."),
            rest: z.boolean().optional().describe("True for a rest (omit step/octave)."),
          })).describe("Array of notes to write into the measure, in order."),
        }),
        execute: async ({ measureNumber, partId, notes }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = setMeasureNotes(currentMusicXml, measureNumber, notes as NoteSpec[], partId ?? "P1");
          const postProcessed = addBeams(fixChordSymbols(addAccidentals(result)));
          capture.result = { musicXml: postProcessed, resultType: "modify" };
          return { ok: true, measure: measureNumber, partId: partId ?? "P1", noteCount: notes.length };
        },
      },

      setTimeSignature: {
        description:
          "Change the time signature of the score. Use when the user says " +
          "'change to 3/4', 'set time signature to 6/8', 'waltz time', " +
          "'change meter', 'switch to compound time', etc.",
        parameters: z.object({
          beats: z.number().describe("Number of beats (numerator). E.g. 3 for 3/4, 6 for 6/8."),
          beatType: z.number().describe("Beat type (denominator). E.g. 4 for 3/4, 8 for 6/8."),
          fromMeasure: z.number().optional().describe(
            "Change from this measure onward. Omit to change the whole score."
          ),
        }),
        execute: async ({ beats, beatType, fromMeasure }) => {
          if (!currentMusicXml) throw new Error("No score is currently loaded");
          const result = setTimeSignature(currentMusicXml, beats, beatType, fromMeasure ?? 1);
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, timeSignature: `${beats}/${beatType}`, fromMeasure: fromMeasure ?? "all" };
        },
      },
    },
  });

      const r = capture.result;
      if (r) {
        const resultType = r.resultType === "modify" ? "modify" : `load (${r.name})`;
        console.log(`╔══ [agent] result: ${resultType}  xml=${r.musicXml.length} chars`);
        if (r.resultType === "modify") return { type: "modify", musicXml: r.musicXml };
        return { type: "load", musicXml: r.musicXml, name: r.name! };
      }

      console.log(`╔══ [agent] result: chat — "${text.slice(0, 120)}${text.length > 120 ? "…" : ""}"`);
      return { type: "chat", message: text };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`│ [agent] ⚠ attempt ${attempt} failed: ${msg}`);
      lastError = err;
      // Only retry on tool-name errors (model hallucinated a wrong tool name)
      if (!msg.includes("unavailable tool") && !msg.includes("No such tool")) break;
    }
  }

  throw lastError;
}

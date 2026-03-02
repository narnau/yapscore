import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { toMusicXml } from "./mscore";
import {
  extractParts,
  extractSelectedMeasures,
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
  removeArticulations,
  addRepeatBarlines,
  addVoltaBrackets,
  addHairpin,
  changeKey,
  scaleNoteDurations,
  addTextAnnotation,
  setMeasureNotes,
  setTimeSignature,
  createScore,
  addChordSymbols,
  renamePart,
  changeInstrument,
  changeClef,
  addPart,
  removePart,
  movePart,
  notesTotalBeats,
  insertPickupMeasure,
  setSwing,
} from "./musicxml";
import type { DynamicMarking, ArticulationMarking, NoteSpec, ScoreInstrument, ChordSymbol, SwingInfo } from "./musicxml";
import { addAccidentals, fixChordSymbols } from "./accidentals";
import { addBeams } from "./beams";

export type AgentResult =
  | { type: "load";   musicXml: string; name: string }
  | { type: "modify"; musicXml: string; message: string }
  | { type: "chat";   message: string };

// ─── helpers ─────────────────────────────────────────────────────────────────

// ─── agent ───────────────────────────────────────────────────────────────────

export async function runAgent(
  message: string,
  currentMusicXml: string | null,
  selectedMeasures: number[] | null,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<AgentResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-preview";

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

  type ScoreCapture = { musicXml: string; name?: string; resultType: "load" | "modify" };

  console.log("╔══════════════════════════════════════════════════════════════");
  console.log(`║ [agent] model   : ${model}`);
  console.log(`║ [agent] message : ${message}`);
  const logCtx = currentMusicXml
    ? (() => { try { return extractParts(currentMusicXml).context; } catch { return "loaded"; } })()
    : "none";
  console.log(`║ [agent] score   : ${logCtx}`);
  if (selectionCtx) console.log(`║ [agent]${selectionCtx}`);
  console.log("╚══════════════════════════════════════════════════════════════");

  const MAX_AGENT_ATTEMPTS = 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_AGENT_ATTEMPTS; attempt++) {
    // Reset capture on each attempt
    const capture: { result: ScoreCapture | null } = { result: null };
    // liveXml tracks the current XML within this attempt — updated by createScore so
    // subsequent tools in the same multi-step turn can use the freshly created score.
    let liveXml = currentMusicXml;
    if (attempt > 1) console.log(`│ [agent] retrying (attempt ${attempt}/${MAX_AGENT_ATTEMPTS})…`);

    try {
  const { text } = await generateText({
    model: openrouter(model),
    maxSteps: 15,
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
    system: `You are a music score editor assistant. Always use tools — never just describe what you would do.

Current score: ${currentScoreCtx}${selectionCtx}

Rules:
- ALWAYS call tools immediately. Never ask for clarification. Make sensible musical assumptions and proceed.
- If the task is large, do it all: insert enough measures first, then fill them in with writeNotes across multiple steps.
- For large tasks, call writeNotes for multiple measures in parallel within the same step.
- If no score is loaded, call createScore first, then writeNotes to fill in notes.
- For piano or any 2-staff instrument: staff 1 = right hand, staff 2 = left hand.
- If the score doesn't have enough measures, call insertEmptyMeasures first.
- To change an instrument (e.g. "make it a piano"), use changeInstrument. NEVER use removePart + addPart for this — it destroys the notes.
- Only respond with plain text (no tool calls) when the user asks a pure question that requires no score changes.
- CRITICAL for writeNotes: the total duration of all notes in a measure must EXACTLY match the time signature. For 3/4: exactly 3 quarter-note beats (e.g. quarter+quarter+quarter, or dotted-half, or eighth+eighth+quarter+quarter). For 4/4: exactly 4 beats. NEVER overflow a measure — this causes rendering and playback errors.
- For pickup (anacrusis) measures at the start of a song, use the pickupBeats option in createScore, then write only the pickup notes (e.g. 1 beat for a 1-beat pickup in 3/4). All other measures must be full.`,
    messages: [...history, { role: "user" as const, content: message }],
    tools: {
      createScore: {
        description:
          "Create a new empty score scaffold with the specified instruments, key, time signature, and tempo. " +
          "All measures will contain whole rests — use writeNotes afterwards to fill in the actual notes. " +
          "Always call this first when no score is loaded.",
        parameters: z.object({
          instruments: z.array(z.object({
            name: z.string().describe("Instrument name, e.g. 'Piano', 'Violin', 'Voice', 'Guitar'."),
            staves: z.number().optional().describe("Number of staves (1 or 2). Use 2 for piano/organ/harp."),
            midiProgram: z.number().optional().describe("General MIDI program number (1-128) for playback. Common: 1=Acoustic Grand Piano, 25=Nylon Guitar, 41=Violin, 42=Viola, 43=Cello, 53=Voice Oohs, 57=Trumpet, 74=Flute. Required for correct playback sound."),
            clef: z.enum(["treble", "bass", "alto", "tenor"]).optional().describe(
              "Clef for single-staff instruments. Use the musically correct clef: " +
              "treble=violin/flute/trumpet/oboe/soprano; bass=tuba/cello/bass/trombone/bassoon/baritone sax; " +
              "alto=viola; tenor=cello high register. Defaults to treble if omitted."
            ),
          })).describe("List of instruments/parts in the score."),
          key: z.string().optional().describe("Key root, e.g. 'C', 'G', 'Bb', 'F#'. Defaults to 'C'."),
          beats: z.number().optional().describe("Beats per measure (numerator). Defaults to 4."),
          beatType: z.number().optional().describe("Beat unit (denominator). Defaults to 4."),
          tempo: z.number().optional().describe("Tempo in BPM. Defaults to 120."),
          measures: z.number().optional().describe("Number of empty measures to create. Defaults to 4."),
          pickupBeats: z.number().optional().describe("Number of beats in the pickup (anacrusis) measure. If set, the first measure will be a partial measure with this many beats."),
        }),
        execute: async ({ instruments, key, beats, beatType, tempo, measures, pickupBeats }) => {
          const musicXml = createScore({
            instruments: instruments as ScoreInstrument[],
            key, beats, beatType, tempo, measures, pickupBeats,
          });
          const name = instruments.map((i: ScoreInstrument) => i.name).join(" + ");
          liveXml = musicXml;
          capture.result = { musicXml, name, resultType: "load" };
          return { ok: true, name, measures: measures ?? 4 };
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = deleteMeasures(liveXml, measureNumbers);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, deleted: measureNumbers };
        },
      },

      clearMeasures: {
        description:
          "Clear the content of measures, replacing all notes with rests. The measures " +
          "stay in the score (same length) but become empty. Use when the user says " +
          "'clear', 'empty', 'remove the melody from', or 'blank out' measures. " +
          "If the user mentions a specific instrument/part, pass its partId to only clear that part.",
        parameters: z.object({
          measureNumbers: z.array(z.number()).describe(
            "Measure numbers to clear. Use the selected measures if the user says " +
            "'this measure' or 'these measures'."
          ),
          partId: z.string().optional().describe(
            "If provided, only clear notes in this part (e.g. 'P2'). " +
            "Omit to clear all parts in the given measures."
          ),
        }),
        execute: async ({ measureNumbers, partId }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = clearMeasures(liveXml, measureNumbers, partId);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, cleared: measureNumbers, partId: partId ?? "all" };
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = insertEmptyMeasures(liveXml, afterMeasure, count);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, inserted: count, after: afterMeasure };
        },
      },

      insertPickupMeasure: {
        description:
          "Insert a pickup (anacrusis) measure at the very beginning of an existing score. " +
          "Use when the user wants to add a pickup/anacrusis to a score that was already created without one. " +
          "After calling this, use writeNotes on measure 1 to fill in the pickup notes. " +
          "All existing measures shift forward by 1.",
        parameters: z.object({
          pickupBeats: z.number().describe(
            "Number of beats in the pickup measure. E.g. 1 for a 1-beat pickup in 3/4 (like Happy Birthday), " +
            "2 for a 2-beat pickup, etc. Must be less than the full measure capacity."
          ),
        }),
        execute: async ({ pickupBeats }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = insertPickupMeasure(liveXml, pickupBeats);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, pickupBeats, note: "Measure 1 is now a pickup. All previous measures shifted +1. Use writeNotes on measure 1 to fill in the anacrusis notes." };
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = duplicateMeasures(liveXml, measureNumbers);
          liveXml = result;
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const measures = allMeasures ? null : (measureNumbers ?? null);
          const result = transposeMeasures(liveXml, measures, semitones);
          liveXml = result;
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = repeatSection(liveXml, startMeasure, endMeasure, times);
          liveXml = result;
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const currentTempo = getTempo(liveXml);
          const result = setTempo(liveXml, bpm, beatUnit ?? "quarter");
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, bpm, previous: currentTempo?.bpm ?? "none" };
        },
      },

      setSwing: {
        description:
          "Enable or disable jazz swing feel. Swing makes pairs of eighth notes play " +
          "long-short (2:1 triplet ratio), giving a jazz/blues feel. " +
          "Use when the user says 'add swing', 'make it swing', 'jazz feel', " +
          "'remove swing', 'make it straight', 'no swing'.",
        parameters: z.object({
          enabled: z.boolean().describe("True to enable jazz swing, false for straight."),
        }),
        execute: async ({ enabled }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const swing: SwingInfo | null = enabled
            ? { first: 2, second: 1, swingType: "eighth" }
            : null;
          const result = setSwing(liveXml, swing);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, swing: enabled ? "jazz (2:1)" : "straight" };
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = addDynamics(liveXml, measureNumbers, dynamic as DynamicMarking);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, dynamic, measures: measureNumbers };
        },
      },

      addArticulations: {
        description:
          "Add articulation markings to EVERY note in the specified measures. Use when the user says " +
          "'staccato', 'accent', 'tenuto', 'marcato', 'staccatissimo', " +
          "'make it short/detached', 'add accents to all notes'. Use partId to target a specific instrument. " +
          "NOTE: this applies to ALL notes, not alternating ones. For every-other-note patterns, use writeNotes with articulation on specific notes instead.",
        parameters: z.object({
          measureNumbers: z.array(z.number()).describe(
            "Measure numbers to add articulations to. Use selected measures if applicable."
          ),
          articulation: z.enum(["staccato", "accent", "tenuto", "marcato", "staccatissimo"] as const).describe(
            "The articulation to add to each note."
          ),
          partId: z.string().optional().describe(
            "Target a specific part (e.g. 'P1', 'P2'). Omit to apply to all parts."
          ),
        }),
        execute: async ({ measureNumbers, articulation, partId }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = addArticulations(liveXml, measureNumbers, articulation as ArticulationMarking, partId);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, articulation, measures: measureNumbers, partId: partId ?? "all" };
        },
      },

      removeArticulations: {
        description:
          "Remove articulation markings from notes in measures. Use when the user says " +
          "'remove accents', 'no staccato', 'quitar articulaciones', or when they want " +
          "articulations only on specific parts and the rest should be cleared. " +
          "Use partId to target a specific instrument. Omit articulation to remove all types.",
        parameters: z.object({
          measureNumbers: z.array(z.number()).describe(
            "Measure numbers to remove articulations from."
          ),
          articulation: z.enum(["staccato", "accent", "tenuto", "marcato", "staccatissimo"] as const).optional().describe(
            "The specific articulation type to remove. Omit to remove all articulations."
          ),
          partId: z.string().optional().describe(
            "Target a specific part (e.g. 'P1', 'P2'). Omit to apply to all parts."
          ),
        }),
        execute: async ({ measureNumbers, articulation, partId }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = removeArticulations(liveXml, measureNumbers, articulation as ArticulationMarking | undefined, partId);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, articulation: articulation ?? "all", measures: measureNumbers, partId: partId ?? "all" };
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = addRepeatBarlines(liveXml, startMeasure, endMeasure);
          liveXml = result;
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = addVoltaBrackets(liveXml, firstEndingMeasures, secondEndingMeasures);
          liveXml = result;
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = addHairpin(liveXml, startMeasure, endMeasure, type);
          liveXml = result;
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
          if (!liveXml) throw new Error("No score is currently loaded");
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
          const result = changeKey(liveXml, fifths, fromMeasure);
          liveXml = result;
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const numericFactor = factor === "double" ? 2 : 0.5;
          const result = scaleNoteDurations(liveXml, measureNumbers, numericFactor);
          liveXml = result;
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = addTextAnnotation(liveXml, measureNumber, text, type);
          liveXml = result;
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
          staff: z.number().optional().describe(
            "Staff number: 1 = right hand / treble, 2 = left hand / bass. " +
            "Required for piano or any instrument with 2 staves. Omit for single-staff instruments."
          ),
          notes: z.array(z.object({
            step: z.enum(["C", "D", "E", "F", "G", "A", "B"] as const).optional()
              .describe("Note name (required for pitched notes, omit for rests)."),
            octave: z.number().optional().describe("Octave number (default 4)."),
            alter: z.number().optional().describe("-1 for flat, 1 for sharp, 0 or omit for natural."),
            duration: z.enum([
              "whole", "half", "quarter", "eighth", "16th",
              "dotted-whole", "dotted-half", "dotted-quarter", "dotted-eighth",
              "half-triplet", "quarter-triplet", "eighth-triplet", "16th-triplet",
            ] as const).describe("Note duration."),
            chord: z.boolean().optional().describe("True if this note is simultaneous with the previous note (chord)."),
            rest: z.boolean().optional().describe("True for a rest (omit step/octave)."),
            tie: z.enum(["start", "stop", "both"]).optional().describe("Tie this note to the next/previous note of the same pitch."),
            slur: z.enum(["start", "stop"]).optional().describe("Start or stop a slur (phrase mark) on this note."),
            tuplet: z.enum(["start", "stop"]).optional().describe("Mark the start or stop of a tuplet bracket. Use 'start' on the first note and 'stop' on the last note of a triplet group."),
            ornament: z.enum(["trill", "mordent", "inverted-mordent", "turn"]).optional().describe("Ornament to attach to this note."),
            articulation: z.enum(["staccato", "accent", "tenuto", "marcato", "staccatissimo"]).optional().describe("Articulation marking on this specific note. Use accent for > marks, staccato for dots, tenuto for dashes."),
            lyric: z.object({ text: z.string(), syllabic: z.enum(["single", "begin", "middle", "end"]).optional(), verse: z.number().optional() }).optional().describe("Lyric syllable for vocal parts."),
          })).describe("Array of notes to write into the measure, in order."),
        }),
        execute: async ({ measureNumber, partId, staff, notes }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          // Enforce selection: if the user has selected measures, only write to those
          const targetMeasure =
            selectedMeasures && selectedMeasures.length > 0 && !selectedMeasures.includes(measureNumber)
              ? selectedMeasures[0]
              : measureNumber;
          if (targetMeasure !== measureNumber) {
            console.log(`│ [agent] ⚠ writeNotes: overriding measure ${measureNumber} → ${targetMeasure} (selection enforced)`);
          }

          // ── Duration validation ──────────────────────────────────────────
          // Check whether this measure is a pickup (anacrusis) — implicit="yes"
          const isPickup = new RegExp(
            `<measure\\b[^>]*number="${targetMeasure}"[^>]*implicit="yes"`
          ).test(liveXml);

          const timeSigBeats    = parseInt(liveXml.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4");
          const timeSigBeatType = parseInt(liveXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4");
          const measureCapacity = timeSigBeats * (4 / timeSigBeatType); // in quarter-note beats

          const total = notesTotalBeats(notes as NoteSpec[]);

          if (isPickup) {
            // Pickup: must be > 0 and < full measure capacity
            if (total <= 0 || total >= measureCapacity) {
              return {
                ok: false,
                error: `Pickup measure ${targetMeasure} must have between 0 and ${measureCapacity} beats (exclusive). Got ${total}. Tip: use fewer notes — just the anacrusis notes.`,
              };
            }
          } else {
            // Regular measure: must exactly match the time signature capacity
            const tolerance = 0.02; // allow tiny floating-point error
            if (Math.abs(total - measureCapacity) > tolerance) {
              return {
                ok: false,
                error: `Measure ${targetMeasure} requires exactly ${measureCapacity} quarter-note beats (${timeSigBeats}/${timeSigBeatType}), but the provided notes total ${total} beats. Adjust note durations so they add up exactly.`,
              };
            }
          }
          // ────────────────────────────────────────────────────────────────

          const result = setMeasureNotes(liveXml, targetMeasure, notes as NoteSpec[], partId ?? "P1", staff);
          const postProcessed = addBeams(fixChordSymbols(addAccidentals(result)));
          liveXml = postProcessed;
          capture.result = { musicXml: postProcessed, resultType: "modify" };
          return { ok: true, measure: targetMeasure, partId: partId ?? "P1", staff: staff ?? "all", noteCount: notes.length };
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
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = setTimeSignature(liveXml, beats, beatType, fromMeasure ?? 1);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, timeSignature: `${beats}/${beatType}`, fromMeasure: fromMeasure ?? "all" };
        },
      },

      addChordSymbols: {
        description: "Add chord symbols (harmony markings) above a measure. Use for jazz/pop chord charts, lead sheets, or any score that needs chord names shown above the staff.",
        parameters: z.object({
          measureNumber: z.number().describe("Measure to add chord symbols to."),
          partId: z.string().optional().describe("Part to attach chords to (default 'P1')."),
          chords: z.array(z.object({
            root: z.string().describe("Chord root note, e.g. 'C', 'F#', 'Bb'."),
            kind: z.string().describe("Chord quality shorthand: '' (major), 'm', '7', 'maj7', 'm7', 'dim', 'dim7', 'aug', 'm7b5', 'sus2', 'sus4'."),
            beat: z.number().optional().describe("Beat number (1-based) where this chord starts. Defaults to 1."),
            bass: z.string().optional().describe("Bass note for slash chords, e.g. 'E' for C/E."),
          })).describe("List of chord symbols to add to this measure."),
        }),
        execute: async ({ measureNumber, partId, chords }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = addChordSymbols(liveXml, measureNumber, chords as ChordSymbol[], partId ?? "P1");
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, measure: measureNumber, chords: chords.length };
        },
      },

      renamePart: {
        description: "Rename an instrument/part in the score (updates the part name displayed on the score).",
        parameters: z.object({
          partId: z.string().describe("Part ID to rename, e.g. 'P1', 'P2'."),
          name: z.string().describe("New instrument name, e.g. 'Flute', 'Bass Guitar'."),
        }),
        execute: async ({ partId, name }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = renamePart(liveXml, partId, name);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, partId, name };
        },
      },

      changeInstrument: {
        description:
          "Change a part's instrument (e.g. Trumpet → Piano). Updates the name, MIDI program, and staves/clefs. " +
          "Preserves existing notes when staves stay the same. If staves change (e.g. 1→2 for piano), the part is rebuilt with empty measures. " +
          "ALWAYS prefer this over removePart + addPart when changing an instrument.",
        parameters: z.object({
          partId: z.string().describe("Part ID to change, e.g. 'P1'."),
          name: z.string().describe("New instrument name, e.g. 'Piano', 'Flute'."),
          staves: z.number().optional().describe("Number of staves (1 or 2). Omit for single-staff; use 2 for piano/organ/harp."),
          midiProgram: z.number().int().min(1).max(128).describe(
            "General MIDI program number (1–128). Pick the correct GM program. " +
            "Examples: Piano=1, Harpsichord=7, Guitar=25, Violin=41, Cello=43, Trumpet=57, Flute=74, Voice=53."
          ),
        }),
        execute: async ({ partId, name, staves, midiProgram }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = changeInstrument(liveXml, partId, { name, staves, midiProgram });
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, partId, name };
        },
      },

      changeClef: {
        description:
          "Change the clef of a part. Use when the user says 'change to bass clef', 'use F clef', " +
          "'change to treble clef', 'alto clef', 'tenor clef', etc. " +
          "Common clefs: treble (violin, flute, trumpet, piano RH), bass (tuba, cello, bass, piano LH), " +
          "alto (viola), tenor (cello high register, trombone).",
        parameters: z.object({
          partId: z.string().describe("Part ID to change, e.g. 'P1'."),
          clef: z.enum(["treble", "bass", "alto", "tenor"] as const).describe(
            "Target clef. treble=G clef, bass=F clef, alto=C clef on middle line, tenor=C clef on 4th line."
          ),
          staffNumber: z.number().optional().describe(
            "For multi-staff parts (e.g. piano): 1=top staff, 2=bottom staff. Omit for single-staff instruments."
          ),
        }),
        execute: async ({ partId, clef, staffNumber }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = changeClef(liveXml, partId, clef, staffNumber);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, partId, clef, staffNumber: staffNumber ?? "single" };
        },
      },

      addPart: {
        description: "Add a new instrument part to the score. Creates empty measures in sync with existing parts. Use writeNotes afterwards to fill in the notes.",
        parameters: z.object({
          name: z.string().describe("Instrument name, e.g. 'Violin', 'Baritone Saxophone', 'Flute'."),
          staves: z.number().optional().describe("Number of staves (1 or 2). Omit for single-staff instruments; use 2 for piano/organ/harp."),
          clef: z.enum(["treble", "bass", "alto", "tenor"]).optional().describe(
            "Clef for single-staff instruments. Use the musically correct clef: " +
            "treble=violin/flute/trumpet/oboe/soprano; bass=tuba/cello/bass/trombone/bassoon/baritone sax; " +
            "alto=viola; tenor=cello high register. Defaults to treble if omitted."
          ),
          midiProgram: z.number().int().min(1).max(128).describe(
            "General MIDI program number (1–128). You must supply this — pick the correct GM program for the instrument. " +
            "Examples: Acoustic Grand Piano=1, Harpsichord=7, Organ=20, Acoustic Guitar=25, Electric Guitar=27, " +
            "Bass Guitar=34, Violin=41, Viola=42, Cello=43, Double Bass=44, Harp=47, " +
            "Trumpet=57, Trombone=58, Tuba=59, French Horn=61, " +
            "Soprano Sax=65, Alto Sax=66, Tenor Sax=67, Baritone Sax=68, " +
            "Oboe=69, English Horn=70, Bassoon=71, Clarinet=72, Piccolo=73, Flute=74, " +
            "Soprano Voice=53, Choir=53, Xylophone=14, Vibraphone=12, Marimba=13."
          ),
        }),
        execute: async ({ name, staves, clef, midiProgram }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = addPart(liveXml, { name, staves, clef, midiProgram });
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, name };
        },
      },

      removePart: {
        description: "Remove an instrument part from the score entirely.",
        parameters: z.object({
          partId: z.string().describe("Part ID to remove, e.g. 'P2'."),
        }),
        execute: async ({ partId }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = removePart(liveXml, partId);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, partId };
        },
      },
      movePart: {
        description: "Move a part up or down in the score order (i.e. reorder staves). 'up' means higher on the page (lower index), 'down' means lower on the page.",
        parameters: z.object({
          partId: z.string().describe("Part ID to move, e.g. 'P2'."),
          direction: z.enum(["up", "down"]).describe("Direction to move the part."),
        }),
        execute: async ({ partId, direction }) => {
          if (!liveXml) throw new Error("No score is currently loaded");
          const result = movePart(liveXml, partId, direction);
          liveXml = result;
          capture.result = { musicXml: result, resultType: "modify" };
          return { ok: true, partId, direction };
        },
      },
    },
  });

      const r = capture.result;
      if (r) {
        const resultType = r.resultType === "modify" ? "modify" : `load (${r.name})`;
        console.log(`╔══ [agent] result: ${resultType}  xml=${r.musicXml.length} chars`);
        if (r.resultType === "modify") return { type: "modify", musicXml: r.musicXml, message: text || "Score updated." };
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

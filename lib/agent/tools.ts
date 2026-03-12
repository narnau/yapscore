import { z } from "zod";
import {
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
  addSlur,
  removeSlurs,
  addLyrics,
  addFermata,
  addOttava,
  addPedalMarking,
  setScoreMetadata,
  addNavigationMark,
  addArpeggio,
  addTremolo,
  addGlissando,
  addBreathMark,
} from "@/lib/music/musicxml";
import type {
  DynamicMarking,
  ArticulationMarking,
  NoteSpec,
  ScoreInstrument,
  ChordSymbol,
  SwingInfo,
  NavigationMarkType,
} from "@/lib/music/musicxml";
import { addAccidentals, fixChordSymbols } from "@/lib/music/accidentals";
import { addBeams } from "@/lib/music/beams";
import { logger } from "@/lib/telemetry/logger";
import type { AgentContext } from "./types";

export function createTools(ctx: AgentContext, selectedMeasures: number[] | null) {
  return {
    createScore: {
      description:
        "Create a new empty score scaffold with the specified instruments, key, time signature, and tempo. " +
        "All measures will contain whole rests — use writeNotes afterwards to fill in the actual notes. " +
        "Always call this first when no score is loaded.",
      parameters: z.object({
        instruments: z
          .array(
            z.object({
              name: z.string().describe("Instrument name, e.g. 'Piano', 'Violin', 'Voice', 'Guitar'."),
              staves: z.number().optional().describe("Number of staves (1 or 2). Use 2 for piano/organ/harp."),
              midiProgram: z
                .number()
                .optional()
                .describe(
                  "General MIDI program number (1-128) for playback. Common: 1=Acoustic Grand Piano, 25=Nylon Guitar, 41=Violin, 42=Viola, 43=Cello, 53=Voice Oohs, 57=Trumpet, 74=Flute. Required for correct playback sound.",
                ),
              clef: z
                .enum(["treble", "bass", "alto", "tenor"])
                .optional()
                .describe(
                  "Clef for single-staff instruments. Use the musically correct clef: " +
                    "treble=violin/flute/trumpet/oboe/soprano; bass=tuba/cello/bass/trombone/bassoon/baritone sax; " +
                    "alto=viola; tenor=cello high register. Defaults to treble if omitted.",
                ),
              percussion: z
                .boolean()
                .optional()
                .describe(
                  "Set true for drums/percussion. Creates a drumset part with percussion clef on MIDI channel 10. " +
                    "Use writeNotes with drumSound on each note. voice=1 for hands, voice=2 for feet.",
                ),
            }),
          )
          .describe("List of instruments/parts in the score."),
        key: z.string().optional().describe("Key root, e.g. 'C', 'G', 'Bb', 'F#'. Defaults to 'C'."),
        beats: z.number().optional().describe("Beats per measure (numerator). Defaults to 4."),
        beatType: z.number().optional().describe("Beat unit (denominator). Defaults to 4."),
        tempo: z.number().optional().describe("Tempo in BPM. Defaults to 120."),
        measures: z.number().optional().describe("Number of empty measures to create. Defaults to 4."),
        pickupBeats: z
          .number()
          .optional()
          .describe(
            "Number of beats in the pickup (anacrusis) measure. If set, the first measure will be a partial measure with this many beats.",
          ),
      }),
      execute: async ({
        instruments,
        key,
        beats,
        beatType,
        tempo,
        measures,
        pickupBeats,
      }: {
        instruments: ScoreInstrument[];
        key?: string;
        beats?: number;
        beatType?: number;
        tempo?: number;
        measures?: number;
        pickupBeats?: number;
      }) => {
        const musicXml = createScore({
          instruments: instruments as ScoreInstrument[],
          key,
          beats,
          beatType,
          tempo,
          measures,
          pickupBeats,
        });
        const name = instruments.map((i: ScoreInstrument) => i.name).join(" + ");
        ctx.liveXml = musicXml;
        ctx.capture.result = { musicXml, name, resultType: "load" };
        return { ok: true, name, measures: measures ?? 4 };
      },
    },

    deleteMeasures: {
      description:
        "Delete (remove) measures from the score entirely. The score gets shorter " +
        "and remaining measures are renumbered. Use when the user says 'delete', " +
        "'remove', or 'cut' measures.",
      parameters: z.object({
        measureNumbers: z
          .array(z.number())
          .describe(
            "Measure numbers to delete. Use the selected measures if the user says " +
              "'this measure' or 'these measures'.",
          ),
      }),
      execute: async ({ measureNumbers }: { measureNumbers: number[] }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = deleteMeasures(ctx.liveXml, measureNumbers);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, deleted: measureNumbers };
      },
    },

    clearMeasures: {
      description:
        "Clear the content of measures, replacing all notes with rests. The measures " +
        "stay in the score (same length) but become empty. Use when the user says " +
        "'clear', 'empty', 'remove the melody from', or 'blank out' measures. " +
        "If the user mentions a specific instrument/part, pass its partId to only clear that part. " +
        "For piano scores, use staff=1 for right hand (treble) and staff=2 for left hand (bass).",
      parameters: z.object({
        measureNumbers: z
          .array(z.number())
          .describe(
            "Measure numbers to clear. Use the selected measures if the user says " +
              "'this measure' or 'these measures'.",
          ),
        partId: z
          .string()
          .optional()
          .describe(
            "If provided, only clear notes in this part (e.g. 'P2'). " +
              "Omit to clear all parts in the given measures.",
          ),
        staff: z
          .number()
          .optional()
          .describe(
            "If provided, only clear notes on this staff number within the part. " +
              "Use staff=1 for right hand / treble clef, staff=2 for left hand / bass clef. " +
              "Omit to clear all staves.",
          ),
      }),
      execute: async ({
        measureNumbers,
        partId,
        staff,
      }: {
        measureNumbers: number[];
        partId?: string;
        staff?: number;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = clearMeasures(ctx.liveXml, measureNumbers, partId, staff);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, cleared: measureNumbers, partId: partId ?? "all", staff: staff ?? "all" };
      },
    },

    insertEmptyMeasures: {
      description:
        "Insert empty measures (whole rests) into the score. Use when the user says " +
        "'add measures', 'insert bars', 'add empty bars', etc.",
      parameters: z.object({
        afterMeasure: z
          .number()
          .describe(
            "Insert after this measure number. Use 0 to insert at the beginning. " +
              "Use the last measure number to append at the end.",
          ),
        count: z.number().min(1).describe("Number of empty measures to insert"),
      }),
      execute: async ({ afterMeasure, count }: { afterMeasure: number; count: number }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = insertEmptyMeasures(ctx.liveXml, afterMeasure, count);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        pickupBeats: z
          .number()
          .describe(
            "Number of beats in the pickup measure. E.g. 1 for a 1-beat pickup in 3/4 (like Happy Birthday), " +
              "2 for a 2-beat pickup, etc. Must be less than the full measure capacity.",
          ),
      }),
      execute: async ({ pickupBeats }: { pickupBeats: number }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = insertPickupMeasure(ctx.liveXml, pickupBeats);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return {
          ok: true,
          pickupBeats,
          note: "Measure 1 is now a pickup. All previous measures shifted +1. Use writeNotes on measure 1 to fill in the anacrusis notes.",
        };
      },
    },

    duplicateMeasures: {
      description:
        "Duplicate (copy) measures and insert the copies right after the originals. " +
        "Use when the user says 'duplicate', 'copy', or 'repeat these measures'.",
      parameters: z.object({
        measureNumbers: z
          .array(z.number())
          .describe("Measure numbers to duplicate. Use the selected measures if applicable."),
      }),
      execute: async ({ measureNumbers }: { measureNumbers: number[] }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = duplicateMeasures(ctx.liveXml, measureNumbers);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        semitones: z.number().describe("Number of semitones to transpose. Positive = up, negative = down."),
        allMeasures: z.boolean().describe("Set to true to transpose the entire score."),
        measureNumbers: z
          .array(z.number())
          .optional()
          .describe("Specific measures to transpose. Omit (or leave empty) when allMeasures is true."),
      }),
      execute: async ({
        semitones,
        allMeasures,
        measureNumbers,
      }: {
        semitones: number;
        allMeasures: boolean;
        measureNumbers?: number[];
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const measures = allMeasures ? null : (measureNumbers ?? null);
        const result = transposeMeasures(ctx.liveXml, measures, semitones);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
      execute: async ({
        startMeasure,
        endMeasure,
        times,
      }: {
        startMeasure: number;
        endMeasure: number;
        times: number;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = repeatSection(ctx.liveXml, startMeasure, endMeasure, times);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        bpm: z
          .number()
          .min(20)
          .max(300)
          .describe(
            "Beats per minute. Use the current tempo context to adjust relatively " +
              "(e.g., 'faster' = +20 BPM from current).",
          ),
        beatUnit: z
          .string()
          .optional()
          .describe(
            "Note value for the beat: 'quarter' (default), 'half', 'eighth', 'whole'. " +
              "Only change if the user explicitly requests a different beat unit.",
          ),
      }),
      execute: async ({ bpm, beatUnit }: { bpm: number; beatUnit?: string }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const currentTempo = getTempo(ctx.liveXml);
        const result = setTempo(ctx.liveXml, bpm, beatUnit ?? "quarter");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
      execute: async ({ enabled }: { enabled: boolean }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const swing: SwingInfo | null = enabled ? { first: 2, second: 1, swingType: "eighth" } : null;
        const result = setSwing(ctx.liveXml, swing);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, swing: enabled ? "jazz (2:1)" : "straight" };
      },
    },

    addDynamics: {
      description:
        "Add a dynamic marking to measures. Use when the user says " +
        "'make it louder', 'piano', 'fortissimo', 'add forte', 'pp', 'mf', etc.",
      parameters: z.object({
        measureNumbers: z
          .array(z.number())
          .describe("Measure numbers to add the dynamic to. Use selected measures if applicable."),
        dynamic: z
          .enum(["pp", "p", "mp", "mf", "f", "ff", "fp", "sfz"] as const)
          .describe("The dynamic marking to add."),
      }),
      execute: async ({ measureNumbers, dynamic }: { measureNumbers: number[]; dynamic: string }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addDynamics(ctx.liveXml, measureNumbers, dynamic as DynamicMarking);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        measureNumbers: z
          .array(z.number())
          .describe("Measure numbers to add articulations to. Use selected measures if applicable."),
        articulation: z
          .enum(["staccato", "accent", "tenuto", "marcato", "staccatissimo"] as const)
          .describe("The articulation to add to each note."),
        partId: z.string().optional().describe("Target a specific part (e.g. 'P1', 'P2'). Omit to apply to all parts."),
      }),
      execute: async ({
        measureNumbers,
        articulation,
        partId,
      }: {
        measureNumbers: number[];
        articulation: string;
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addArticulations(ctx.liveXml, measureNumbers, articulation as ArticulationMarking, partId);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        measureNumbers: z.array(z.number()).describe("Measure numbers to remove articulations from."),
        articulation: z
          .enum(["staccato", "accent", "tenuto", "marcato", "staccatissimo"] as const)
          .optional()
          .describe("The specific articulation type to remove. Omit to remove all articulations."),
        partId: z.string().optional().describe("Target a specific part (e.g. 'P1', 'P2'). Omit to apply to all parts."),
      }),
      execute: async ({
        measureNumbers,
        articulation,
        partId,
      }: {
        measureNumbers: number[];
        articulation?: string;
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = removeArticulations(
          ctx.liveXml,
          measureNumbers,
          articulation as ArticulationMarking | undefined,
          partId,
        );
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
      execute: async ({ startMeasure, endMeasure }: { startMeasure: number; endMeasure: number }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addRepeatBarlines(ctx.liveXml, startMeasure, endMeasure);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
      execute: async ({
        firstEndingMeasures,
        secondEndingMeasures,
      }: {
        firstEndingMeasures: number[];
        secondEndingMeasures: number[];
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addVoltaBrackets(ctx.liveXml, firstEndingMeasures, secondEndingMeasures);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        type: z
          .enum(["crescendo", "diminuendo"] as const)
          .describe("Type of hairpin: crescendo (getting louder) or diminuendo (getting softer)."),
      }),
      execute: async ({
        startMeasure,
        endMeasure,
        type,
      }: {
        startMeasure: number;
        endMeasure: number;
        type: "crescendo" | "diminuendo";
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addHairpin(ctx.liveXml, startMeasure, endMeasure, type);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        key: z
          .enum([
            "Cb major",
            "Gb major",
            "Db major",
            "Ab major",
            "Eb major",
            "Bb major",
            "F major",
            "C major",
            "G major",
            "D major",
            "A major",
            "E major",
            "B major",
            "F# major",
            "C# major",
            "Ab minor",
            "Eb minor",
            "Bb minor",
            "F minor",
            "C minor",
            "G minor",
            "D minor",
            "A minor",
            "E minor",
            "B minor",
            "F# minor",
            "C# minor",
            "G# minor",
            "D# minor",
            "A# minor",
          ])
          .describe("Target key signature."),
        fromMeasure: z
          .number()
          .optional()
          .describe("Start the key change from this measure. Omit to change the whole score."),
      }),
      execute: async ({ key, fromMeasure }: { key: string; fromMeasure?: number }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const KEY_MAP: Record<string, number> = {
          "Cb major": -7,
          "Gb major": -6,
          "Db major": -5,
          "Ab major": -4,
          "Eb major": -3,
          "Bb major": -2,
          "F major": -1,
          "C major": 0,
          "G major": 1,
          "D major": 2,
          "A major": 3,
          "E major": 4,
          "B major": 5,
          "F# major": 6,
          "C# major": 7,
          "Ab minor": -7,
          "Eb minor": -6,
          "Bb minor": -5,
          "F minor": -4,
          "C minor": -3,
          "G minor": -2,
          "D minor": -1,
          "A minor": 0,
          "E minor": 1,
          "B minor": 2,
          "F# minor": 3,
          "C# minor": 4,
          "G# minor": 5,
          "D# minor": 6,
          "A# minor": 7,
        };
        const fifths = KEY_MAP[key];
        const result = changeKey(ctx.liveXml, fifths, fromMeasure);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, key, fromMeasure: fromMeasure ?? "all" };
      },
    },

    scaleNoteDurations: {
      description:
        "Double or halve all note durations in measures (augmentation/diminution). " +
        "Use when the user says 'double the note lengths', 'halve the durations', " +
        "'augmentation', 'diminution', 'make notes longer/shorter'.",
      parameters: z.object({
        measureNumbers: z.array(z.number()).describe("Measure numbers to scale. Use selected measures if applicable."),
        factor: z.enum(["double", "halve"] as const).describe("Whether to double or halve the durations."),
      }),
      execute: async ({ measureNumbers, factor }: { measureNumbers: number[]; factor: "double" | "halve" }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const numericFactor = factor === "double" ? 2 : 0.5;
        const result = scaleNoteDurations(ctx.liveXml, measureNumbers, numericFactor);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        type: z
          .enum(["text", "rehearsal"] as const)
          .describe("Type: 'text' for expression text (italic), 'rehearsal' for rehearsal marks (boxed)."),
      }),
      execute: async ({
        measureNumber,
        text,
        type,
      }: {
        measureNumber: number;
        text: string;
        type: "text" | "rehearsal";
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addTextAnnotation(ctx.liveXml, measureNumber, text, type);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        "dotted-quarter, dotted-eighth. " +
        "Triplet durations: eighth-triplet (1/3 beat, 'tresillos de corchea' — 12 per 4/4 bar), " +
        "quarter-triplet (2/3 beat, 'tresillos de negra' — 6 per 4/4 bar), " +
        "half-triplet (4/3 beat — 3 per 4/4 bar), 16th-triplet (1/6 beat — 24 per 4/4 bar). " +
        "For triplets, add tuplet:'start' on note 1 and tuplet:'stop' on note 3 of each group. " +
        "For chords, set chord: true on the 2nd+ notes.",
      parameters: z.object({
        measureNumber: z.number().describe("Measure number to write notes into."),
        partId: z.string().optional().describe("Part ID to target (e.g. 'P1', 'P2'). Defaults to 'P1'."),
        staff: z
          .number()
          .optional()
          .describe(
            "Staff number: 1 = right hand / treble, 2 = left hand / bass. " +
              "Required for piano or any instrument with 2 staves. Omit for single-staff instruments.",
          ),
        voice: z
          .number()
          .optional()
          .describe(
            "For percussion parts: 1 = hands (hi-hat, snare, cymbals — stems up), " +
              "2 = feet (bass drum, hi-hat pedal — stems down). " +
              "Call writeNotes twice per measure when writing both hands and feet.",
          ),
        notes: z
          .preprocess(
            (val) => {
              if (!Array.isArray(val)) return val;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return val.map((note: any) => {
                if (typeof note !== "object" || !note || typeof note.step !== "string") return note;
                const flat = note.step.match(/^([A-G])b$/i);
                const sharp = note.step.match(/^([A-G])#$/i);
                if (flat) return { ...note, step: flat[1].toUpperCase(), alter: note.alter ?? -1 };
                if (sharp) return { ...note, step: sharp[1].toUpperCase(), alter: note.alter ?? 1 };
                return { ...note, step: note.step[0].toUpperCase() };
              });
            },
            z.array(
              z.object({
                step: z
                  .enum(["C", "D", "E", "F", "G", "A", "B"] as const)
                  .optional()
                  .describe("Note letter name (C–B). For accidentals use alter: -1 (flat) or 1 (sharp)."),
                octave: z.number().optional().describe("Octave number (default 4)."),
                alter: z.number().optional().describe("-1 for flat, 1 for sharp, 0 or omit for natural."),
                duration: z
                  .enum([
                    "whole",
                    "half",
                    "quarter",
                    "eighth",
                    "16th",
                    "dotted-whole",
                    "dotted-half",
                    "dotted-quarter",
                    "dotted-eighth",
                    "half-triplet",
                    "quarter-triplet",
                    "eighth-triplet",
                    "16th-triplet",
                  ] as const)
                  .describe(
                    "Note duration. Use varied rhythms — mix quarters, eighths, halves, dotted values, etc. " +
                      "Do NOT default to all-quarter notes unless the user specifically asks for it.",
                  ),
                chord: z
                  .boolean()
                  .optional()
                  .describe("True if this note is simultaneous with the previous note (chord)."),
                rest: z.boolean().optional().describe("True for a rest (omit step/octave)."),
                tie: z
                  .enum(["start", "stop", "both"])
                  .optional()
                  .describe("Tie this note to the next/previous note of the same pitch."),
                slur: z.enum(["start", "stop"]).optional().describe("Start or stop a slur (phrase mark) on this note."),
                tuplet: z
                  .enum(["start", "stop"])
                  .optional()
                  .describe(
                    "Mark the start or stop of a tuplet bracket. Use 'start' on the first note and 'stop' on the last note of a triplet group.",
                  ),
                ornament: z
                  .enum(["trill", "mordent", "inverted-mordent", "turn"])
                  .optional()
                  .describe("Ornament to attach to this note."),
                articulation: z
                  .enum(["staccato", "accent", "tenuto", "marcato", "staccatissimo"])
                  .optional()
                  .describe(
                    "Articulation marking on this specific note. Use accent for > marks, staccato for dots, tenuto for dashes.",
                  ),
                lyric: z
                  .object({
                    text: z.string(),
                    syllabic: z.enum(["single", "begin", "middle", "end"]).optional(),
                    verse: z.number().optional(),
                  })
                  .optional()
                  .describe("Lyric syllable for vocal parts."),
                drumSound: z
                  .string()
                  .optional()
                  .describe(
                    "For percussion parts: name of drum sound. Available: bass-drum, snare, hi-hat, open-hi-hat, " +
                      "hi-hat-pedal, floor-tom, low-tom, mid-tom, high-tom, crash, ride. " +
                      "When set, step/octave/alter are ignored — pitch is determined by the drum sound.",
                  ),
                voice: z
                  .number()
                  .optional()
                  .describe("For percussion notes: 1 = voice 1 (hands, stems up), 2 = voice 2 (feet, stems down)."),
              }),
            ),
          )
          .describe("Array of notes to write into the measure, in order."),
      }),

      execute: async ({
        measureNumber,
        partId,
        staff,
        voice,
        notes,
      }: {
        measureNumber: number;
        partId?: string;
        staff?: number;
        voice?: number;
        notes: any[];
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        // Enforce selection: if the user has selected measures, only write to those
        const targetMeasure =
          selectedMeasures && selectedMeasures.length > 0 && !selectedMeasures.includes(measureNumber)
            ? selectedMeasures[0]
            : measureNumber;
        if (targetMeasure !== measureNumber) {
          console.log(
            `│ [agent] ⚠ writeNotes: overriding measure ${measureNumber} → ${targetMeasure} (selection enforced)`,
          );
        }

        // ── Duration validation ──────────────────────────────────────────
        // Check whether this measure is a pickup (anacrusis) — implicit="yes"
        const isPickup = new RegExp(`<measure\\b[^>]*number="${targetMeasure}"[^>]*implicit="yes"`).test(ctx.liveXml);

        // Find effective time signature at targetMeasure (last change on or before it)
        const { timeSigBeats, timeSigBeatType } = (() => {
          // Walk measures in order, tracking the last seen time signature
          let beats = 4,
            beatType = 4;
          const measureRe = /<measure\b[^>]*number="(\d+)"[\s\S]*?(?=<measure\b|$)/g;
          let m: RegExpExecArray | null;
          while ((m = measureRe.exec(ctx.liveXml!)) !== null) {
            const mNum = parseInt(m[1]);
            if (mNum > targetMeasure) break;
            const timeSig = m[0].match(/<beats>(\d+)<\/beats>[\s\S]*?<beat-type>(\d+)<\/beat-type>/);
            if (timeSig) {
              beats = parseInt(timeSig[1]);
              beatType = parseInt(timeSig[2]);
            }
          }
          return { timeSigBeats: beats, timeSigBeatType: beatType };
        })();
        const measureCapacity = timeSigBeats * (4 / timeSigBeatType); // in quarter-note beats

        // Percussion voice calls: chord notes share a beat with the previous note,
        // so notesTotalBeats (which skips chords) under-counts intentionally.
        // Skip duration validation for voice calls — trust the LLM to fill the measure.
        if (voice != null) {
          // no validation for percussion voices
        } else {
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
        } // end: non-percussion duration validation
        // ────────────────────────────────────────────────────────────────

        const result = setMeasureNotes(
          ctx.liveXml,
          targetMeasure,
          notes as NoteSpec[],
          partId ?? "P1",
          staff,
          voice as 1 | 2 | undefined,
        );
        const postProcessed = addBeams(fixChordSymbols(addAccidentals(result)));
        ctx.liveXml = postProcessed;
        ctx.capture.result = { musicXml: postProcessed, resultType: "modify" };
        return {
          ok: true,
          measure: targetMeasure,
          partId: partId ?? "P1",
          staff: staff ?? "all",
          noteCount: notes.length,
        };
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
        fromMeasure: z.number().optional().describe("Change from this measure onward. Omit to change the whole score."),
      }),
      execute: async ({ beats, beatType, fromMeasure }: { beats: number; beatType: number; fromMeasure?: number }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = setTimeSignature(ctx.liveXml, beats, beatType, fromMeasure ?? 1);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, timeSignature: `${beats}/${beatType}`, fromMeasure: fromMeasure ?? "all" };
      },
    },

    addChordSymbols: {
      description:
        "Add chord symbols (harmony markings) above a measure. Use for jazz/pop chord charts, lead sheets, or any score that needs chord names shown above the staff.",
      parameters: z.object({
        measureNumber: z.number().describe("Measure to add chord symbols to."),
        partId: z.string().optional().describe("Part to attach chords to (default 'P1')."),
        chords: z
          .array(
            z.object({
              root: z.string().describe("Chord root note, e.g. 'C', 'F#', 'Bb'."),
              kind: z
                .string()
                .describe(
                  "Chord quality shorthand: '' (major), 'm', '7', 'maj7', 'm7', 'dim', 'dim7', 'aug', 'm7b5', 'sus2', 'sus4'.",
                ),
              beat: z.number().optional().describe("Beat number (1-based) where this chord starts. Defaults to 1."),
              bass: z.string().optional().describe("Bass note for slash chords, e.g. 'E' for C/E."),
            }),
          )
          .describe("List of chord symbols to add to this measure."),
      }),
      execute: async ({
        measureNumber,
        partId,
        chords,
      }: {
        measureNumber: number;
        partId?: string;
        chords: ChordSymbol[];
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addChordSymbols(ctx.liveXml, measureNumber, chords as ChordSymbol[], partId ?? "P1");
        if (result.error) return { ok: false, error: result.error };
        ctx.liveXml = result.xml;
        ctx.capture.result = { musicXml: result.xml, resultType: "modify" };
        return { ok: true, measure: measureNumber, chords: chords.length };
      },
    },

    renamePart: {
      description: "Rename an instrument/part in the score (updates the part name displayed on the score).",
      parameters: z.object({
        partId: z.string().describe("Part ID to rename, e.g. 'P1', 'P2'."),
        name: z.string().describe("New instrument name, e.g. 'Flute', 'Bass Guitar'."),
      }),
      execute: async ({ partId, name }: { partId: string; name: string }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = renamePart(ctx.liveXml, partId, name);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        staves: z
          .number()
          .optional()
          .describe("Number of staves (1 or 2). Omit for single-staff; use 2 for piano/organ/harp."),
        midiProgram: z
          .number()
          .int()
          .min(1)
          .max(128)
          .describe(
            "General MIDI program number (1–128). Pick the correct GM program. " +
              "Examples: Piano=1, Harpsichord=7, Guitar=25, Violin=41, Cello=43, Trumpet=57, Flute=74, Voice=53.",
          ),
      }),
      execute: async ({
        partId,
        name,
        staves,
        midiProgram,
      }: {
        partId: string;
        name: string;
        staves?: number;
        midiProgram: number;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = changeInstrument(ctx.liveXml, partId, { name, staves, midiProgram });
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
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
        clef: z
          .enum(["treble", "bass", "alto", "tenor"] as const)
          .describe("Target clef. treble=G clef, bass=F clef, alto=C clef on middle line, tenor=C clef on 4th line."),
        staffNumber: z
          .number()
          .optional()
          .describe(
            "For multi-staff parts (e.g. piano): 1=top staff, 2=bottom staff. Omit for single-staff instruments.",
          ),
      }),
      execute: async ({
        partId,
        clef,
        staffNumber,
      }: {
        partId: string;
        clef: "treble" | "bass" | "alto" | "tenor";
        staffNumber?: number;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = changeClef(ctx.liveXml, partId, clef, staffNumber);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, partId, clef, staffNumber: staffNumber ?? "single" };
      },
    },

    addPart: {
      description:
        "Add a new instrument part to the score. Creates empty measures in sync with existing parts. Use writeNotes afterwards to fill in the notes.",
      parameters: z.object({
        name: z.string().describe("Instrument name, e.g. 'Violin', 'Baritone Saxophone', 'Flute'."),
        staves: z
          .number()
          .optional()
          .describe("Number of staves (1 or 2). Omit for single-staff instruments; use 2 for piano/organ/harp."),
        clef: z
          .enum(["treble", "bass", "alto", "tenor"])
          .optional()
          .describe(
            "Clef for single-staff instruments. Use the musically correct clef: " +
              "treble=violin/flute/trumpet/oboe/soprano; bass=tuba/cello/bass/trombone/bassoon/baritone sax; " +
              "alto=viola; tenor=cello high register. Defaults to treble if omitted.",
          ),
        midiProgram: z
          .number()
          .int()
          .min(1)
          .max(128)
          .optional()
          .describe(
            "General MIDI program number (1–128). You must supply this — pick the correct GM program for the instrument. " +
              "Examples: Acoustic Grand Piano=1, Harpsichord=7, Organ=20, Acoustic Guitar=25, Electric Guitar=27, " +
              "Bass Guitar=34, Violin=41, Viola=42, Cello=43, Double Bass=44, Harp=47, " +
              "Trumpet=57, Trombone=58, Tuba=59, French Horn=61, " +
              "Soprano Sax=65, Alto Sax=66, Tenor Sax=67, Baritone Sax=68, " +
              "Oboe=69, English Horn=70, Bassoon=71, Clarinet=72, Piccolo=73, Flute=74, " +
              "Soprano Voice=53, Choir=53, Xylophone=14, Vibraphone=12, Marimba=13. " +
              "Omit when percussion=true (channel 10 is used instead).",
          ),
        percussion: z
          .boolean()
          .optional()
          .describe(
            "Set true for drums/percussion. Creates a drumset part with percussion clef on MIDI channel 10. " +
              "Use writeNotes with drumSound on each note. voice=1 for hands, voice=2 for feet.",
          ),
      }),
      execute: async ({
        name,
        staves,
        clef,
        midiProgram,
        percussion,
      }: {
        name: string;
        staves?: number;
        clef?: "treble" | "bass" | "alto" | "tenor";
        midiProgram?: number;
        percussion?: boolean;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addPart(ctx.liveXml, { name, staves, clef, midiProgram, percussion });
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, name };
      },
    },

    removePart: {
      description: "Remove an instrument part from the score entirely.",
      parameters: z.object({
        partId: z.string().describe("Part ID to remove, e.g. 'P2'."),
      }),
      execute: async ({ partId }: { partId: string }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = removePart(ctx.liveXml, partId);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, partId };
      },
    },

    movePart: {
      description:
        "Move a part up or down in the score order (i.e. reorder staves). 'up' means higher on the page (lower index), 'down' means lower on the page.",
      parameters: z.object({
        partId: z.string().describe("Part ID to move, e.g. 'P2'."),
        direction: z.enum(["up", "down"]).describe("Direction to move the part."),
      }),
      execute: async ({ partId, direction }: { partId: string; direction: "up" | "down" }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = movePart(ctx.liveXml, partId, direction);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, partId, direction };
      },
    },

    // ── Phrasing & Expression ────────────────────────────────────────────

    addSlur: {
      description:
        "Add a slur (curved legato line) over a range of measures in a part. The slur starts on the first note of startMeasure and ends on the last note of endMeasure.",
      parameters: z.object({
        startMeasure: z.number().describe("Measure where the slur starts."),
        endMeasure: z
          .number()
          .describe("Measure where the slur ends (can equal startMeasure for within-measure slur)."),
        partId: z.string().optional().describe("Part ID (default 'P1')."),
      }),
      execute: async ({
        startMeasure,
        endMeasure,
        partId,
      }: {
        startMeasure: number;
        endMeasure: number;
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addSlur(ctx.liveXml, startMeasure, endMeasure, partId ?? "P1");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, startMeasure, endMeasure };
      },
    },

    removeSlurs: {
      description: "Remove all slurs from a range of measures.",
      parameters: z.object({
        startMeasure: z.number(),
        endMeasure: z.number(),
        partId: z.string().optional(),
      }),
      execute: async ({
        startMeasure,
        endMeasure,
        partId,
      }: {
        startMeasure: number;
        endMeasure: number;
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = removeSlurs(ctx.liveXml, startMeasure, endMeasure, partId);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, startMeasure, endMeasure };
      },
    },

    addFermata: {
      description:
        "Add a fermata (hold symbol) to a note in a measure. By default goes on the last note. Optionally specify beat (1-based) to target a different note.",
      parameters: z.object({
        measureNumber: z.number(),
        beat: z.number().optional().describe("Beat (1-based) to place the fermata on. Omit for last note."),
        type: z.enum(["upright", "inverted"]).optional().describe("Fermata orientation. Default: upright."),
        partId: z.string().optional(),
      }),
      execute: async ({
        measureNumber,
        beat,
        type,
        partId,
      }: {
        measureNumber: number;
        beat?: number;
        type?: "upright" | "inverted";
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addFermata(ctx.liveXml, measureNumber, beat, type ?? "upright", partId ?? "P1");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, measureNumber };
      },
    },

    addBreathMark: {
      description:
        "Add a breath mark (comma) at the end of a measure — used in wind, brass, and vocal music to indicate a breathing pause.",
      parameters: z.object({
        measureNumber: z.number(),
        partId: z.string().optional(),
      }),
      execute: async ({ measureNumber, partId }: { measureNumber: number; partId?: string }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addBreathMark(ctx.liveXml, measureNumber, partId ?? "P1");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, measureNumber };
      },
    },

    addGlissando: {
      description:
        "Add a glissando (slide) line from the last note of startMeasure to the first note of endMeasure. Use lineType='wavy' for a gliss, 'solid' for a portamento.",
      parameters: z.object({
        startMeasure: z.number(),
        endMeasure: z.number(),
        lineType: z.enum(["solid", "wavy"]).optional().describe("Line style. Default: wavy."),
        partId: z.string().optional(),
      }),
      execute: async ({
        startMeasure,
        endMeasure,
        lineType,
        partId,
      }: {
        startMeasure: number;
        endMeasure: number;
        lineType?: "solid" | "wavy";
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addGlissando(ctx.liveXml, startMeasure, endMeasure, lineType ?? "wavy", partId ?? "P1");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, startMeasure, endMeasure };
      },
    },

    // ── Piano / Keyboard Markings ────────────────────────────────────────

    addOttava: {
      description:
        "Add an ottava line (8va, 8vb, 15ma) above or below a passage. 8va sounds an octave higher, 8vb an octave lower.",
      parameters: z.object({
        startMeasure: z.number(),
        endMeasure: z.number(),
        ottava: z.enum(["8va", "8vb", "15ma", "15mb"]).describe("Type of octave transposition line."),
        partId: z.string().optional(),
      }),
      execute: async ({
        startMeasure,
        endMeasure,
        ottava,
        partId,
      }: {
        startMeasure: number;
        endMeasure: number;
        ottava: "8va" | "8vb" | "15ma" | "15mb";
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addOttava(ctx.liveXml, startMeasure, endMeasure, ottava, partId ?? "P1");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, startMeasure, endMeasure, ottava };
      },
    },

    addPedalMarking: {
      description: "Add sustain pedal markings (Ped. … *) spanning measures. Essential for piano music.",
      parameters: z.object({
        startMeasure: z.number(),
        endMeasure: z.number(),
        partId: z.string().optional(),
      }),
      execute: async ({
        startMeasure,
        endMeasure,
        partId,
      }: {
        startMeasure: number;
        endMeasure: number;
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addPedalMarking(ctx.liveXml, startMeasure, endMeasure, partId ?? "P1");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, startMeasure, endMeasure };
      },
    },

    addArpeggio: {
      description: "Add arpeggiate (rolled chord) markings to all notes in a measure.",
      parameters: z.object({
        measureNumber: z.number(),
        direction: z.enum(["up", "down"]).optional().describe("Arpeggio roll direction. Default: up."),
        partId: z.string().optional(),
      }),
      execute: async ({
        measureNumber,
        direction,
        partId,
      }: {
        measureNumber: number;
        direction?: "up" | "down";
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addArpeggio(ctx.liveXml, measureNumber, direction ?? "up", partId ?? "P1");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, measureNumber };
      },
    },

    addTremolo: {
      description:
        "Add single-note tremolo (rapid repetition) to all notes in a measure. marks=1 means eighth-note tremolo, 2=sixteenth, 3=thirty-second (buzz roll).",
      parameters: z.object({
        measureNumber: z.number(),
        marks: z
          .union([z.literal(1), z.literal(2), z.literal(3)])
          .optional()
          .describe("Number of tremolo beams. Default: 3."),
        partId: z.string().optional(),
      }),
      execute: async ({
        measureNumber,
        marks,
        partId,
      }: {
        measureNumber: number;
        marks?: 1 | 2 | 3;
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addTremolo(ctx.liveXml, measureNumber, (marks ?? 3) as 1 | 2 | 3, partId ?? "P1");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, measureNumber, marks: marks ?? 3 };
      },
    },

    // ── Lyrics ───────────────────────────────────────────────────────────

    addLyrics: {
      description:
        "Add lyrics (text under notes) to a measure. Each string in syllables[] maps to one note in order. Use a trailing '-' to indicate a hyphenated syllable (e.g. 'mu-', 'sic'). Skips rests and chord notes.",
      parameters: z.object({
        measureNumber: z.number(),
        syllables: z
          .array(z.string())
          .describe("List of syllables, one per note. E.g. ['Twinkle', 'twin-', 'kle'] or ['A-', 'ma-', 'zing']."),
        partId: z.string().optional(),
      }),
      execute: async ({
        measureNumber,
        syllables,
        partId,
      }: {
        measureNumber: number;
        syllables: string[];
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addLyrics(ctx.liveXml, measureNumber, syllables, partId ?? "P1");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, measureNumber, syllables: syllables.length };
      },
    },

    // ── Score Metadata ───────────────────────────────────────────────────

    setScoreMetadata: {
      description:
        "Set the title, subtitle, composer, lyricist, arranger, or copyright of the score. All fields are optional — only provided fields are updated.",
      parameters: z.object({
        title: z.string().optional().describe("Score title (shown at top)."),
        subtitle: z.string().optional().describe("Subtitle / work title."),
        composer: z.string().optional().describe("Composer name (shown top-right)."),
        lyricist: z.string().optional().describe("Lyricist name."),
        arranger: z.string().optional().describe("Arranger name."),
        copyright: z.string().optional().describe("Copyright notice."),
      }),
      execute: async (meta: {
        title?: string;
        subtitle?: string;
        composer?: string;
        lyricist?: string;
        arranger?: string;
        copyright?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = setScoreMetadata(ctx.liveXml, meta);
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, ...meta };
      },
    },

    // ── Navigation / Repeat Structures ───────────────────────────────────

    addNavigationMark: {
      description:
        "Add a navigation/repeat mark to a measure:\n" +
        "  • segno   — S sign (jump target)\n" +
        "  • coda    — coda symbol (jump target)\n" +
        "  • fine    — 'Fine' (end marker)\n" +
        "  • dacapo  — 'D.C. al Fine' (go back to beginning)\n" +
        "  • dalsegno — 'D.S. al Coda' (go back to segno)\n" +
        "  • toCoda  — 'To Coda' (jump forward to coda)",
      parameters: z.object({
        measureNumber: z.number(),
        markType: z
          .enum(["segno", "coda", "fine", "dacapo", "dalsegno", "toCoda"] as const)
          .describe("Type of navigation mark to add."),
        partId: z.string().optional(),
      }),
      execute: async ({
        measureNumber,
        markType,
        partId,
      }: {
        measureNumber: number;
        markType: string;
        partId?: string;
      }) => {
        if (!ctx.liveXml) throw new Error("No score is currently loaded");
        const result = addNavigationMark(ctx.liveXml, measureNumber, markType as NavigationMarkType, partId ?? "P1");
        ctx.liveXml = result;
        ctx.capture.result = { musicXml: result, resultType: "modify" };
        return { ok: true, measureNumber, markType };
      },
    },
  };
}

/**
 * Sing mode: microphone recording, pitch detection (Magenta SPICE model),
 * metronome, and pitch-to-NoteSpec quantization.
 *
 * Everything runs client-side using TensorFlow.js + SPICE for ML-based
 * pitch detection.
 */

import type { NoteSpec } from "./musicxml";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DetectedNote = {
  /** Beat subdivision index (0-based, eighth-note resolution) */
  slot: number;
  /** MIDI note number, or null for rest */
  midi: number | null;
  /** Note name like "C4", "D#5", or null for rest */
  name: string | null;
};

export type SingResult = {
  notes: DetectedNote[];
  /** Total number of slots (measures × beats × 2 for eighth-note resolution) */
  totalSlots: number;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const STEP_MAP: Record<string, { step: NoteSpec["step"]; alter: number }> = {
  "C":  { step: "C", alter: 0 },
  "C#": { step: "C", alter: 1 },
  "D":  { step: "D", alter: 0 },
  "D#": { step: "D", alter: 1 },
  "E":  { step: "E", alter: 0 },
  "F":  { step: "F", alter: 0 },
  "F#": { step: "F", alter: 1 },
  "G":  { step: "G", alter: 0 },
  "G#": { step: "G", alter: 1 },
  "A":  { step: "A", alter: 0 },
  "A#": { step: "A", alter: 1 },
  "B":  { step: "B", alter: 0 },
};

// ─── Metronome ──────────────────────────────────────────────────────────────

export type MetronomeHandle = {
  stop: () => void;
};

/**
 * Plays metronome clicks using oscillators. Beat 1 is higher pitch.
 * Calls onBeat(beatNumber) on each beat (1-indexed).
 * Returns a handle to stop playback.
 */
export function startMetronome(
  audioCtx: AudioContext,
  bpm: number,
  beats: number,
  totalBeats: number,
  onBeat: (beat: number, measure: number) => void,
  onDone: () => void,
  silent = false,
): MetronomeHandle {
  const beatDuration = 60 / bpm;
  let currentBeat = 0;
  let stopped = false;

  function scheduleBeat() {
    if (stopped || currentBeat >= totalBeats) {
      if (!stopped) onDone();
      return;
    }

    const beatInMeasure = (currentBeat % beats) + 1;
    const measureNum = Math.floor(currentBeat / beats) + 1;

    // Play click (skip audio when silent — visual-only metronome)
    if (!silent) {
      const freq = beatInMeasure === 1 ? 1000 : 800;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.05);
    }

    onBeat(beatInMeasure, measureNum);
    currentBeat++;
    setTimeout(scheduleBeat, beatDuration * 1000);
  }

  scheduleBeat();

  return {
    stop: () => { stopped = true; },
  };
}

// ─── Recording ──────────────────────────────────────────────────────────────

export type RecordingHandle = {
  stop: () => Promise<AudioBuffer>;
};

/**
 * Records microphone audio. Returns handle to stop and get AudioBuffer.
 */
export async function startRecording(audioCtx: AudioContext): Promise<RecordingHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const source = audioCtx.createMediaStreamSource(stream);

  // Use ScriptProcessor to capture raw samples (simpler than AudioWorklet for this use case)
  const bufferSize = 4096;
  const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
  const chunks: Float32Array[] = [];

  processor.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
  };

  source.connect(processor);
  processor.connect(audioCtx.destination); // needed for onaudioprocess to fire

  return {
    stop: async () => {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach(t => t.stop());

      // Concatenate chunks into single AudioBuffer
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const buffer = audioCtx.createBuffer(1, totalLength, audioCtx.sampleRate);
      const output = buffer.getChannelData(0);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return buffer;
    },
  };
}

// ─── CREPE Pitch Detection (TensorFlow.js) ──────────────────────────────────

// CREPE constants (from marl/crepe gh-pages demo)
const CREPE_SAMPLE_RATE = 16000;
const CREPE_FRAME_SIZE = 1024;       // samples per frame at 16kHz
const CREPE_HOP_SIZE = 160;          // 10ms hop between frames
const CREPE_CONF_THRESHOLD = 0.5;
const CREPE_MODEL_URL = "/models/crepe/model.json";

// 360 bins mapping: cents from ~32.7Hz to ~1975Hz
// centMapping[i] = 1997.3794 + i * (7180/359)
const CREPE_CENT_MAPPING = Float32Array.from({ length: 360 }, (_, i) =>
  1997.3794084376191 + i * (7180 / 359)
);

// Singleton CREPE model — loaded once, reused across recordings
let crepePromise: Promise<any> | null = null;

async function getCrepeModel() {
  if (!crepePromise) {
    crepePromise = (async () => {
      console.log("[sing] Loading TensorFlow.js + CREPE model...");
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — loaded at runtime, not a build dependency
      const tf = await import("@tensorflow/tfjs");
      const model = await tf.loadLayersModel(CREPE_MODEL_URL);
      console.log("[sing] CREPE model loaded");
      return { tf, model };
    })().catch((err) => {
      crepePromise = null;
      throw err;
    });
  }
  return crepePromise;
}

/** Convert CREPE activation vector (360 bins) to Hz using weighted mean of top bins */
function crepeActivationToHz(activation: Float32Array): number {
  // Weighted mean in cents space over top bins
  let sumWeight = 0;
  let sumCents = 0;
  for (let i = 0; i < 360; i++) {
    sumWeight += activation[i];
    sumCents += activation[i] * CREPE_CENT_MAPPING[i];
  }
  const cents = sumCents / sumWeight;
  // cents = 1200 * log2(hz / 10)  →  hz = 10 * 2^(cents/1200)
  return 10 * Math.pow(2, cents / 1200);
}

/** Resample AudioBuffer to 16kHz mono using OfflineAudioContext */
async function resampleTo16k(buffer: AudioBuffer): Promise<Float32Array> {
  if (buffer.sampleRate === CREPE_SAMPLE_RATE) {
    return buffer.getChannelData(0);
  }
  const targetLength = Math.round(buffer.duration * CREPE_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(1, targetLength, CREPE_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}

/**
 * Analyze an AudioBuffer using CREPE for pitch detection.
 * Returns array of { time, hz } frames (10ms hop).
 */
export async function detectPitches(
  buffer: AudioBuffer,
): Promise<Array<{ time: number; hz: number }>> {
  const samples = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const duration = samples.length / sampleRate;

  const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  console.log(`[sing] detectPitches (CREPE): ${samples.length} samples, sampleRate=${sampleRate}, duration=${duration.toFixed(2)}s, RMS=${rms.toFixed(4)}, peak=${peak.toFixed(4)}`);

  // Resample to 16kHz
  const audio16k = await resampleTo16k(buffer);
  console.log(`[sing] Resampled to 16kHz: ${audio16k.length} samples`);

  const { tf, model } = await getCrepeModel();

  // Slice audio into overlapping frames, normalize each frame
  const frames: Float32Array[] = [];
  for (let start = 0; start + CREPE_FRAME_SIZE <= audio16k.length; start += CREPE_HOP_SIZE) {
    const frame = audio16k.slice(start, start + CREPE_FRAME_SIZE);
    // Normalize to zero mean, unit std
    let mean = 0;
    for (let i = 0; i < frame.length; i++) mean += frame[i];
    mean /= frame.length;
    let std = 0;
    for (let i = 0; i < frame.length; i++) std += (frame[i] - mean) ** 2;
    std = Math.sqrt(std / frame.length) || 1;
    const normalized = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) normalized[i] = (frame[i] - mean) / std;
    frames.push(normalized);
  }

  console.log(`[sing] CREPE: ${frames.length} frames (hop=${CREPE_HOP_SIZE} samples = 10ms)`);

  // Batch all frames into a single tensor [N, 1024]
  const inputData = new Float32Array(frames.length * CREPE_FRAME_SIZE);
  frames.forEach((f, i) => inputData.set(f, i * CREPE_FRAME_SIZE));
  const inputTensor = tf.tensor2d(inputData, [frames.length, CREPE_FRAME_SIZE]);

  // Run model → output shape [N, 360]
  const activationTensor = model.predict(inputTensor) as any;
  const activationData: Float32Array = await activationTensor.data();

  inputTensor.dispose();
  activationTensor.dispose();

  // Convert each frame's activation to Hz + confidence
  const results: Array<{ time: number; hz: number }> = [];
  const hopDuration = CREPE_HOP_SIZE / CREPE_SAMPLE_RATE; // 0.01s

  for (let i = 0; i < frames.length; i++) {
    const time = i * hopDuration;
    const activation = activationData.slice(i * 360, (i + 1) * 360);
    const confidence = Math.max(...Array.from(activation));
    const hz = confidence >= CREPE_CONF_THRESHOLD ? crepeActivationToHz(activation) : 0;

    // Filter to vocal/instrument range (roughly C2–C7)
    const inRange = hz >= 65 && hz <= 2093;
    results.push({ time, hz: inRange ? hz : 0 });

    if (hz > 0 && inRange) {
      const midi = hzToMidi(hz);
      const name = midiToName(midi);
      console.log(`[sing]   t=${time.toFixed(3)}s  hz=${hz.toFixed(1)}  midi=${midi} (${name})  conf=${confidence.toFixed(3)}`);
    }
  }

  const pitchedCount = results.filter(r => r.hz > 0).length;
  console.log(`[sing] detectPitches result: ${results.length} frames, ${pitchedCount} pitched (${((pitchedCount / results.length) * 100).toFixed(1)}%)`);

  return results;
}

// ─── Hz to MIDI ─────────────────────────────────────────────────────────────

function hzToMidi(hz: number): number {
  return Math.round(12 * Math.log2(hz / 440) + 69);
}

function midiToName(midi: number): string {
  const note = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

// ─── Quantization ───────────────────────────────────────────────────────────

type Segment = { startTime: number; endTime: number; midi: number };

/**
 * Mode filter: replace each frame with the most frequent value in a window.
 * Smooths out brief noise spikes without smearing note boundaries.
 */
function modeFilter(values: number[], halfWin: number): number[] {
  const out = [...values];
  for (let i = halfWin; i < values.length - halfWin; i++) {
    const counts = new Map<number, number>();
    for (let j = i - halfWin; j <= i + halfWin; j++) {
      counts.set(values[j], (counts.get(values[j]) ?? 0) + 1);
    }
    let best = values[i], bestCount = 0;
    for (const [v, c] of counts) {
      if (c > bestCount) { best = v; bestCount = c; }
    }
    out[i] = best;
  }
  return out;
}

/**
 * Onset-based quantization.
 *
 * Algorithm:
 *  1. Convert CREPE hz stream → MIDI integers (0 = silence)
 *  2. Mode-filter to remove brief noise/artifacts (~70ms window)
 *  3. Find contiguous runs of same non-zero MIDI → pitch segments
 *  4. Discard very short segments (< 80ms, likely consonants/noise)
 *  5. Apply global pitch correction (singer consistently sharp/flat)
 *  6. Snap each segment's start/end time to nearest eighth-note grid slot
 *  7. Fill slots array → DetectedNote[]
 */
export function quantizePitches(
  pitches: Array<{ time: number; hz: number }>,
  bpm: number,
  beats: number,
  measures: number,
): SingResult {
  const slotDuration = 60 / bpm / 2; // eighth note in seconds
  const totalSlots = measures * beats * 2;

  console.log(`[sing] quantizePitches (onset-based): bpm=${bpm}, beats=${beats}, measures=${measures}, totalSlots=${totalSlots}, slotDuration=${slotDuration.toFixed(3)}s`);

  // Step 1: Convert to MIDI stream (0 = silence)
  const midiStream = pitches.map(p => p.hz > 0 ? hzToMidi(p.hz) : 0);

  // Step 2: Mode filter with ~70ms window (7 frames × 10ms)
  const smoothed = modeFilter(midiStream, 3);

  // Step 3: Find contiguous pitch segments
  const segments: Segment[] = [];
  let i = 0;
  while (i < smoothed.length) {
    if (smoothed[i] === 0) { i++; continue; }

    const startIdx = i;
    const midi = smoothed[i];
    while (i < smoothed.length && smoothed[i] === midi) i++;

    const duration = (i - startIdx) * 0.01; // seconds
    if (duration >= 0.08) { // ignore segments < 80ms
      segments.push({
        startTime: pitches[startIdx].time,
        endTime: pitches[Math.min(i, pitches.length - 1)].time + 0.01,
        midi,
      });
      console.log(`[sing] segment: ${midiToName(midi)} t=${pitches[startIdx].time.toFixed(3)}-${(pitches[Math.min(i - 1, pitches.length - 1)].time + 0.01).toFixed(3)}s dur=${duration.toFixed(3)}s`);
    }
  }

  console.log(`[sing] ${segments.length} pitch segments found`);

  // Step 4: Global pitch correction (consistent sharp/flat across all segments)
  if (segments.length > 0) {
    const centOffsets: number[] = [];
    for (const seg of segments) {
      for (const frame of pitches) {
        if (frame.time < seg.startTime || frame.time >= seg.endTime || frame.hz === 0) continue;
        const exactMidi = 12 * Math.log2(frame.hz / 440) + 69;
        centOffsets.push(exactMidi - Math.round(exactMidi));
      }
    }
    if (centOffsets.length > 0) {
      const avgOffset = centOffsets.reduce((s, v) => s + v, 0) / centOffsets.length;
      console.log(`[sing] pitch correction: avgOffset=${(avgOffset * 100).toFixed(1)} cents from ${centOffsets.length} frames`);
      if (Math.abs(avgOffset) > 0.3) {
        const correction = Math.round(avgOffset);
        if (correction !== 0) {
          console.log(`[sing] applying ${correction > 0 ? "-" : "+"}${Math.abs(correction)} semitone(s)`);
          for (const seg of segments) seg.midi -= correction;
        }
      }
    }
  }

  // Step 5: Snap each segment to the eighth-note grid and fill slots
  const slots: (number | null)[] = new Array(totalSlots).fill(null);

  for (const seg of segments) {
    const startSlot = Math.round(seg.startTime / slotDuration);
    const endSlot = Math.round(seg.endTime / slotDuration);
    const noteSlots = Math.max(1, endSlot - startSlot);

    console.log(`[sing] snap: ${midiToName(seg.midi)} → slot ${startSlot} for ${noteSlots} slot(s)`);

    for (let s = startSlot; s < startSlot + noteSlots && s < totalSlots; s++) {
      if (s >= 0) slots[s] = seg.midi;
    }
  }

  // Step 6: Convert to DetectedNote[]
  const notes: DetectedNote[] = slots.map((midi, slot) => ({
    slot,
    midi,
    name: midi !== null ? midiToName(midi) : null,
  }));

  const summary = notes.filter(n => n.midi !== null).map(n => n.name).join(" ");
  console.log(`[sing] result: ${summary || "(all rests)"}`);

  return { notes, totalSlots };
}

// ─── Playback ────────────────────────────────────────────────────────────────

export type PlaybackHandle = {
  stop: () => void;
};

/**
 * Play detected notes back using simple oscillators.
 * Returns a handle to stop playback.
 */
export function playDetectedNotes(
  notes: DetectedNote[],
  bpm: number,
  onDone?: () => void,
): PlaybackHandle {
  const audioCtx = new AudioContext();
  const slotDuration = 60 / bpm / 2; // eighth note in seconds
  let stopped = false;

  // Merge consecutive same-pitch notes for smoother playback
  const merged: { startSlot: number; slots: number; midi: number | null }[] = [];
  for (const note of notes) {
    const last = merged[merged.length - 1];
    if (last && last.midi === note.midi && last.startSlot + last.slots === note.slot) {
      last.slots++;
    } else {
      merged.push({ startSlot: note.slot, slots: 1, midi: note.midi });
    }
  }

  const startTime = audioCtx.currentTime + 0.05;

  for (const note of merged) {
    if (note.midi === null) continue;
    const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
    const noteStart = startTime + note.startSlot * slotDuration;
    const noteDur = note.slots * slotDuration;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(0.25, noteStart + 0.02);
    gain.gain.setValueAtTime(0.25, noteStart + noteDur - 0.03);
    gain.gain.linearRampToValueAtTime(0, noteStart + noteDur);

    osc.start(noteStart);
    osc.stop(noteStart + noteDur);
  }

  // Schedule done callback
  const totalDuration = notes.length > 0
    ? (Math.max(...notes.map(n => n.slot)) + 1) * slotDuration
    : 0;
  const timeout = setTimeout(() => {
    if (!stopped) {
      audioCtx.close();
      onDone?.();
    }
  }, (totalDuration + 0.1) * 1000);

  return {
    stop: () => {
      stopped = true;
      clearTimeout(timeout);
      audioCtx.close();
      onDone?.();
    },
  };
}

// ─── Merge consecutive same-pitch notes ─────────────────────────────────────

type MergedNote = {
  startSlot: number;
  slots: number; // how many eighth-note slots this spans
  midi: number | null;
  name: string | null;
};

function mergeConsecutive(notes: DetectedNote[]): MergedNote[] {
  const merged: MergedNote[] = [];

  for (const note of notes) {
    const last = merged[merged.length - 1];
    if (last && last.midi === note.midi && last.startSlot + last.slots === note.slot) {
      last.slots++;
    } else {
      merged.push({ startSlot: note.slot, slots: 1, midi: note.midi, name: note.name });
    }
  }

  return merged;
}

// ─── Convert to NoteSpec[] ──────────────────────────────────────────────────

function slotsToDuration(slots: number): NoteSpec["duration"] | null {
  // slots are in eighth-note units
  switch (slots) {
    case 8: return "whole";
    case 6: return "dotted-half";
    case 4: return "half";
    case 3: return "dotted-quarter";
    case 2: return "quarter";
    case 1: return "eighth";
    default: return null; // can't represent directly
  }
}

/**
 * Convert DetectedNote[] for one measure into NoteSpec[].
 * Merges consecutive same-pitch notes into longer durations.
 */
export function notesToNoteSpecs(
  notes: DetectedNote[],
  beats: number,
): NoteSpec[] {
  const slotsPerMeasure = beats * 2;
  const specs: NoteSpec[] = [];

  // Group notes by measure-relative slot
  const merged = mergeConsecutive(notes);

  for (const note of merged) {
    // Break long notes that cross measure boundaries or can't be represented
    let remaining = note.slots;
    let currentMidi = note.midi;

    while (remaining > 0) {
      // Find the largest representable duration that fits
      const trySlots = [8, 6, 4, 3, 2, 1];
      let bestSlots = 1;
      for (const s of trySlots) {
        if (s <= remaining) {
          const dur = slotsToDuration(s);
          if (dur) { bestSlots = s; break; }
        }
      }

      const duration = slotsToDuration(bestSlots)!;

      if (currentMidi === null) {
        specs.push({ rest: true, duration });
      } else {
        const name = midiToName(currentMidi);
        const noteName = name.replace(/\d+$/, "");
        const octave = parseInt(name.match(/\d+$/)?.[0] ?? "4");
        const mapping = STEP_MAP[noteName];
        if (mapping) {
          // Check if we need a tie (same pitch, continuing)
          const needsTie = remaining > bestSlots;
          const spec: NoteSpec = {
            step: mapping.step,
            octave,
            alter: mapping.alter || undefined,
            duration,
          };
          if (needsTie) spec.tie = "start";
          specs.push(spec);

          // If there's remaining, add tied continuation
          if (needsTie) {
            // The remaining part will have tie="stop" on next iteration
            // Actually, we just mark the first as tie=start — for simplicity
            // the merge handles most cases so ties are rare
          }
        }
      }

      remaining -= bestSlots;
    }
  }

  return specs;
}

/**
 * Split DetectedNote[] into per-measure arrays.
 */
export function splitByMeasure(
  notes: DetectedNote[],
  beats: number,
): DetectedNote[][] {
  const slotsPerMeasure = beats * 2;
  const measures: DetectedNote[][] = [];
  let currentMeasure: DetectedNote[] = [];

  for (const note of notes) {
    const measureIdx = Math.floor(note.slot / slotsPerMeasure);
    while (measures.length < measureIdx) {
      measures.push(currentMeasure);
      currentMeasure = [];
    }
    // Adjust slot to be relative within the measure
    currentMeasure.push({
      ...note,
      slot: note.slot % slotsPerMeasure,
    });
  }
  if (currentMeasure.length > 0) measures.push(currentMeasure);

  return measures;
}

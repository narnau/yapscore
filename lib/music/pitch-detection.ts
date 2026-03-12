/**
 * CREPE-based pitch detection using TensorFlow.js.
 *
 * Pure domain logic: model loading, tensor operations, Hz-to-note conversion.
 * No UI or recording logic — consumed by SingModal via sing.ts.
 */

import {
  SEMITONES_PER_OCTAVE,
  A4_MIDI_NUMBER,
  A4_FREQUENCY_HZ,
  VOCAL_RANGE_MIN_HZ,
  VOCAL_RANGE_MAX_HZ,
} from "./constants";

// ─── CREPE constants ────────────────────────────────────────────────────────

const CREPE_SAMPLE_RATE = 16000;
const CREPE_FRAME_SIZE = 1024;
const CREPE_HOP_SIZE = 160; // 10ms hop between frames
const CREPE_CONF_THRESHOLD = 0.5;
const CREPE_MODEL_URL = "/models/crepe/model.json";

// 360 bins mapping: cents from ~32.7Hz to ~1975Hz
const CREPE_CENT_MAPPING = Float32Array.from({ length: 360 }, (_, i) =>
  1997.3794084376191 + i * (7180 / 359)
);

// ─── Hz / MIDI conversion ───────────────────────────────────────────────────

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function hzToMidi(hz: number): number {
  return Math.round(SEMITONES_PER_OCTAVE * Math.log2(hz / A4_FREQUENCY_HZ) + A4_MIDI_NUMBER);
}

export function midiToName(midi: number): string {
  const note = NOTE_NAMES[midi % SEMITONES_PER_OCTAVE];
  const octave = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
  return `${note}${octave}`;
}

// ─── Singleton CREPE model ──────────────────────────────────────────────────

let crepePromise: Promise<{ tf: any; model: any }> | null = null;

async function getCrepeModel() {
  if (!crepePromise) {
    crepePromise = (async () => {
      if (process.env.NODE_ENV === "development") {
        console.log("[sing] Loading TensorFlow.js + CREPE model...");
      }
      // @ts-ignore — loaded at runtime, not a build dependency
      const tf = await import("@tensorflow/tfjs");
      const model = await tf.loadLayersModel(CREPE_MODEL_URL);
      if (process.env.NODE_ENV === "development") {
        console.log("[sing] CREPE model loaded");
      }
      return { tf, model };
    })().catch((err) => {
      crepePromise = null;
      throw err;
    });
  }
  return crepePromise;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Convert CREPE activation vector (360 bins) to Hz using weighted mean of top bins */
function crepeActivationToHz(activation: Float32Array): number {
  let sumWeight = 0;
  let sumCents = 0;
  for (let i = 0; i < 360; i++) {
    sumWeight += activation[i];
    sumCents += activation[i] * CREPE_CENT_MAPPING[i];
  }
  const cents = sumCents / sumWeight;
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

// ─── Public API ─────────────────────────────────────────────────────────────

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
  if (process.env.NODE_ENV === "development") {
    console.log(`[sing] detectPitches (CREPE): ${samples.length} samples, sampleRate=${sampleRate}, duration=${duration.toFixed(2)}s, RMS=${rms.toFixed(4)}, peak=${peak.toFixed(4)}`);
  }

  // Resample to 16kHz
  const audio16k = await resampleTo16k(buffer);
  if (process.env.NODE_ENV === "development") {
    console.log(`[sing] Resampled to 16kHz: ${audio16k.length} samples`);
  }

  const { tf, model } = await getCrepeModel();

  // Slice audio into overlapping frames, normalize each frame
  const frames: Float32Array[] = [];
  for (let start = 0; start + CREPE_FRAME_SIZE <= audio16k.length; start += CREPE_HOP_SIZE) {
    const frame = audio16k.slice(start, start + CREPE_FRAME_SIZE);
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

  if (process.env.NODE_ENV === "development") {
    console.log(`[sing] CREPE: ${frames.length} frames (hop=${CREPE_HOP_SIZE} samples = 10ms)`);
  }

  // Batch all frames into a single tensor [N, 1024]
  const inputData = new Float32Array(frames.length * CREPE_FRAME_SIZE);
  frames.forEach((f, i) => inputData.set(f, i * CREPE_FRAME_SIZE));
  const inputTensor = tf.tensor2d(inputData, [frames.length, CREPE_FRAME_SIZE]);

  // Run model -> output shape [N, 360]
  const activationTensor = model.predict(inputTensor) as any;
  const activationData: Float32Array = await activationTensor.data();

  inputTensor.dispose();
  activationTensor.dispose();

  // Convert each frame's activation to Hz + confidence
  const results: Array<{ time: number; hz: number }> = [];
  const hopDuration = CREPE_HOP_SIZE / CREPE_SAMPLE_RATE;

  for (let i = 0; i < frames.length; i++) {
    const time = i * hopDuration;
    const activation = activationData.slice(i * 360, (i + 1) * 360);
    const confidence = Math.max(...Array.from(activation));
    const hz = confidence >= CREPE_CONF_THRESHOLD ? crepeActivationToHz(activation) : 0;

    const inRange = hz >= VOCAL_RANGE_MIN_HZ && hz <= VOCAL_RANGE_MAX_HZ;
    results.push({ time, hz: inRange ? hz : 0 });

    if (process.env.NODE_ENV === "development" && hz > 0 && inRange) {
      const midi = hzToMidi(hz);
      const name = midiToName(midi);
      console.log(`[sing]   t=${time.toFixed(3)}s  hz=${hz.toFixed(1)}  midi=${midi} (${name})  conf=${confidence.toFixed(3)}`);
    }
  }

  const pitchedCount = results.filter(r => r.hz > 0).length;
  if (process.env.NODE_ENV === "development") {
    console.log(`[sing] detectPitches result: ${results.length} frames, ${pitchedCount} pitched (${((pitchedCount / results.length) * 100).toFixed(1)}%)`);
  }

  return results;
}

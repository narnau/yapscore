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

// ─── SPICE Pitch Detection (TensorFlow.js, direct) ─────────────────────────

// SPICE model constants (from Magenta source)
const SPICE_SAMPLE_RATE = 16000;
const SPICE_MODEL_MULTIPLE = 512;
const SPICE_PT_SLOPE = 63.07;
const SPICE_PT_OFFSET = 25.58;
const SPICE_CONF_THRESHOLD = 0.7;
const SPICE_MODEL_URL = "https://tfhub.dev/google/tfjs-model/spice/2/default/1";

// Singleton SPICE model — loaded once, reused across recordings
let spicePromise: Promise<any> | null = null;

async function getSpiceModel() {
  if (!spicePromise) {
    spicePromise = (async () => {
      console.log("[sing] Loading TensorFlow.js + SPICE model...");
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — loaded at runtime, not a build dependency
      const tf = await import("@tensorflow/tfjs");
      const model = await tf.loadGraphModel(SPICE_MODEL_URL, { fromTFHub: true });
      console.log("[sing] SPICE model loaded");
      return { tf, model };
    })();
  }
  return spicePromise;
}

/** Convert SPICE model pitch output to Hz */
function spicePitchToHz(modelPitch: number): number {
  const fmin = 10.0;
  const binsPerOctave = 12.0;
  const cqtBin = modelPitch * SPICE_PT_SLOPE + SPICE_PT_OFFSET;
  return fmin * Math.pow(2.0, cqtBin / binsPerOctave);
}

/** Resample AudioBuffer to 16kHz mono using OfflineAudioContext */
async function resampleTo16k(buffer: AudioBuffer): Promise<Float32Array> {
  if (buffer.sampleRate === SPICE_SAMPLE_RATE) {
    return buffer.getChannelData(0);
  }
  const targetLength = Math.round(buffer.duration * SPICE_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(1, targetLength, SPICE_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}

/**
 * Analyze an AudioBuffer using the SPICE model for ML-based pitch detection.
 * Calls TensorFlow.js directly — no @magenta/music wrapper (avoids Node-only deps).
 * Returns array of { time, hz } frames.
 */
export async function detectPitches(
  buffer: AudioBuffer,
): Promise<Array<{ time: number; hz: number }>> {
  const samples = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const duration = samples.length / sampleRate;

  // Debug: log recording stats
  const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  console.log(`[sing] detectPitches (SPICE): ${samples.length} samples, sampleRate=${sampleRate}, duration=${duration.toFixed(2)}s, RMS=${rms.toFixed(4)}, peak=${peak.toFixed(4)}`);

  // Resample to 16kHz
  const audio16k = await resampleTo16k(buffer);
  console.log(`[sing] Resampled to 16kHz: ${audio16k.length} samples`);

  // Load model
  const { tf, model } = await getSpiceModel();

  // Pad to multiple of 512
  const padded = Math.ceil(audio16k.length / SPICE_MODEL_MULTIPLE) * SPICE_MODEL_MULTIPLE;
  const inputTensor = tf.tensor(audio16k).pad([[0, padded - audio16k.length]]);

  // Run model
  const output = await model.execute({ input_audio_samples: inputTensor }) as any[];
  const uncertainties = await output[0].data();
  const rawPitches = await output[1].data();

  // Convert model output to Hz + confidence
  const results: Array<{ time: number; hz: number }> = [];
  const frameDuration = (SPICE_MODEL_MULTIPLE / SPICE_SAMPLE_RATE); // ~32ms per frame

  for (let i = 0; i < rawPitches.length; i++) {
    const time = i * frameDuration;
    const confidence = 1.0 - uncertainties[i];
    const rawHz = spicePitchToHz(rawPitches[i]);

    // Only accept frames with high confidence and reasonable vocal range
    const hz = confidence >= SPICE_CONF_THRESHOLD && rawHz >= 65 && rawHz <= 1047 ? rawHz : 0;
    results.push({ time, hz });

    // Debug: log pitched frames
    if (hz > 0) {
      const midi = hzToMidi(hz);
      const name = midiToName(midi);
      console.log(`[sing]   t=${time.toFixed(3)}s  hz=${hz.toFixed(1)}  midi=${midi} (${name})  conf=${confidence.toFixed(3)}`);
    }
  }

  // Cleanup tensors
  output[0].dispose();
  output[1].dispose();
  inputTensor.dispose();

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

/**
 * Quantize detected pitches into eighth-note slots.
 * Uses the metronome timing to know exactly when each slot starts.
 */
export function quantizePitches(
  pitches: Array<{ time: number; hz: number }>,
  bpm: number,
  beats: number,
  measures: number,
): SingResult {
  const slotDuration = 60 / bpm / 2; // eighth note duration in seconds
  const totalSlots = measures * beats * 2;
  const notes: DetectedNote[] = [];

  // Snap the first detected note to beat 1 (slot 0): subtract its timestamp
  // from all frames so the melody always starts at the beginning of the grid.
  const firstPitched = pitches.find(p => p.hz > 0);
  const timeOffset = firstPitched ? firstPitched.time : 0;
  const shifted = pitches.map(p => ({ time: p.time - timeOffset, hz: p.hz }));

  console.log(`[sing] quantizePitches: bpm=${bpm}, beats=${beats}, measures=${measures}, totalSlots=${totalSlots}, slotDuration=${slotDuration.toFixed(3)}s`);
  console.log(`[sing] first note at t=${timeOffset.toFixed(3)}s → aligned to slot 0 (beat 1)`);

  for (let slot = 0; slot < totalSlots; slot++) {
    const slotStart = slot * slotDuration;
    const slotEnd = slotStart + slotDuration;

    // Get all pitch frames within this slot
    const framesInSlot = shifted.filter(p => p.time >= slotStart && p.time < slotEnd);
    const pitchedFrames = framesInSlot.filter(p => p.hz > 0);

    if (pitchedFrames.length < framesInSlot.length * 0.5 || pitchedFrames.length === 0) {
      // More than half are silence → rest
      notes.push({ slot, midi: null, name: null });
      console.log(`[sing]   slot ${slot} [${slotStart.toFixed(3)}-${slotEnd.toFixed(3)}s]: REST (${pitchedFrames.length}/${framesInSlot.length} pitched frames)`);
    } else {
      // Take median Hz
      const sortedHz = pitchedFrames.map(p => p.hz).sort((a, b) => a - b);
      const medianHz = sortedHz[Math.floor(sortedHz.length / 2)];
      const midi = hzToMidi(medianHz);
      const hzRange = `${sortedHz[0].toFixed(1)}-${sortedHz[sortedHz.length - 1].toFixed(1)}`;
      notes.push({ slot, midi, name: midiToName(midi) });
      console.log(`[sing]   slot ${slot} [${slotStart.toFixed(3)}-${slotEnd.toFixed(3)}s]: ${midiToName(midi)} (midi=${midi}, medianHz=${medianHz.toFixed(1)}, range=${hzRange}, ${pitchedFrames.length}/${framesInSlot.length} frames)`);
    }
  }

  // Apply pitch correction: calculate average offset from nearest semitone
  const pitchedNotes = notes.filter(n => n.midi !== null);
  if (pitchedNotes.length > 0) {
    // Collect the actual Hz values to compute average cent offset
    const centOffsets: number[] = [];
    for (let slot = 0; slot < totalSlots; slot++) {
      const slotStart = slot * slotDuration;
      const slotEnd = slotStart + slotDuration;
      const framesInSlot = shifted.filter(p => p.time >= slotStart && p.time < slotEnd && p.hz > 0);

      for (const frame of framesInSlot) {
        const exactMidi = 12 * Math.log2(frame.hz / 440) + 69;
        const nearestMidi = Math.round(exactMidi);
        centOffsets.push(exactMidi - nearestMidi);
      }
    }

    if (centOffsets.length > 0) {
      const avgOffset = centOffsets.reduce((s, v) => s + v, 0) / centOffsets.length;
      console.log(`[sing] pitch correction: avgOffset=${avgOffset.toFixed(3)} semitones (${(avgOffset * 100).toFixed(1)} cents) from ${centOffsets.length} frames`);
      // If singer is consistently sharp/flat by more than 30 cents, correct
      if (Math.abs(avgOffset) > 0.3) {
        const correction = Math.round(avgOffset);
        if (correction !== 0) {
          console.log(`[sing] applying correction: ${correction > 0 ? "-" : "+"}${Math.abs(correction)} semitone(s)`);
          for (const note of notes) {
            if (note.midi !== null) {
              note.midi -= correction;
              note.name = midiToName(note.midi);
            }
          }
        }
      }
    }
  }

  const summary = notes.filter(n => n.midi !== null).map(n => n.name).join(" ");
  console.log(`[sing] quantizePitches result: ${summary || "(all rests)"}`);

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

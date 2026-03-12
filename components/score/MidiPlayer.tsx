"use client";

import { useEffect, useRef, useState } from "react";
import MidiPlayer from "midi-player-js";

type State = "loading" | "ready" | "playing" | "stopped";

// soundfont-player returns a node with a .stop(when?) method
type SfNode = { stop: (when?: number) => void };

// Local type extension for midi-player-js Player (avoids `as any` casts)
type MidiPlayerExtended = MidiPlayer.Player & {
  division?: number;
  tempo?: number;
};

type Props = {
  src: string;
  channelInstruments?: Record<number, string>; // MIDI channel → soundfont name
  measureStartsMs: number[]; // ms timestamp of each measure start (from Verovio timemap)
  selectedMeasures: Set<number>;
  playFromMeasure?: number; // overrides selectedMeasures start (e.g. for note selection)
  onMeasureChange: (measure: number | null) => void;
};

// Named constants for magic numbers
const DEFAULT_MIDI_DIVISION = 480;
const DEFAULT_PLAYBACK_BPM = 120;
const NOTE_RELEASE_SECONDS = 0.15;

// ── WebAudioFont drum samples (FluidR3 GM, bank 128) ─────────────────────────
// Each GM drum note has its own JS file: base64 MP3 data inside `file:'...'`.
const DRUM_NOTES = [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 57, 59];
const WAF_BASE = "https://surikov.github.io/webaudiofontdata/sound";

async function loadDrumSamples(ctx: AudioContext): Promise<Map<number, AudioBuffer>> {
  const map = new Map<number, AudioBuffer>();
  await Promise.all(
    DRUM_NOTES.map(async (note) => {
      try {
        const url = `${WAF_BASE}/128${note}_0_FluidR3_GM_sf2_file.js`;
        const res = await fetch(url);
        if (!res.ok) {
          if (process.env.NODE_ENV === "development") console.warn(`[drums] HTTP ${res.status} for note ${note}`);
          return;
        }
        const text = await res.text();
        const match = text.match(/file:'([^']+)'/);
        if (!match) {
          if (process.env.NODE_ENV === "development") console.warn(`[drums] no file field for note ${note}`);
          return;
        }
        const binary = atob(match[1]);
        const ab = new ArrayBuffer(binary.length);
        const view = new Uint8Array(ab);
        for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
        map.set(note, await ctx.decodeAudioData(ab));
      } catch (e) {
        if (process.env.NODE_ENV === "development") console.warn(`[drums] failed note ${note}:`, e);
      }
    }),
  );
  if (process.env.NODE_ENV === "development") console.log(`[drums] loaded ${map.size}/${DRUM_NOTES.length} samples`);
  return map;
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Web Audio drum synthesizer (GM channel 10) ────────────────────────────────
function playDrumSynth(ctx: AudioContext, noteNumber: number, velocity: number) {
  const now = ctx.currentTime;
  const v = Math.max(0.001, velocity); // 0..1, avoid zero

  // Create a white-noise BufferSource node
  function makeNoise(duration: number): AudioBufferSourceNode {
    const len = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  // Wire: source → (optional filter) → gainNode(with envelope) → destination, then start/stop
  function play(
    source: AudioScheduledSourceNode,
    filter: AudioNode | null,
    peak: number,
    decay: number,
    startDelay = 0,
  ) {
    const g = ctx.createGain();
    const t = now + startDelay;
    g.gain.setValueAtTime(peak * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    const chain = filter ?? source;
    if (filter) source.connect(filter);
    (filter ?? source).connect(g);
    // suppress TS "possibly null" — chain is always AudioNode
    void chain;
    g.connect(ctx.destination);
    (source as AudioScheduledSourceNode).start(t);
    (source as AudioScheduledSourceNode).stop(t + decay + 0.01);
  }

  // TR-808-inspired metallic oscillator bank: 6 square waves at inharmonic ratios
  // routed through a filter → masterGain (avoids creating N gain nodes)
  function metalBank(freqs: number[], filter: BiquadFilterNode, peak: number, decay: number) {
    const masterG = ctx.createGain();
    masterG.gain.setValueAtTime(peak * v, now);
    masterG.gain.exponentialRampToValueAtTime(0.001, now + decay);
    filter.connect(masterG);
    masterG.connect(ctx.destination);
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 1 / freqs.length; // equal mix
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      osc.stop(now + decay + 0.01);
    }
  }

  // ── Kick (35=Acoustic Bass Drum, 36=Bass Drum 1) ──────────────────────────
  if (noteNumber === 35 || noteNumber === 36) {
    // Sub layer: sine 60 Hz → 30 Hz with tanh soft-clip
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(60, now);
    sub.frequency.exponentialRampToValueAtTime(30, now + 0.5);
    const dist = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 255 - 1;
      curve[i] = Math.tanh(2.5 * x);
    }
    dist.curve = curve;
    sub.connect(dist);
    play(sub, dist, 1.4, 0.5);

    // Punch: mid-freq sine with fast pitch drop
    const punch = ctx.createOscillator();
    punch.type = "sine";
    punch.frequency.setValueAtTime(200, now);
    punch.frequency.exponentialRampToValueAtTime(55, now + 0.06);
    play(punch, null, 0.9, 0.07);
    return;
  }

  // ── Snare (38=Acoustic Snare, 40=Electric Snare) ─────────────────────────
  if (noteNumber === 38 || noteNumber === 40) {
    // Tonal body
    const tone = ctx.createOscillator();
    tone.type = "triangle";
    tone.frequency.setValueAtTime(210, now);
    tone.frequency.exponentialRampToValueAtTime(160, now + 0.12);
    play(tone, null, 0.75, 0.15);

    // Crack noise (highpass > 2 kHz)
    const crack = makeNoise(0.25);
    const crackHp = ctx.createBiquadFilter();
    crackHp.type = "highpass";
    crackHp.frequency.value = 2000;
    crack.connect(crackHp);
    play(crack, crackHp, 1.0, 0.22);

    // Snare rattle: bandpass ~4 kHz, slight attack delay
    const rattle = makeNoise(0.25);
    const rattleBp = ctx.createBiquadFilter();
    rattleBp.type = "bandpass";
    rattleBp.frequency.value = 4000;
    rattleBp.Q.value = 0.6;
    rattle.connect(rattleBp);
    play(rattle, rattleBp, 0.5, 0.2, 0.008);
    return;
  }

  // ── Hi-hats: TR-808 6-oscillator metallic bank ────────────────────────────
  // Frequencies derived from measured 808 ratios (inharmonic)
  const HH_FREQS = [205, 287, 365, 522, 630, 800];

  if (noteNumber === 42 || noteNumber === 44) {
    // Closed / Pedal hi-hat
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    metalBank(HH_FREQS, hp, 0.55, 0.07);
    return;
  }

  if (noteNumber === 46) {
    // Open hi-hat
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6500;
    metalBank(HH_FREQS, hp, 0.5, 0.45);
    return;
  }

  // ── Crash cymbal (49=Crash 1, 57=Crash 2) ────────────────────────────────
  if (noteNumber === 49 || noteNumber === 57) {
    const CRASH_FREQS = [181, 251, 333, 445, 596, 790];
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3500;
    metalBank(CRASH_FREQS, hp, 0.55, 2.0);

    // Noise shimmer layer
    const shimmer = makeNoise(2.0);
    const shimHp = ctx.createBiquadFilter();
    shimHp.type = "highpass";
    shimHp.frequency.value = 5500;
    shimmer.connect(shimHp);
    play(shimmer, shimHp, 0.35, 1.5);
    return;
  }

  // ── Ride cymbal (51=Ride 1, 59=Ride 2) ───────────────────────────────────
  if (noteNumber === 51 || noteNumber === 59) {
    const RIDE_FREQS = [213, 329, 541, 678, 891, 1024];
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 4000;
    bp.Q.value = 0.4;
    metalBank(RIDE_FREQS, bp, 0.45, 1.2);

    // Bell attack transient
    const bell = ctx.createOscillator();
    bell.type = "sine";
    bell.frequency.value = 1050;
    play(bell, null, 0.5, 0.08);
    return;
  }

  // ── Toms ──────────────────────────────────────────────────────────────────
  // [fundamentalHz, decay, attackNoiseFreq]
  const TOMS: Record<number, [number, number, number]> = {
    41: [52, 0.42, 400], // Low Floor Tom
    43: [62, 0.38, 480], // High Floor Tom
    45: [78, 0.34, 580], // Low Tom
    47: [98, 0.3, 720], // Low-Mid Tom
    48: [118, 0.27, 900], // Hi-Mid Tom
    50: [145, 0.23, 1100], // High Tom
  };
  if (noteNumber in TOMS) {
    const [freq, decay, noiseFreq] = TOMS[noteNumber];
    // Main tone: sine with sharp pitch envelope (attack → sustain → decay)
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 1.6, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.02);
    osc.frequency.exponentialRampToValueAtTime(0.01, now + decay * 1.1);
    play(osc, null, 1.2, decay);

    // Attack transient noise
    const atkNoise = makeNoise(0.04);
    const atkBp = ctx.createBiquadFilter();
    atkBp.type = "bandpass";
    atkBp.frequency.value = noiseFreq;
    atkBp.Q.value = 2;
    atkNoise.connect(atkBp);
    play(atkNoise, atkBp, 0.45, 0.03);
    return;
  }

  // ── Side stick / Rimshot (37) ─────────────────────────────────────────────
  if (noteNumber === 37) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 480;
    play(osc, null, 0.9, 0.06);

    const n = makeNoise(0.06);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3000;
    bp.Q.value = 1;
    n.connect(bp);
    play(n, bp, 0.55, 0.05);
    return;
  }

  // ── Hand clap (39) ────────────────────────────────────────────────────────
  if (noteNumber === 39) {
    // 3 noise bursts slightly offset to simulate clap flutter
    for (let i = 0; i < 3; i++) {
      const n = makeNoise(0.06);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1200;
      bp.Q.value = 0.8;
      n.connect(bp);
      play(n, bp, i === 0 ? 0.8 : 0.5, 0.05, i * 0.013);
    }
    return;
  }

  // ── Fallback: short bandpass noise ───────────────────────────────────────
  const fallback = makeNoise(0.1);
  const fbBp = ctx.createBiquadFilter();
  fbBp.type = "bandpass";
  fbBp.frequency.value = 1000;
  fallback.connect(fbBp);
  play(fallback, fbBp, 0.3, 0.08);
}
// ─────────────────────────────────────────────────────────────────────────────

export default function MidiPlayerComponent({
  src,
  channelInstruments = {},
  measureStartsMs,
  selectedMeasures,
  playFromMeasure,
  onMeasureChange,
}: Props) {
  const [state, setState] = useState<State>("loading");
  const playerRef = useRef<MidiPlayerExtended | null>(null);
  const instrumentsRef = useRef<
    Map<number, SfNode & { play: (note: string, time: number, opts?: { gain?: number }) => SfNode }>
  >(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const drumBuffersRef = useRef<Map<number, AudioBuffer>>(new Map());
  const activeNotesRef = useRef<Map<string, SfNode>>(new Map());
  const onMeasureChangeRef = useRef(onMeasureChange);
  onMeasureChangeRef.current = onMeasureChange;
  const activeRef = useRef(false);
  const rafRef = useRef<number>(0);
  const lastMeasureRef = useRef(-1);

  // For ms-based measure tracking
  const playStartAudioTimeRef = useRef(0); // audioCtx.currentTime when play() was called
  const startOffsetMsRef = useRef(0); // ms into the score where we started (for selected measures)
  const measureStartsMsRef = useRef<number[]>([]);
  measureStartsMsRef.current = measureStartsMs;

  function measureAtMs(elapsedMs: number): number {
    const starts = measureStartsMsRef.current;
    if (starts.length === 0) return 1;
    let num = 1;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= elapsedMs) num = i + 1;
      else break;
    }
    return num;
  }

  function startMeasureTracking() {
    function tick() {
      const ctx = audioCtxRef.current;
      if (!ctx || !activeRef.current) return;
      const elapsedMs = (ctx.currentTime - playStartAudioTimeRef.current) * 1000 + startOffsetMsRef.current;
      const measureNum = measureAtMs(elapsedMs);
      if (measureNum !== lastMeasureRef.current) {
        lastMeasureRef.current = measureNum;
        onMeasureChangeRef.current(measureNum);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopMeasureTracking() {
    cancelAnimationFrame(rafRef.current);
    lastMeasureRef.current = -1;
  }

  function stopAllNotes(immediate = false) {
    const ctx = audioCtxRef.current;
    const when = ctx ? ctx.currentTime + (immediate ? 0 : NOTE_RELEASE_SECONDS) : 0;
    activeNotesRef.current.forEach((node) => {
      try {
        node.stop(when);
      } catch {
        /* already stopped */
      }
    });
    activeNotesRef.current.clear();
  }

  useEffect(() => {
    setState("loading");
    let cancelled = false;

    async function init() {
      const { default: Soundfont } = await import("soundfont-player");
      if (cancelled) return;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      // Load soundfonts + drum samples in parallel
      const uniqueNames = [
        ...new Set(
          Object.values(channelInstruments).length > 0 ? Object.values(channelInstruments) : ["acoustic_grand_piano"],
        ),
      ];
      const [loaded, drumMap] = await Promise.all([
        Promise.all(
          uniqueNames.map((name) => Soundfont.instrument(audioCtx, name as any).then((sf) => [name, sf] as const)),
        ),
        loadDrumSamples(audioCtx).catch(() => new Map<number, AudioBuffer>()),
      ]);
      if (cancelled) return;
      drumBuffersRef.current = drumMap;
      const nameToSf = new Map(loaded);
      // Build channel → sf map; fallback to first loaded instrument
      const fallback = loaded[0][1];
      const channelMap = new Map<number, typeof fallback>();
      for (const [ch, name] of Object.entries(channelInstruments)) {
        channelMap.set(Number(ch), nameToSf.get(name) ?? fallback);
      }
      // Ensure there's always a fallback entry so notes on unmapped channels still play
      if (channelMap.size === 0) {
        channelMap.set(1, fallback);
      }
      instrumentsRef.current = channelMap;

      const player = new MidiPlayer.Player((event: MidiPlayer.Event) => {
        if (!activeRef.current) return;

        const noteName = event.noteName;
        const ctx = audioCtxRef.current;

        // ── note on ───────────────────────────────────────────────────────
        if (event.name === "Note on" && event.velocity && event.velocity > 0 && ctx) {
          // Channel 10 = GM percussion
          if (event.channel === 10) {
            const noteNum = event.noteNumber ?? 0;
            const vel = (event.velocity ?? 64) / 127;
            const buf = drumBuffersRef.current.get(noteNum);
            if (process.env.NODE_ENV === "development")
              console.log(`[drums] ch10 note=${noteNum} buf=${!!buf} mapSize=${drumBuffersRef.current.size}`);
            if (buf) {
              const src = ctx.createBufferSource();
              src.buffer = buf;
              const gain = ctx.createGain();
              gain.gain.value = vel;
              src.connect(gain);
              gain.connect(ctx.destination);
              src.start(ctx.currentTime);
            } else {
              playDrumSynth(ctx, noteNum, vel); // fallback if sample not loaded
            }
            return;
          }
          if (!noteName) return;
          const sf = instrumentsRef.current.get(event.channel ?? 1) ?? instrumentsRef.current.values().next().value;
          if (!sf) return;
          // Stop any still-ringing previous instance of this pitch
          const key = `${event.channel}:${noteName}`;
          const prev = activeNotesRef.current.get(key);
          if (prev) {
            try {
              prev.stop(ctx.currentTime + NOTE_RELEASE_SECONDS);
            } catch {
              /* ok */
            }
          }
          const node: SfNode = sf.play(noteName, ctx.currentTime, { gain: event.velocity / 127 });
          activeNotesRef.current.set(key, node);
        }

        // ── note off (also handles Note on with velocity 0) ───────────────
        if (
          (event.name === "Note off" || (event.name === "Note on" && (!event.velocity || event.velocity === 0))) &&
          noteName &&
          ctx
        ) {
          const key = `${event.channel}:${noteName}`;
          const node = activeNotesRef.current.get(key);
          if (node) {
            try {
              node.stop(ctx.currentTime + NOTE_RELEASE_SECONDS);
            } catch {
              /* ok */
            }
            activeNotesRef.current.delete(key);
          }
        }
      });

      player.loadDataUri(src);
      player.on("endOfFile", () => {
        activeRef.current = false;
        stopMeasureTracking();
        stopAllNotes();
        onMeasureChangeRef.current(null);
        setState("stopped");
      });
      playerRef.current = player;

      setState("ready");
    }

    init().catch(console.error);

    return () => {
      cancelled = true;
      stopMeasureTracking();
      playerRef.current?.stop();
      stopAllNotes(true);
      audioCtxRef.current?.close();
      onMeasureChangeRef.current(null);
      playerRef.current = null;
      instrumentsRef.current = new Map();
      drumBuffersRef.current = new Map();
      audioCtxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, JSON.stringify(channelInstruments)]);

  // Keep latest handlers in refs so the Space listener never goes stale
  // and is registered only once (no re-registration races on state change).
  const handlePlayRef = useRef<() => void>(() => {});
  const handleStopRef = useRef<() => void>(() => {});

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== " ") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (activeRef.current) handleStopRef.current();
      else handlePlayRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handlePlay() {
    const player = playerRef.current;
    const ctx = audioCtxRef.current;
    if (!player || !ctx) return;
    if (activeRef.current) return; // re-entry guard — already playing
    activeRef.current = true;
    await ctx.resume();
    if (!activeRef.current) return; // stopped during resume

    const startMeasure = playFromMeasure ?? (selectedMeasures.size > 0 ? Math.min(...selectedMeasures) : null);
    if (startMeasure != null) {
      // ms offset: use timemap if available, otherwise fall back to tick math
      const starts = measureStartsMsRef.current;
      const startMs = starts.length >= startMeasure ? (starts[startMeasure - 1] ?? 0) : 0;
      startOffsetMsRef.current = startMs;

      // Skip the MIDI player to the right tick
      const division = player.division ?? DEFAULT_MIDI_DIVISION;
      // For the tick skip, use the tempo from the MIDI to convert ms → ticks
      // (approximate: assume constant tempo)
      const bpm = player.tempo ?? DEFAULT_PLAYBACK_BPM;
      const startTick = Math.round((startMs / 1000) * (bpm / 60) * division);
      player.skipToTick(startTick);
    } else {
      startOffsetMsRef.current = 0;
    }

    playStartAudioTimeRef.current = ctx.currentTime;
    player.play();
    startMeasureTracking();
    setState("playing");
  }

  function handleStop() {
    activeRef.current = false;
    stopMeasureTracking();
    playerRef.current?.stop();
    stopAllNotes();
    onMeasureChangeRef.current(null);
    setState("stopped");
  }

  // Keep refs in sync on every render
  handlePlayRef.current = handlePlay;
  handleStopRef.current = handleStop;

  if (state === "loading") {
    return (
      <button
        disabled
        className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-400 transition shrink-0"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-3.5 h-3.5 animate-spin"
        >
          <path
            fillRule="evenodd"
            d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z"
            clipRule="evenodd"
          />
        </svg>
        Loading…
      </button>
    );
  }

  return state === "playing" ? (
    <button
      onClick={(e) => {
        (e.currentTarget as HTMLButtonElement).blur();
        handleStop();
      }}
      className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition shrink-0"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
        <path d="M5.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 7.25 3h-1.5ZM12.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75a.75.75 0 0 0-.75-.75h-1.5Z" />
      </svg>
      Stop
    </button>
  ) : (
    <button
      onClick={(e) => {
        (e.currentTarget as HTMLButtonElement).blur();
        handlePlay();
      }}
      className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-brand-primary hover:bg-brand-primary/90 text-white transition shrink-0"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
        <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" />
      </svg>
      Play
    </button>
  );
}

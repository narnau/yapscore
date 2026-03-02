"use client";

import { useEffect, useRef, useState } from "react";
import MidiPlayer from "midi-player-js";

type State = "loading" | "ready" | "playing" | "stopped";

// soundfont-player returns a node with a .stop(when?) method
type SfNode = { stop: (when?: number) => void };

type Props = {
  src: string;
  channelInstruments?: Record<number, string>; // MIDI channel → soundfont name
  measureStartsMs: number[];                   // ms timestamp of each measure start (from Verovio timemap)
  selectedMeasures: Set<number>;
  onMeasureChange: (measure: number | null) => void;
};

const RELEASE_S = 0.15; // fade-out time when stopping a note early (seconds)

export default function MidiPlayerComponent({ src, channelInstruments = {}, measureStartsMs, selectedMeasures, onMeasureChange }: Props) {
  const [state, setState] = useState<State>("loading");
  const playerRef        = useRef<MidiPlayer.Player | null>(null);
  const instrumentsRef   = useRef<Map<number, any>>(new Map()); // channel → soundfont instance
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const activeNotesRef   = useRef<Map<string, SfNode>>(new Map());
  const onMeasureChangeRef = useRef(onMeasureChange);
  onMeasureChangeRef.current = onMeasureChange;
  const activeRef        = useRef(false);
  const rafRef           = useRef<number>(0);
  const lastMeasureRef   = useRef(-1);

  // For ms-based measure tracking
  const playStartAudioTimeRef = useRef(0); // audioCtx.currentTime when play() was called
  const startOffsetMsRef      = useRef(0); // ms into the score where we started (for selected measures)
  const measureStartsMsRef    = useRef<number[]>([]);
  measureStartsMsRef.current  = measureStartsMs;

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
    const when = ctx ? ctx.currentTime + (immediate ? 0 : RELEASE_S) : 0;
    activeNotesRef.current.forEach((node) => {
      try { node.stop(when); } catch { /* already stopped */ }
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

      // Load one soundfont per unique instrument name (deduplicated)
      const uniqueNames = [...new Set(Object.values(channelInstruments).length > 0
        ? Object.values(channelInstruments)
        : ["acoustic_grand_piano"]
      )];
      const loaded = await Promise.all(
        uniqueNames.map((name) => Soundfont.instrument(audioCtx, name as any).then((sf) => [name, sf] as const))
      );
      if (cancelled) return;
      const nameToSf = new Map(loaded);
      // Build channel → sf map; fallback to first loaded instrument
      const fallback = loaded[0][1];
      const channelMap = new Map<number, any>();
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
        if (event.name === "Note on" && event.velocity && event.velocity > 0 && noteName && ctx) {
          const sf = instrumentsRef.current.get(event.channel ?? 1)
            ?? instrumentsRef.current.values().next().value;
          if (!sf) return;
          // Stop any still-ringing previous instance of this pitch
          const key = `${event.channel}:${noteName}`;
          const prev = activeNotesRef.current.get(key);
          if (prev) {
            try { prev.stop(ctx.currentTime + RELEASE_S); } catch { /* ok */ }
          }
          const node: SfNode = sf.play(noteName, ctx.currentTime, { gain: event.velocity / 127 });
          activeNotesRef.current.set(key, node);
        }

        // ── note off (also handles Note on with velocity 0) ───────────────
        if (
          (event.name === "Note off" || (event.name === "Note on" && (!event.velocity || event.velocity === 0))) &&
          noteName && ctx
        ) {
          const key = `${event.channel}:${noteName}`;
          const node = activeNotesRef.current.get(key);
          if (node) {
            try { node.stop(ctx.currentTime + RELEASE_S); } catch { /* ok */ }
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
      playerRef.current     = null;
      instrumentsRef.current = new Map();
      audioCtxRef.current   = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, JSON.stringify(channelInstruments)]);

  // Keep latest handlers in refs so the Space keydown listener never goes stale
  const handlePlayRef = useRef<() => void>(() => {});
  const handleStopRef = useRef<() => void>(() => {});

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== " ") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (state === "playing") handleStopRef.current();
      else if (state === "ready" || state === "stopped") handlePlayRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state]);

  function handlePlay() {
    const player = playerRef.current;
    const ctx = audioCtxRef.current;
    if (!player || !ctx) return;
    activeRef.current = true;
    ctx.resume();

    if (selectedMeasures.size > 0) {
      const startMeasure = Math.min(...selectedMeasures);
      // ms offset: use timemap if available, otherwise fall back to tick math
      const starts = measureStartsMsRef.current;
      const startMs = starts.length >= startMeasure
        ? (starts[startMeasure - 1] ?? 0)
        : 0;
      startOffsetMsRef.current = startMs;

      // Skip the MIDI player to the right tick
      const division = (player as any).division || 480;
      // For the tick skip, use the tempo from the MIDI to convert ms → ticks
      // (approximate: assume constant tempo)
      const bpm = (player as any).tempo || 120;
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
      <button disabled className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-400 transition shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 animate-spin">
          <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
        </svg>
        Loading…
      </button>
    );
  }

  return state === "playing" ? (
    <button
      onClick={handleStop}
      className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition shrink-0"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
        <path d="M5.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 7.25 3h-1.5ZM12.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75a.75.75 0 0 0-.75-.75h-1.5Z" />
      </svg>
      Stop
    </button>
  ) : (
    <button
      onClick={handlePlay}
      className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-brand-primary hover:bg-brand-primary/90 text-white transition shrink-0"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
        <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" />
      </svg>
      Play
    </button>
  );
}

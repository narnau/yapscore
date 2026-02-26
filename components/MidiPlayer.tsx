"use client";

import { useEffect, useRef, useState } from "react";
import MidiPlayer from "midi-player-js";

type State = "loading" | "ready" | "playing" | "stopped";

// soundfont-player returns a node with a .stop(when?) method
type SfNode = { stop: (when?: number) => void };

type Props = {
  src: string;
  quarterNotesPerMeasure: number;
  selectedMeasures: Set<number>;
  onMeasureChange: (measure: number | null) => void;
};

const RELEASE_S = 0.15; // fade-out time when stopping a note early (seconds)

export default function MidiPlayerComponent({ src, quarterNotesPerMeasure, selectedMeasures, onMeasureChange }: Props) {
  const [state, setState] = useState<State>("loading");
  const playerRef   = useRef<MidiPlayer.Player | null>(null);
  const instrumentRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeNotesRef = useRef<Map<string, SfNode>>(new Map());
  const onMeasureChangeRef = useRef(onMeasureChange);
  onMeasureChangeRef.current = onMeasureChange;
  const activeRef   = useRef(false);
  const minTickRef  = useRef(0); // ignore events below this tick (prevents glitch after skipToTick)

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

      const instrument = await Soundfont.instrument(audioCtx, "acoustic_grand_piano");
      if (cancelled) return;
      instrumentRef.current = instrument;

      let lastMeasure = -1;

      const player = new MidiPlayer.Player((event: MidiPlayer.Event) => {
        if (!activeRef.current) return;

        // ── measure tracking ──────────────────────────────────────────────
        if (event.tick >= minTickRef.current) {
          const division = player.division || 480;
          const ticksPerMeasure = division * quarterNotesPerMeasure;
          const measureNum = Math.floor(event.tick / ticksPerMeasure) + 1;
          if (measureNum !== lastMeasure) {
            lastMeasure = measureNum;
            onMeasureChangeRef.current(measureNum);
          }
        }

        const noteName = event.noteName;
        const ctx = audioCtxRef.current;

        // ── note on ───────────────────────────────────────────────────────
        if (event.name === "Note on" && event.velocity && event.velocity > 0 && noteName && ctx) {
          // Stop any still-ringing previous instance of this pitch
          const prev = activeNotesRef.current.get(noteName);
          if (prev) {
            try { prev.stop(ctx.currentTime + RELEASE_S); } catch { /* ok */ }
          }
          const node: SfNode = instrumentRef.current.play(noteName, ctx.currentTime, {
            gain: event.velocity / 127,
          });
          activeNotesRef.current.set(noteName, node);
        }

        // ── note off (also handles Note on with velocity 0) ───────────────
        if (
          (event.name === "Note off" || (event.name === "Note on" && (!event.velocity || event.velocity === 0))) &&
          noteName && ctx
        ) {
          const node = activeNotesRef.current.get(noteName);
          if (node) {
            try { node.stop(ctx.currentTime + RELEASE_S); } catch { /* ok */ }
            activeNotesRef.current.delete(noteName);
          }
        }
      });

      player.loadDataUri(src);
      player.on("endOfFile", () => {
        activeRef.current = false;
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
      playerRef.current?.stop();
      stopAllNotes(true);
      audioCtxRef.current?.close();
      onMeasureChangeRef.current(null);
      playerRef.current   = null;
      instrumentRef.current = null;
      audioCtxRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

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
    if (!player) return;
    activeRef.current = true;
    audioCtxRef.current?.resume();

    if (selectedMeasures.size > 0) {
      const startMeasure = Math.min(...selectedMeasures);
      const division = player.division || 480;
      const startTick = (startMeasure - 1) * division * quarterNotesPerMeasure;
      minTickRef.current = startTick;
      player.skipToTick(startTick);
    } else {
      minTickRef.current = 0;
    }

    player.play();
    setState("playing");
  }

  function handleStop() {
    activeRef.current = false;
    playerRef.current?.stop();
    stopAllNotes();
    onMeasureChangeRef.current(null);
    setState("stopped");
  }

  // Keep refs in sync on every render
  handlePlayRef.current = handlePlay;
  handleStopRef.current = handleStop;

  if (state === "loading") {
    return <span className="text-xs text-gray-500 animate-pulse">Loading player…</span>;
  }

  return (
    <div className="flex items-center gap-3">
      {state === "playing" ? (
        <button
          onClick={handleStop}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm transition"
        >
          <span>⏹</span> Stop
        </button>
      ) : (
        <button
          onClick={handlePlay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm transition"
        >
          <span>▶</span> Play
        </button>
      )}
      <span className="text-xs text-gray-500">
        {state === "stopped" ? "Finished" : "Ready"}
      </span>
    </div>
  );
}

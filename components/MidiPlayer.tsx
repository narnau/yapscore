"use client";

import { useEffect, useRef, useState } from "react";
import MidiPlayer from "midi-player-js";

type State = "loading" | "ready" | "playing" | "stopped";

type Props = {
  src: string;
  quarterNotesPerMeasure: number;
  onMeasureChange: (measure: number | null) => void;
};

export default function MidiPlayerComponent({ src, quarterNotesPerMeasure, onMeasureChange }: Props) {
  const [state, setState] = useState<State>("loading");
  const playerRef = useRef<MidiPlayer.Player | null>(null);
  const instrumentRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const onMeasureChangeRef = useRef(onMeasureChange);
  onMeasureChangeRef.current = onMeasureChange;
  const activeRef = useRef(false);

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
        // Highlight current measure
        const division = player.division || 480;
        const ticksPerMeasure = division * quarterNotesPerMeasure;
        const measureNum = Math.floor(event.tick / ticksPerMeasure) + 1;
        if (measureNum !== lastMeasure) {
          lastMeasure = measureNum;
          onMeasureChangeRef.current(measureNum);
        }

        // Play note
        if (event.name === "Note on" && event.velocity && event.velocity > 0 && event.noteName) {
          instrumentRef.current?.play(event.noteName, audioCtx.currentTime, {
            gain: event.velocity / 100,
          });
        }
      });

      player.loadDataUri(src);
      player.on("endOfFile", () => {
        activeRef.current = false;
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
      audioCtxRef.current?.close();
      onMeasureChangeRef.current(null);
      playerRef.current = null;
      instrumentRef.current = null;
      audioCtxRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  function handlePlay() {
    activeRef.current = true;
    audioCtxRef.current?.resume();
    playerRef.current?.play();
    setState("playing");
  }

  function handleStop() {
    activeRef.current = false;
    playerRef.current?.stop();
    onMeasureChangeRef.current(null);
    setState("stopped");
  }

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

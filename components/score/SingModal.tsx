"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  startMetronome,
  startRecording,
  detectPitches,
  quantizePitches,
  notesToNoteSpecs,
  splitByMeasure,
  playDetectedNotes,
  type DetectedNote,
  type RecordingHandle,
  type MetronomeHandle,
  type PlaybackHandle,
} from "@/lib/music/sing";
import { createScore, setMeasureNotes } from "@/lib/music/musicxml";

type Phase = "setup" | "countdown" | "recording" | "processing" | "review";

const PROCESSING_MESSAGES = [
  "Decoding your vocal wizardry...",
  "Teaching AI to read music...",
  "Transcribing your inner Pavarotti...",
  "Converting vibrations to notation...",
  "Analyzing pitch like a choir director...",
  "Turning your hums into harmony...",
  "Our AI has perfect pitch (allegedly)...",
  "Beethoven would be proud (maybe)...",
];

const REFERENCE_NOTES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5"];

const REFERENCE_CHORDS: Record<string, string[]> = {
  "C major": ["C4", "E4", "G4"],
  "D minor": ["D4", "F4", "A4"],
  "E minor": ["E4", "G4", "B4"],
  "F major": ["F4", "A4", "C5"],
  "G major": ["G4", "B4", "D5"],
  "A minor": ["A4", "C5", "E5"],
  "C minor": ["C4", "Eb4", "G4"],
  "D major": ["D4", "F#4", "A4"],
  "A major": ["A4", "C#5", "E5"],
};

type RefMode = "note" | "chord";

type PartInfo = { id: string; name: string; staves: number };

function extractParts(musicXml: string): PartInfo[] {
  const parts: PartInfo[] = [];
  for (const m of musicXml.matchAll(/<score-part\s+id="([^"]+)"[^>]*>\s*<part-name>([^<]*)<\/part-name>/g)) {
    const partId = m[1];
    const name = m[2] || partId;
    // Count staves from the first measure's <attributes><staves> element
    const partBlock = musicXml.match(new RegExp(`<part\\s+id="${partId}"[^>]*>[\\s\\S]*?</part>`));
    const stavesMatch = partBlock?.[0].match(/<staves>(\d+)<\/staves>/);
    const staves = stavesMatch ? parseInt(stavesMatch[1]) : 1;
    parts.push({ id: partId, name, staves });
  }
  return parts.length > 0 ? parts : [{ id: "P1", name: "Part 1", staves: 1 }];
}

type Props = {
  bpm: number;
  beats: number;
  beatType: number;
  totalMeasures: number;
  selectedMeasures: Set<number>;
  musicXml: string;
  onInsert: (updatedXml: string, label: string) => void;
  onClose: () => void;
};

export default function SingModal({
  bpm: defaultBpm,
  beats,
  beatType,
  totalMeasures: scoreMeasures,
  selectedMeasures,
  musicXml,
  onInsert,
  onClose,
}: Props) {
  const [parts] = useState(() => extractParts(musicXml));
  const [targetPart, setTargetPart] = useState(() => extractParts(musicXml)[0].id);
  const [targetStaff, setTargetStaff] = useState<number | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("setup");
  const [bpm, setBpm] = useState(defaultBpm);
  const [measuresToRecord, setMeasuresToRecord] = useState(2);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [currentMeasure, setCurrentMeasure] = useState(0);
  const [countdownBeat, setCountdownBeat] = useState(0);
  const [detectedNotes, setDetectedNotes] = useState<DetectedNote[]>([]);
  const [insertAfter, setInsertAfter] = useState(() => {
    if (selectedMeasures.size > 0) return Math.max(...selectedMeasures);
    return scoreMeasures;
  });
  const [replaceSelected, setReplaceSelected] = useState(selectedMeasures.size > 0);
  const [error, setError] = useState<string | null>(null);
  const [previewSvg, setPreviewSvg] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [processingMsg, setProcessingMsg] = useState("");
  const [refMode, setRefMode] = useState<RefMode>("note");
  const [referenceNote, setReferenceNote] = useState("A4");
  const [referenceChord, setReferenceChord] = useState("C major");
  const [isRefPlaying, setIsRefPlaying] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const refAudioCtxRef = useRef<AudioContext | null>(null);
  const refNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const recordingRef = useRef<RecordingHandle | null>(null);
  const metronomeRef = useRef<MetronomeHandle | null>(null);
  const playbackRef = useRef<PlaybackHandle | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      metronomeRef.current?.stop();
      playbackRef.current?.stop();
      stopReference();
      audioCtxRef.current?.close();
    };
  }, []);

  // Rotate processing messages
  useEffect(() => {
    if (phase !== "processing") return;
    const interval = setInterval(() => {
      setProcessingMsg(PROCESSING_MESSAGES[Math.floor(Math.random() * PROCESSING_MESSAGES.length)]);
    }, 2500);
    return () => clearInterval(interval);
  }, [phase]);

  function stopReference() {
    for (const node of refNodesRef.current) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    refNodesRef.current = [];
    refAudioCtxRef.current?.close();
    refAudioCtxRef.current = null;
    setIsRefPlaying(false);
  }

  async function playReference() {
    stopReference();
    const ctx = new AudioContext();
    refAudioCtxRef.current = ctx;
    setIsRefPlaying(true);

    try {
      const { default: Soundfont } = await import("soundfont-player");
      // Check if context was closed while loading
      if (refAudioCtxRef.current !== ctx) return;
      await ctx.resume();

      const piano = await Soundfont.instrument(ctx, "acoustic_grand_piano");
      if (refAudioCtxRef.current !== ctx) return;

      const notes = refMode === "chord" ? (REFERENCE_CHORDS[referenceChord] ?? ["C4"]) : [referenceNote];

      const nodes: AudioBufferSourceNode[] = [];
      for (const n of notes) {
        const node = piano.play(n, ctx.currentTime, { gain: 0.5, duration: 2 });
        nodes.push(node);
      }
      refNodesRef.current = nodes;

      // Auto-stop after 2.2s
      setTimeout(() => {
        if (refAudioCtxRef.current === ctx) stopReference();
      }, 2200);
    } catch (err) {
      console.error("[sing] playReference error:", err);
      stopReference();
    }
  }

  const handleStart = useCallback(async () => {
    stopReference();
    setError(null);

    try {
      // Request mic permission early
      const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      testStream.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Microphone access denied. Please allow microphone access and try again.");
      return;
    }

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;

    // Phase 1: Count-in (one measure of metronome clicks)
    setPhase("countdown");
    setCountdownBeat(0);

    const countInBeats = beats;
    startMetronome(
      audioCtx,
      bpm,
      beats,
      countInBeats,
      (beat) => setCountdownBeat(beat),
      async () => {
        // Count-in done → start recording
        setPhase("recording");
        setCurrentBeat(1);
        setCurrentMeasure(1);

        try {
          const recording = await startRecording(audioCtx);
          recordingRef.current = recording;

          // Start silent metronome for recording period (visual only, no audio to confuse pitch detection)
          const recordingBeats = measuresToRecord * beats;
          metronomeRef.current = startMetronome(
            audioCtx,
            bpm,
            beats,
            recordingBeats,
            (beat, measure) => {
              setCurrentBeat(beat);
              setCurrentMeasure(measure);
            },
            async () => {
              // Recording done
              await handleRecordingDone();
            },
            true, // silent
          );
        } catch (err) {
          setError("Failed to start recording. Please try again.");
          setPhase("setup");
        }
      },
    );
  }, [bpm, beats, measuresToRecord]);

  const handleRecordingDone = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;

    const buffer = await recording.stop();
    recordingRef.current = null;
    metronomeRef.current = null;

    // Show processing phase with rotating messages
    setProcessingMsg(PROCESSING_MESSAGES[Math.floor(Math.random() * PROCESSING_MESSAGES.length)]);
    setPhase("processing");

    // Detect pitches (SPICE model — async)
    let pitches;
    try {
      pitches = await detectPitches(buffer);
    } catch (err) {
      console.error("[sing] Pitch detection failed:", err);
      setError("Failed to analyze audio. Check your connection and try again.");
      setPhase("setup");
      return;
    }

    // Quantize to eighth-note slots
    const result = quantizePitches(pitches, bpm, beats, measuresToRecord);

    setDetectedNotes(result.notes);
    setPreviewSvg("");
    setPhase("review");
  }, [bpm, beats, measuresToRecord]);

  const handleStopEarly = useCallback(async () => {
    metronomeRef.current?.stop();
    metronomeRef.current = null;
    await handleRecordingDone();
  }, [handleRecordingDone]);

  // Render Verovio preview when entering review phase
  useEffect(() => {
    if (phase !== "review" || detectedNotes.length === 0) return;

    let cancelled = false;

    (async () => {
      // Build a temporary MusicXML from detected notes
      const measureGroups = splitByMeasure(detectedNotes, beats);
      let previewXml = createScore({
        instruments: [{ name: "Voice" }],
        beats,
        beatType,
        tempo: bpm,
        measures: measureGroups.length,
      });
      for (let i = 0; i < measureGroups.length; i++) {
        const specs = notesToNoteSpecs(measureGroups[i], beats);
        if (specs.length > 0) {
          previewXml = setMeasureNotes(previewXml, i + 1, specs);
        }
      }

      // Load Verovio
      const { default: createVerovioModule } = await import("verovio/wasm");
      const { VerovioToolkit } = await import("verovio/esm");
      const VerovioModule = await createVerovioModule();
      const vrvToolkit = new VerovioToolkit(VerovioModule);

      vrvToolkit.setOptions({
        scale: 35,
        pageWidth: 1400,
        pageMarginTop: 10,
        pageMarginBottom: 10,
        pageMarginLeft: 10,
        pageMarginRight: 10,
        adjustPageHeight: true,
      });
      vrvToolkit.loadData(previewXml);

      if (!cancelled) {
        setPreviewSvg(vrvToolkit.renderToSVG(1));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, detectedNotes, beats, beatType, bpm]);

  const handleInsert = useCallback(() => {
    let xml = musicXml;
    const measureGroups = splitByMeasure(detectedNotes, beats);
    const partName = parts.find((p) => p.id === targetPart)?.name ?? targetPart;

    if (replaceSelected && selectedMeasures.size > 0) {
      // Replace selected measures
      const sortedSelected = [...selectedMeasures].sort((a, b) => a - b);
      for (let i = 0; i < measureGroups.length && i < sortedSelected.length; i++) {
        const specs = notesToNoteSpecs(measureGroups[i], beats);
        if (specs.length > 0) {
          xml = setMeasureNotes(xml, sortedSelected[i], specs, targetPart, targetStaff);
        }
      }
      onInsert(xml, `Sing: replaced measures ${sortedSelected.join(", ")} in ${partName}`);
    } else {
      // Insert after a specific measure
      // setMeasureNotes auto-creates measures if needed
      for (let i = 0; i < measureGroups.length; i++) {
        const measureNum = insertAfter + 1 + i;
        const specs = notesToNoteSpecs(measureGroups[i], beats);
        if (specs.length > 0) {
          xml = setMeasureNotes(xml, measureNum, specs, targetPart, targetStaff);
        }
      }
      onInsert(xml, `Sing: added ${measureGroups.length} measure(s) after measure ${insertAfter} in ${partName}`);
    }
  }, [
    musicXml,
    detectedNotes,
    beats,
    replaceSelected,
    selectedMeasures,
    insertAfter,
    onInsert,
    targetPart,
    targetStaff,
    parts,
  ]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white border border-gray-200 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">
            {phase === "setup" && "Sing a Melody"}
            {phase === "countdown" && "Get Ready..."}
            {phase === "recording" && "Recording"}
            {phase === "processing" && "Processing..."}
            {phase === "review" && "Review Notes"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">
            ×
          </button>
        </div>

        <div className="px-5 py-4">
          {/* ── Phase: Setup ─────────────────────────────────────── */}
          {phase === "setup" && (
            <div className="space-y-4">
              {error && (
                <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-brand-secondary mb-1">
                    BPM (tempo)
                    {bpm > 80 && <span className="ml-2 text-amber-600 font-normal">↓ slower = better</span>}
                  </label>
                  <input
                    type="number"
                    min={40}
                    max={80}
                    value={bpm}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      setBpm(isNaN(v) ? 0 : v);
                    }}
                    onBlur={() => setBpm((prev) => Math.max(40, Math.min(80, prev || 60)))}
                    className="w-full px-3 py-2 rounded bg-gray-50 border border-gray-200 text-sm text-gray-900 focus:outline-none focus:border-brand-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-brand-secondary mb-1">Measures to record</label>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={measuresToRecord}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      setMeasuresToRecord(isNaN(v) ? 0 : v);
                    }}
                    onBlur={() => setMeasuresToRecord((prev) => Math.max(1, Math.min(8, prev || 2)))}
                    className="w-full px-3 py-2 rounded bg-gray-50 border border-gray-200 text-sm text-gray-900 focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div className="text-xs text-gray-500">
                Time signature: {beats}/{beatType} · Quantization: eighth notes (2 per beat)
              </div>

              {/* Reference pitch / chord */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-brand-secondary">Reference</span>
                  <div className="flex rounded overflow-hidden border border-gray-200 text-xs">
                    <button
                      onClick={() => setRefMode("note")}
                      className={`px-3 py-1 transition ${refMode === "note" ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                    >
                      Note
                    </button>
                    <button
                      onClick={() => setRefMode("chord")}
                      className={`px-3 py-1 transition ${refMode === "chord" ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                    >
                      Chord
                    </button>
                  </div>

                  {refMode === "note" ? (
                    <select
                      value={referenceNote}
                      onChange={(e) => setReferenceNote(e.target.value)}
                      className="px-2 py-1 rounded bg-gray-50 border border-gray-200 text-xs text-gray-900 focus:outline-none focus:border-brand-primary"
                    >
                      {REFERENCE_NOTES.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={referenceChord}
                      onChange={(e) => setReferenceChord(e.target.value)}
                      className="px-2 py-1 rounded bg-gray-50 border border-gray-200 text-xs text-gray-900 focus:outline-none focus:border-brand-primary"
                    >
                      {Object.keys(REFERENCE_CHORDS).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    onClick={isRefPlaying ? stopReference : playReference}
                    className={`px-3 py-1 rounded border text-xs transition ${
                      isRefPlaying
                        ? "bg-gray-200 border-gray-300 text-gray-700 hover:bg-gray-300"
                        : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {isRefPlaying ? "Stop" : "Listen"}
                  </button>
                </div>
              </div>

              <div className="text-xs text-brand-secondary bg-gray-50 rounded p-3 space-y-1">
                <div>
                  <strong className="text-gray-700">How it works:</strong> Listen to the reference pitch, click Start,
                  hear the count-in ({beats} clicks), then sing or hum your melody. Recording stops automatically after{" "}
                  {measuresToRecord} measure{measuresToRecord > 1 ? "s" : ""}.
                </div>
                <div className="text-amber-700">Tip: use a slow tempo (≤ 80 BPM) for best rhythm detection.</div>
              </div>

              <button
                onClick={handleStart}
                className="w-full py-3 rounded-lg bg-brand-primary hover:bg-brand-primary/90 text-white font-medium text-sm transition"
              >
                Start
              </button>
            </div>
          )}

          {/* ── Phase: Countdown ─────────────────────────────────── */}
          {phase === "countdown" && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="text-7xl font-bold text-brand-primary tabular-nums animate-pulse">
                {countdownBeat || "..."}
              </div>
              <div className="text-sm text-gray-500 mt-4">Count-in — start singing after this</div>
            </div>
          )}

          {/* ── Phase: Recording ─────────────────────────────────── */}
          {phase === "recording" && (
            <div className="flex flex-col items-center justify-center py-8 space-y-6">
              {/* Recording indicator */}
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400 text-sm font-medium">Recording</span>
              </div>

              {/* Beat display */}
              <div className="flex items-center gap-3">
                {Array.from({ length: beats }, (_, i) => (
                  <div
                    key={i}
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold transition-all ${
                      currentBeat === i + 1 ? "bg-brand-primary text-white scale-110" : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>

              {/* Measure counter */}
              <div className="text-sm text-brand-secondary">
                Measure {currentMeasure} / {measuresToRecord}
              </div>

              {/* Progress bar */}
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-brand-primary h-1.5 rounded-full transition-all"
                  style={{
                    width: `${(((currentMeasure - 1) * beats + currentBeat) / (measuresToRecord * beats)) * 100}%`,
                  }}
                />
              </div>

              <button
                onClick={handleStopEarly}
                className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm transition"
              >
                Stop early
              </button>
            </div>
          )}

          {/* ── Phase: Processing ─────────────────────────────────── */}
          {phase === "processing" && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              {/* Animated music notes */}
              <div className="relative w-20 h-20">
                <span className="absolute text-4xl animate-bounce" style={{ left: 0, animationDelay: "0s" }}>
                  ♪
                </span>
                <span
                  className="absolute text-3xl animate-bounce text-brand-primary"
                  style={{ left: 28, top: 4, animationDelay: "0.2s" }}
                >
                  ♫
                </span>
                <span
                  className="absolute text-4xl animate-bounce text-purple-400"
                  style={{ left: 52, animationDelay: "0.4s" }}
                >
                  ♪
                </span>
              </div>

              {/* Rotating message */}
              <div className="text-sm text-gray-700 text-center transition-all">{processingMsg}</div>

              {/* Progress dots */}
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-brand-primary animate-pulse"
                    style={{ animationDelay: `${i * 0.3}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Phase: Review ────────────────────────────────────── */}
          {phase === "review" && (
            <div className="space-y-4">
              {/* Verovio score preview */}
              <div className="bg-white rounded overflow-hidden">
                {previewSvg ? (
                  <div
                    dangerouslySetInnerHTML={{ __html: previewSvg }}
                    className="w-full [&>svg]:w-full [&>svg]:h-auto"
                  />
                ) : (
                  <div className="flex items-center justify-center py-8 text-brand-secondary text-sm bg-gray-50 rounded">
                    Rendering preview...
                  </div>
                )}
              </div>

              {/* Play button */}
              <button
                onClick={() => {
                  if (isPlaying) {
                    playbackRef.current?.stop();
                    playbackRef.current = null;
                  } else {
                    setIsPlaying(true);
                    playbackRef.current = playDetectedNotes(detectedNotes, bpm, () => {
                      setIsPlaying(false);
                      playbackRef.current = null;
                    });
                  }
                }}
                className={`w-full py-2 rounded text-sm font-medium transition flex items-center justify-center gap-2 ${
                  isPlaying
                    ? "bg-gray-200 hover:bg-gray-300 text-gray-700"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                }`}
              >
                {isPlaying ? (
                  <>
                    <span>⏹</span> Stop
                  </>
                ) : (
                  <>
                    <span>▶</span> Play preview
                  </>
                )}
              </button>

              {/* Insert options */}
              <div className="border-t border-gray-200 pt-4 space-y-3">
                {/* Part & staff selectors */}
                <div className="flex items-center gap-3 flex-wrap">
                  {parts.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-brand-secondary">Part</span>
                      <select
                        value={targetPart}
                        onChange={(e) => {
                          setTargetPart(e.target.value);
                          setTargetStaff(undefined);
                        }}
                        className="px-2 py-1 rounded bg-gray-50 border border-gray-200 text-xs text-gray-900 focus:outline-none focus:border-brand-primary"
                      >
                        {parts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(parts.find((p) => p.id === targetPart)?.staves ?? 1) > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-brand-secondary">Staff</span>
                      <select
                        value={targetStaff ?? ""}
                        onChange={(e) => setTargetStaff(e.target.value ? parseInt(e.target.value) : undefined)}
                        className="px-2 py-1 rounded bg-gray-50 border border-gray-200 text-xs text-gray-900 focus:outline-none focus:border-brand-primary"
                      >
                        <option value="">All staves</option>
                        <option value="1">Staff 1 (treble)</option>
                        <option value="2">Staff 2 (bass)</option>
                      </select>
                    </div>
                  )}
                </div>

                {selectedMeasures.size > 0 && (
                  <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={replaceSelected}
                      onChange={(e) => setReplaceSelected(e.target.checked)}
                      className="rounded bg-gray-50 border-gray-200"
                    />
                    Replace selected measures ({[...selectedMeasures].sort((a, b) => a - b).join(", ")})
                  </label>
                )}

                {!replaceSelected && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-brand-secondary">Insert after measure</span>
                    <select
                      value={insertAfter}
                      onChange={(e) => setInsertAfter(parseInt(e.target.value))}
                      className="px-2 py-1 rounded bg-gray-50 border border-gray-200 text-xs text-gray-900 focus:outline-none focus:border-brand-primary"
                    >
                      {Array.from({ length: scoreMeasures + 1 }, (_, i) => (
                        <option key={i} value={i}>
                          {i === 0 ? "Beginning" : `Measure ${i}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    playbackRef.current?.stop();
                    playbackRef.current = null;
                    setIsPlaying(false);
                    setPhase("setup");
                    setDetectedNotes([]);
                    audioCtxRef.current?.close();
                    audioCtxRef.current = null;
                  }}
                  className="flex-1 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm transition"
                >
                  Re-sing
                </button>
                <button
                  onClick={handleInsert}
                  className="flex-1 py-2 rounded bg-brand-primary hover:bg-brand-primary/90 text-white text-sm font-medium transition"
                >
                  Insert
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

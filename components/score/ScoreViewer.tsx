"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import MidiPlayer from "./MidiPlayer";
import { applySwingToMidi } from "@/lib/music/swing-midi";
import { getSwing, setTempo, buildNoteMapById, deleteNote } from "@/lib/music/musicxml";
import type { NotePosition } from "@/lib/music/musicxml";
import { capture } from "@/lib/telemetry/posthog";
import ScoreInfoBar from "./ScoreInfoBar";
import MobileEditSheet from "./MobileEditSheet";
import PitchControls from "./PitchControls";
import DurationControls from "./DurationControls";
import MeasureControls from "./MeasureControls";
import ToolBtn from "./ToolBtn";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

type Props = {
  musicXml: string | null;
  scoreName: string | null;
  selectedMeasures: Set<number>;
  onMeasureClick: (measureNumber: number, addToSelection: boolean) => void;
  onClearMeasureSelection?: () => void;
  onPlaybackStop?: () => void;
  onMusicXmlChange?: (xml: string, label: string) => void;
  loading?: boolean;
  swingEnabled?: boolean;
  onSwingChange?: (enabled: boolean) => void;
};

// General MIDI program → soundfont-player instrument name (programs 1–128)
const GM_INSTRUMENTS: string[] = [
  "acoustic_grand_piano",
  "bright_acoustic_piano",
  "electric_grand_piano",
  "honkytonk_piano",
  "electric_piano_1",
  "electric_piano_2",
  "harpsichord",
  "clavinet",
  "celesta",
  "glockenspiel",
  "music_box",
  "vibraphone",
  "marimba",
  "xylophone",
  "tubular_bells",
  "dulcimer",
  "drawbar_organ",
  "percussive_organ",
  "rock_organ",
  "church_organ",
  "reed_organ",
  "accordion",
  "harmonica",
  "tango_accordion",
  "acoustic_guitar_nylon",
  "acoustic_guitar_steel",
  "electric_guitar_jazz",
  "electric_guitar_clean",
  "electric_guitar_muted",
  "overdriven_guitar",
  "distortion_guitar",
  "guitar_harmonics",
  "acoustic_bass",
  "electric_bass_finger",
  "electric_bass_pick",
  "fretless_bass",
  "slap_bass_1",
  "slap_bass_2",
  "synth_bass_1",
  "synth_bass_2",
  "violin",
  "viola",
  "cello",
  "contrabass",
  "tremolo_strings",
  "pizzicato_strings",
  "orchestral_harp",
  "timpani",
  "string_ensemble_1",
  "string_ensemble_2",
  "synth_strings_1",
  "synth_strings_2",
  "choir_aahs",
  "voice_oohs",
  "synth_voice",
  "orchestra_hit",
  "trumpet",
  "trombone",
  "tuba",
  "muted_trumpet",
  "french_horn",
  "brass_section",
  "synth_brass_1",
  "synth_brass_2",
  "soprano_sax",
  "alto_sax",
  "tenor_sax",
  "baritone_sax",
  "oboe",
  "english_horn",
  "bassoon",
  "clarinet",
  "piccolo",
  "flute",
  "recorder",
  "pan_flute",
  "blown_bottle",
  "shakuhachi",
  "whistle",
  "ocarina",
  "lead_1_square",
  "lead_2_sawtooth",
  "lead_3_calliope",
  "lead_4_chiff",
  "lead_5_charang",
  "lead_6_voice",
  "lead_7_fifths",
  "lead_8_bass_lead",
  "pad_1_new_age",
  "pad_2_warm",
  "pad_3_polysynth",
  "pad_4_choir",
  "pad_5_bowed",
  "pad_6_metallic",
  "pad_7_halo",
  "pad_8_sweep",
  "fx_1_rain",
  "fx_2_soundtrack",
  "fx_3_crystal",
  "fx_4_atmosphere",
  "fx_5_brightness",
  "fx_6_goblins",
  "fx_7_echoes",
  "fx_8_scifi",
  "sitar",
  "banjo",
  "shamisen",
  "koto",
  "kalimba",
  "bag_pipe",
  "fiddle",
  "shanai",
  "tinkle_bell",
  "agogo",
  "steel_drums",
  "woodblock",
  "taiko_drum",
  "melodic_tom",
  "synth_drum",
  "reverse_cymbal",
  "guitar_fret_noise",
  "breath_noise",
  "seashore",
  "bird_tweet",
  "telephone_ring",
  "helicopter",
  "applause",
  "gunshot",
];

export default function ScoreViewer({
  musicXml,
  scoreName,
  selectedMeasures,
  onMeasureClick,
  onClearMeasureSelection,
  onPlaybackStop,
  onMusicXmlChange,
  loading,
  swingEnabled: swingProp,
  onSwingChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const onClickRef = useRef(onMeasureClick);
  onClickRef.current = onMeasureClick;
  const rawMidiBase64Ref = useRef<string | null>(null);
  const [midiSrc, setMidiSrc] = useState<string | null>(null);
  const [measureStartsMs, setMeasureStartsMs] = useState<number[]>([]);
  const [playingMeasure, setPlayingMeasure] = useState<number | null>(null);
  const [rendering, setRendering] = useState(false);

  // Note selection
  const [selectedNoteIndex, setSelectedNoteIndex] = useState<number | null>(null);
  const noteMapRef = useRef<NotePosition[]>([]);
  const selectedNoteIndexRef = useRef<number | null>(null);
  selectedNoteIndexRef.current = selectedNoteIndex;

  // Measure clipboard
  const [copiedMeasures, setCopiedMeasures] = useState<Set<number>>(new Set());

  // Single ref object for stable keyboard handler (avoid stale closures)
  const stateRef = useRef({ musicXml, onMusicXmlChange, selectedMeasures, copiedMeasures, onClearMeasureSelection });
  stateRef.current = { musicXml, onMusicXmlChange, selectedMeasures, copiedMeasures, onClearMeasureSelection };

  // Swing: "jazz" = 66% triplet swing (2:1), "straight" = no swing
  // When swingProp is provided (controlled from parent), use it; otherwise auto-detect from MusicXML.
  const [swingLocal, setSwingLocal] = useState(() => !!musicXml && !!getSwing(musicXml));
  const swingEnabled = swingProp ?? swingLocal;

  const setSwingEnabled = (enabled: boolean) => {
    setSwingLocal(enabled);
    onSwingChange?.(enabled);
  };

  // Re-detect swing from MusicXML only when no parent control is present
  useEffect(() => {
    if (swingProp === undefined) setSwingLocal(!!musicXml && !!getSwing(musicXml));
  }, [musicXml, swingProp]);

  // Recompute midiSrc whenever swing toggle changes (no Verovio re-render needed)
  useEffect(() => {
    const raw = rawMidiBase64Ref.current;
    if (!raw) return;
    const processed = swingEnabled ? applySwingToMidi(raw, 2 / 3) : raw;
    setMidiSrc(`data:audio/midi;base64,${processed}`);
  }, [swingEnabled]);

  // Build channel → instrument map from all <midi-instrument> blocks in MusicXML
  const channelInstruments = useMemo(() => {
    const result: Record<number, string> = {};
    if (musicXml) {
      const blockRe = /<midi-instrument[\s\S]*?<\/midi-instrument>/g;
      for (const block of musicXml.matchAll(blockRe)) {
        const channel = parseInt(block[0].match(/<midi-channel>(\d+)<\/midi-channel>/)?.[1] ?? "0");
        const program = parseInt(block[0].match(/<midi-program>(\d+)<\/midi-program>/)?.[1] ?? "1");
        if (channel > 0 && channel !== 10) {
          // Skip channel 10 (GM percussion) — no matching soundfont available in this player
          result[channel] = GM_INSTRUMENTS[program - 1] ?? "acoustic_grand_piano";
        }
      }
    }
    return result;
  }, [musicXml]);

  // ── render with Verovio ───────────────────────────────────────────────────
  useEffect(() => {
    if (!musicXml || !containerRef.current) return;
    let cancelled = false;

    setRendering(true);
    setMeasureStartsMs([]);
    async function render() {
      // Yield to the browser so React can paint the spinner before heavy work
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (cancelled) return;

      const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
        import("verovio/wasm"),
        import("verovio/esm"),
      ]);
      const VerovioModule = await createVerovioModule();
      const tk = new VerovioToolkit(VerovioModule);
      if (cancelled || !containerRef.current) return;

      tk.setOptions({
        pageWidth: 2100,
        adjustPageHeight: 1,
        scale: 40,
        breaks: "auto",
        footer: "none",
        header: "none",
      });
      tk.loadData(musicXml!);

      const container = containerRef.current;
      container.innerHTML = "";

      const pageCount: number = tk.getPageCount();
      for (let p = 1; p <= pageCount; p++) {
        const div = document.createElement("div");
        div.innerHTML = tk.renderToSVG(p) as string;
        const svg = div.firstElementChild as SVGSVGElement | null;
        if (!svg) continue;
        svg.style.cssText = "width:100%;height:auto;display:block;margin-bottom:16px;";
        container.appendChild(svg);
      }

      // Export MIDI for playback
      const midiBase64 = tk.renderToMIDI() as string;
      if (!cancelled && midiBase64) {
        rawMidiBase64Ref.current = midiBase64;
        const processed = swingEnabled ? applySwingToMidi(midiBase64, 2 / 3) : midiBase64;
        setMidiSrc(`data:audio/midi;base64,${processed}`);
      }

      // Build measure start times (ms) from Verovio timemap for accurate playback tracking
      try {
        const timemapRaw = (tk as any).renderToTimemap({ includeMeasures: true });
        const timemap: Array<{ tstamp: number; measureOn?: string }> =
          typeof timemapRaw === "string" ? JSON.parse(timemapRaw) : timemapRaw;
        const starts = timemap.filter((e) => e.measureOn !== undefined).map((e) => e.tstamp);
        if (!cancelled && starts.length > 0) setMeasureStartsMs(starts);
      } catch {
        /* ignore timemap errors, fall back to tick math */
      }

      // Wait one frame so the browser lays out the SVGs before getBBox()
      requestAnimationFrame(() => {
        if (cancelled || !containerRef.current) return;
        setRendering(false);
        let idx = 0;
        containerRef.current.querySelectorAll<SVGGElement>(".measure").forEach((measureEl) => {
          idx++;
          const measureNum = idx;

          measureEl.style.pointerEvents = "bounding-box";
          measureEl.style.cursor = "pointer";
          measureEl.setAttribute("role", "button");
          measureEl.setAttribute("tabindex", "0");
          measureEl.setAttribute("aria-label", `Measure ${measureNum}`);

          const bbox = measureEl.getBBox();
          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("x", String(bbox.x));
          rect.setAttribute("y", String(bbox.y));
          rect.setAttribute("width", String(bbox.width));
          rect.setAttribute("height", String(bbox.height));
          rect.setAttribute("fill", "rgba(0,0,0,0)");
          rect.setAttribute("pointer-events", "none");
          rect.setAttribute("data-hl", String(measureNum));
          measureEl.insertBefore(rect, measureEl.firstChild);

          measureEl.addEventListener("click", (e) => {
            e.stopPropagation();
            setSelectedNoteIndex(null);
            onClickRef.current(measureNum, (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey);
          });
        });

        // Build note/rest map by ID and set up click handlers
        const noteMapById = buildNoteMapById(musicXml!);
        const noteMapArray: NotePosition[] = [];
        let matchedCount = 0;
        containerRef.current.querySelectorAll<SVGGElement>("g.note, g.rest").forEach((el, i) => {
          const svgId = el.id;
          const position = svgId ? noteMapById.get(svgId) : undefined;
          if (position) {
            noteMapArray.push(position);
            matchedCount++;
          } else {
            noteMapArray.push({ partId: "", measureNumber: 0, entryIndex: -1, isRest: true });
          }
          el.dataset.ysIndex = String(i);
          el.style.cursor = "pointer";
          el.setAttribute("role", "button");
          el.setAttribute("tabindex", "0");
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            onClearMeasureSelection?.();
            console.log("[score] Note selected", { svgIndex: i, svgId: el.id, position: position ?? null });
            setSelectedNoteIndex(i);
          });
        });
        noteMapRef.current = noteMapArray;
        console.log("[score] NoteMap built", {
          total: noteMapArray.length,
          matched: matchedCount,
          unmatched: noteMapArray.length - matchedCount,
        });

        // Re-apply highlight if a note/rest was already selected (after re-render)
        const currentIdx = selectedNoteIndexRef.current;
        if (currentIdx !== null) {
          const el = containerRef.current?.querySelector<SVGGElement>(`[data-ys-index="${currentIdx}"]`);
          if (el) applyNoteHighlight(el);
        }
      });
    }

    render().catch((err) => {
      console.error(err);
      setRendering(false);
    });
    return () => {
      cancelled = true;
      setRendering(false);
    };
  }, [musicXml]);

  // ── note highlight helper ─────────────────────────────────────────────────
  function applyNoteHighlight(noteEl: SVGGElement) {
    const bbox = noteEl.getBBox();
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(bbox.x));
    rect.setAttribute("y", String(bbox.y));
    rect.setAttribute("width", String(bbox.width));
    rect.setAttribute("height", String(bbox.height));
    rect.setAttribute("fill", "rgba(99,102,241,0.35)");
    rect.setAttribute("pointer-events", "none");
    rect.setAttribute("data-ys-note-hl", "1");
    noteEl.insertBefore(rect, noteEl.firstChild);
  }

  // ── note selection highlight ──────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll("[data-ys-note-hl]").forEach((el) => el.remove());
    if (selectedNoteIndex === null) return;
    const noteEl = container.querySelector<SVGGElement>(`[data-ys-index="${selectedNoteIndex}"]`);
    if (!noteEl) return;
    applyNoteHighlight(noteEl);
  }, [selectedNoteIndex]);

  // ── keyboard shortcuts (note + measure editing) ───────────────────────────
  useKeyboardShortcuts(stateRef, selectedNoteIndexRef, noteMapRef, setSelectedNoteIndex, setCopiedMeasures);

  // ── selection + playback highlight ───────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<SVGRectElement>("[data-hl]").forEach((rect) => {
      const num = parseInt(rect.getAttribute("data-hl") ?? "0");
      if (num === playingMeasure) {
        rect.setAttribute("fill", "rgba(34,197,94,0.35)");
      } else if (selectedMeasures.has(num)) {
        rect.setAttribute("fill", "rgba(99,102,241,0.25)");
      } else {
        rect.setAttribute("fill", "rgba(0,0,0,0)");
      }
    });
  }, [selectedMeasures, playingMeasure]);

  // ── auto-scroll to playing measure + deselect on stop ───────────────────
  const prevPlayingMeasureRef = useRef<number | null>(null);
  useEffect(() => {
    if (playingMeasure === null && prevPlayingMeasureRef.current !== null) {
      capture("playback_stopped");
      onPlaybackStop?.();
    }
    if (playingMeasure !== null && prevPlayingMeasureRef.current === null) {
      capture("playback_started");
    }
    prevPlayingMeasureRef.current = playingMeasure;
    if (playingMeasure === null) return;
    const container = containerRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!container || !scrollEl) return;

    const rect = container.querySelector<SVGRectElement>(`[data-hl="${playingMeasure}"]`);
    if (!rect) return;

    const rectBounds = rect.getBoundingClientRect();
    const scrollBounds = scrollEl.getBoundingClientRect();

    const topInScroll = rectBounds.top - scrollBounds.top + scrollEl.scrollTop;
    const bottomInScroll = rectBounds.bottom - scrollBounds.top + scrollEl.scrollTop;
    const alreadyVisible =
      topInScroll >= scrollEl.scrollTop && bottomInScroll <= scrollEl.scrollTop + scrollEl.clientHeight;

    if (!alreadyVisible) {
      const target = topInScroll - scrollEl.clientHeight / 2 + rectBounds.height / 2;
      scrollEl.scrollTo({ top: target, behavior: "smooth" });
    }
  }, [playingMeasure]);

  // Memoize tempo change callback
  const onTempoChange = useMemo(() => {
    if (!onMusicXmlChange || !musicXml) return undefined;
    return (bpm: number) => {
      const updated = setTempo(musicXml, bpm);
      capture("tempo_changed_inline", { bpm });
      onMusicXmlChange(updated, `Tempo: \u2669 = ${bpm}`);
    };
  }, [musicXml, onMusicXmlChange]);

  if (!musicXml || loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-brand-primary rounded-full animate-spin" />
              <span className="text-xs text-gray-400">Loading score…</span>
            </div>
          ) : (
            <span className="text-brand-secondary text-sm">Upload a score and send an instruction to see it here.</span>
          )}
        </div>
      </div>
    );
  }

  const downloadMusicXml = () => {
    if (!musicXml) return;
    capture("download_clicked", { format: "musicxml" });
    const blob = new Blob([musicXml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scoreName ?? "score"}.musicxml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Info bar: metadata + controls */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 border-b border-gray-200 bg-gray-50">
        <div className="flex-1 min-w-0">
          <ScoreInfoBar musicXml={musicXml} onTempoChange={onTempoChange} />
        </div>
        {/* Controls — grouped with consistent style */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Jazz / Straight toggle */}
          {midiSrc && (
            <button
              onClick={() => {
                capture("swing_toggled", { enabled: !swingEnabled });
                setSwingEnabled(!swingEnabled);
              }}
              title={swingEnabled ? "Switch to straight" : "Switch to jazz swing"}
              className={`text-xs px-3 py-1 rounded-lg transition ${
                swingEnabled
                  ? "bg-brand-accent hover:bg-brand-accent/90 text-gray-900 font-medium"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-500"
              }`}
            >
              {swingEnabled ? "Jazz" : "Straight"}
            </button>
          )}
          {/* Play */}
          {midiSrc ? (
            <MidiPlayer
              src={midiSrc}
              channelInstruments={channelInstruments}
              measureStartsMs={measureStartsMs}
              selectedMeasures={selectedMeasures}
              playFromMeasure={
                selectedNoteIndex !== null ? noteMapRef.current[selectedNoteIndex]?.measureNumber : undefined
              }
              onMeasureChange={setPlayingMeasure}
            />
          ) : (
            <span className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-400">Rendering…</span>
          )}
          {/* Export */}
          <button
            onClick={downloadMusicXml}
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
            title="Download as MusicXML"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
              <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
            </svg>
            <span className="hidden md:inline">Export</span>
          </button>
        </div>
      </div>

      {/* Contextual editing toolbar — desktop only */}
      {(selectedNoteIndex !== null || selectedMeasures.size > 0) && onMusicXmlChange && (
        <div className="hidden md:flex items-center gap-1 px-3 py-1 border-b border-gray-100 bg-gray-50 flex-wrap">
          {selectedNoteIndex !== null && (
            <>
              <span className="text-[10px] text-gray-400 mr-0.5 shrink-0">
                {noteMapRef.current[selectedNoteIndex]?.isRest ? "Rest:" : "Note:"}
              </span>
              <PitchControls
                selectedNoteIndex={selectedNoteIndex}
                noteMapRef={noteMapRef}
                musicXml={musicXml}
                onMusicXmlChange={onMusicXmlChange}
              />
              {!noteMapRef.current[selectedNoteIndex]?.isRest && !noteMapRef.current[selectedNoteIndex]?.isDrum && (
                <div className="w-px h-3.5 bg-gray-200 mx-0.5" />
              )}
              <DurationControls
                selectedNoteIndex={selectedNoteIndex}
                noteMapRef={noteMapRef}
                musicXml={musicXml}
                onMusicXmlChange={onMusicXmlChange}
              />
              <div className="w-px h-3.5 bg-gray-200 mx-0.5" />
              <ToolBtn
                danger
                onClick={() => {
                  const p = noteMapRef.current[selectedNoteIndex];
                  if (p && musicXml) {
                    onMusicXmlChange(deleteNote(musicXml, p), "Delete note");
                    setSelectedNoteIndex(null);
                  }
                }}
                title="Delete note (Delete)"
              >
                ✕ Delete
              </ToolBtn>
            </>
          )}
          {selectedMeasures.size > 0 && (
            <MeasureControls
              selectedMeasures={selectedMeasures}
              copiedMeasures={copiedMeasures}
              musicXml={musicXml}
              onMusicXmlChange={onMusicXmlChange}
              onClearMeasureSelection={onClearMeasureSelection}
              setCopiedMeasures={setCopiedMeasures}
            />
          )}
        </div>
      )}

      {/* Mobile bottom sheet — shown only on small screens */}
      <MobileEditSheet
        selectedNoteIndex={selectedNoteIndex}
        noteMapRef={noteMapRef}
        selectedMeasures={selectedMeasures}
        copiedMeasures={copiedMeasures}
        musicXml={musicXml}
        onMusicXmlChange={onMusicXmlChange}
        onClearMeasureSelection={onClearMeasureSelection}
        setSelectedNoteIndex={setSelectedNoteIndex}
        setCopiedMeasures={setCopiedMeasures}
      />

      {/* Score */}
      <div className="flex-1 overflow-y-auto bg-white relative" ref={scrollContainerRef}>
        {rendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-brand-primary rounded-full animate-spin" />
              <span className="text-xs text-gray-400">Rendering…</span>
            </div>
          </div>
        )}
        <div className="p-3 md:p-6" ref={containerRef} />
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useRef, useState } from "react";
import MidiPlayer from "./MidiPlayer";
import { applySwingToMidi } from "@/lib/swing-midi";
import { getSwing, setTempo, buildNoteMap, changeNotePitch, deleteNote, changeNoteDuration, duplicateMeasures, pasteMeasures, deleteMeasures } from "@/lib/musicxml";
import type { NotePosition } from "@/lib/musicxml";
import { capture } from "@/lib/posthog";

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
  "acoustic_grand_piano","bright_acoustic_piano","electric_grand_piano","honkytonk_piano",
  "electric_piano_1","electric_piano_2","harpsichord","clavinet",
  "celesta","glockenspiel","music_box","vibraphone","marimba","xylophone","tubular_bells","dulcimer",
  "drawbar_organ","percussive_organ","rock_organ","church_organ","reed_organ","accordion","harmonica","tango_accordion",
  "acoustic_guitar_nylon","acoustic_guitar_steel","electric_guitar_jazz","electric_guitar_clean",
  "electric_guitar_muted","overdriven_guitar","distortion_guitar","guitar_harmonics",
  "acoustic_bass","electric_bass_finger","electric_bass_pick","fretless_bass",
  "slap_bass_1","slap_bass_2","synth_bass_1","synth_bass_2",
  "violin","viola","cello","contrabass","tremolo_strings","pizzicato_strings","orchestral_harp","timpani",
  "string_ensemble_1","string_ensemble_2","synth_strings_1","synth_strings_2",
  "choir_aahs","voice_oohs","synth_voice","orchestra_hit",
  "trumpet","trombone","tuba","muted_trumpet","french_horn","brass_section","synth_brass_1","synth_brass_2",
  "soprano_sax","alto_sax","tenor_sax","baritone_sax","oboe","english_horn","bassoon","clarinet",
  "piccolo","flute","recorder","pan_flute","blown_bottle","shakuhachi","whistle","ocarina",
  "lead_1_square","lead_2_sawtooth","lead_3_calliope","lead_4_chiff","lead_5_charang",
  "lead_6_voice","lead_7_fifths","lead_8_bass_lead",
  "pad_1_new_age","pad_2_warm","pad_3_polysynth","pad_4_choir","pad_5_bowed",
  "pad_6_metallic","pad_7_halo","pad_8_sweep",
  "fx_1_rain","fx_2_soundtrack","fx_3_crystal","fx_4_atmosphere","fx_5_brightness",
  "fx_6_goblins","fx_7_echoes","fx_8_scifi",
  "sitar","banjo","shamisen","koto","kalimba","bag_pipe","fiddle","shanai",
  "tinkle_bell","agogo","steel_drums","woodblock","taiko_drum","melodic_tom","synth_drum","reverse_cymbal",
  "guitar_fret_noise","breath_noise","seashore","bird_tweet","telephone_ring","helicopter","applause","gunshot",
];

export default function ScoreViewer({
  musicXml, scoreName, selectedMeasures, onMeasureClick, onClearMeasureSelection,
  onPlaybackStop, onMusicXmlChange, loading,
  swingEnabled: swingProp, onSwingChange,
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

  // Refs for stable keyboard handler (avoid stale closures)
  const musicXmlRef = useRef(musicXml);
  musicXmlRef.current = musicXml;
  const onMusicXmlChangeRef = useRef(onMusicXmlChange);
  onMusicXmlChangeRef.current = onMusicXmlChange;
  const selectedMeasuresRef = useRef(selectedMeasures);
  selectedMeasuresRef.current = selectedMeasures;
  const copiedMeasuresRef = useRef(copiedMeasures);
  copiedMeasuresRef.current = copiedMeasures;
  const onClearMeasureSelectionRef = useRef(onClearMeasureSelection);
  onClearMeasureSelectionRef.current = onClearMeasureSelection;

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
  const channelInstruments: Record<number, string> = {};
  if (musicXml) {
    const blockRe = /<midi-instrument[\s\S]*?<\/midi-instrument>/g;
    for (const block of musicXml.matchAll(blockRe)) {
      const channel = parseInt(block[0].match(/<midi-channel>(\d+)<\/midi-channel>/)?.[1] ?? "0");
      const program = parseInt(block[0].match(/<midi-program>(\d+)<\/midi-program>/)?.[1] ?? "1");
      if (channel > 0 && channel !== 10) {
        // Skip channel 10 (GM percussion) — no matching soundfont available in this player
        channelInstruments[channel] = GM_INSTRUMENTS[program - 1] ?? "acoustic_grand_piano";
      }
    }
  }

  // ── render with Verovio ───────────────────────────────────────────────────
  useEffect(() => {
    if (!musicXml || !containerRef.current) return;
    let cancelled = false;

    setRendering(true);
    setMeasureStartsMs([]);
    async function render() {
      // Yield to the browser so React can paint the spinner before heavy work
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (cancelled) return;

      const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
        import("verovio/wasm"),
        import("verovio/esm"),
      ]);
      const VerovioModule = await createVerovioModule();
      const tk = new VerovioToolkit(VerovioModule);
      if (cancelled || !containerRef.current) return;

      tk.setOptions({ pageWidth: 2100, adjustPageHeight: 1, scale: 40,
                      breaks: "auto", footer: "none", header: "none" });
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
        const starts = timemap
          .filter((e) => e.measureOn !== undefined)
          .map((e) => e.tstamp);
        if (!cancelled && starts.length > 0) setMeasureStartsMs(starts);
      } catch { /* ignore timemap errors, fall back to tick math */ }

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

          const bbox = measureEl.getBBox();
          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("x",      String(bbox.x));
          rect.setAttribute("y",      String(bbox.y));
          rect.setAttribute("width",  String(bbox.width));
          rect.setAttribute("height", String(bbox.height));
          rect.setAttribute("fill",   "rgba(0,0,0,0)");
          rect.setAttribute("pointer-events", "none");
          rect.setAttribute("data-hl", String(measureNum));
          measureEl.insertBefore(rect, measureEl.firstChild);

          measureEl.addEventListener("click", (e) => {
            e.stopPropagation();
            setSelectedNoteIndex(null);
            onClickRef.current(measureNum, (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey);
          });
        });

        // Build note/rest map and set up click handlers
        noteMapRef.current = buildNoteMap(musicXml!);
        containerRef.current.querySelectorAll<SVGGElement>("g.note, g.rest").forEach((el, i) => {
          el.dataset.ysIndex = String(i);
          el.style.cursor = "pointer";
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            onClearMeasureSelection?.();
            setSelectedNoteIndex(i);
          });
        });

        // Re-apply highlight if a note/rest was already selected (after re-render)
        const currentIdx = selectedNoteIndexRef.current;
        if (currentIdx !== null) {
          const el = containerRef.current?.querySelector<SVGGElement>(`[data-ys-index="${currentIdx}"]`);
          if (el) applyNoteHighlight(el);
        }
      });
    }

    render().catch((err) => { console.error(err); setRendering(false); });
    return () => { cancelled = true; setRendering(false); };
  }, [musicXml]);

  // ── note highlight helper ─────────────────────────────────────────────────
  function applyNoteHighlight(noteEl: SVGGElement) {
    const bbox = noteEl.getBBox();
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x",      String(bbox.x));
    rect.setAttribute("y",      String(bbox.y));
    rect.setAttribute("width",  String(bbox.width));
    rect.setAttribute("height", String(bbox.height));
    rect.setAttribute("fill",   "rgba(99,102,241,0.35)");
    rect.setAttribute("pointer-events", "none");
    rect.setAttribute("data-ys-note-hl", "1");
    noteEl.insertBefore(rect, noteEl.firstChild);
  }

  // ── note selection highlight ──────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll("[data-ys-note-hl]").forEach(el => el.remove());
    if (selectedNoteIndex === null) return;
    const noteEl = container.querySelector<SVGGElement>(`[data-ys-index="${selectedNoteIndex}"]`);
    if (!noteEl) return;
    applyNoteHighlight(noteEl);
  }, [selectedNoteIndex]);

  // ── keyboard shortcuts (note + measure editing) ───────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const xml = musicXmlRef.current;
      const onChange = onMusicXmlChangeRef.current;
      const idx = selectedNoteIndexRef.current;
      const measures = selectedMeasuresRef.current;
      const copied = copiedMeasuresRef.current;

      // ── Note actions ──
      if (idx !== null && xml) {
        const position = noteMapRef.current[idx];
        if (position) {
          if (!position.isRest && !position.isDrum && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            const semitones = (e.key === "ArrowUp" ? 1 : -1) * (ctrl ? 12 : 1);
            onChange?.(changeNotePitch(xml, position, semitones),
              ctrl ? (e.key === "ArrowUp" ? "Octave up" : "Octave down")
                   : (e.key === "ArrowUp" ? "Move note up" : "Move note down"));
            return;
          }
          if (!ctrl && (e.key === "Delete" || e.key === "Backspace")) {
            e.preventDefault();
            onChange?.(deleteNote(xml, position), "Delete note");
            setSelectedNoteIndex(null);
            return;
          }
          if (!ctrl && /^[1-7]$/.test(e.key)) {
            e.preventDefault();
            onChange?.(changeNoteDuration(xml, position, e.key as "1"|"2"|"3"|"4"|"5"|"6"|"7"), "Change duration");
            return;
          }
        }
      }

      // ── Measure actions ──
      if (ctrl && xml) {
        if (e.key === "c" && measures.size > 0) {
          e.preventDefault();
          setCopiedMeasures(new Set(measures));
        } else if (e.key === "v" && copied.size > 0 && measures.size > 0) {
          e.preventDefault();
          onChange?.(pasteMeasures(xml, [...copied], Math.min(...measures)), "Paste measures");
        } else if (e.key === "d" && measures.size > 0) {
          e.preventDefault();
          onChange?.(duplicateMeasures(xml, [...measures].sort((a, b) => a - b)), "Duplicate measures");
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // stable — all mutable values accessed via refs

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

    const topInScroll    = rectBounds.top  - scrollBounds.top  + scrollEl.scrollTop;
    const bottomInScroll = rectBounds.bottom - scrollBounds.top + scrollEl.scrollTop;
    const alreadyVisible = topInScroll >= scrollEl.scrollTop &&
                           bottomInScroll <= scrollEl.scrollTop + scrollEl.clientHeight;

    if (!alreadyVisible) {
      const target = topInScroll - scrollEl.clientHeight / 2 + rectBounds.height / 2;
      scrollEl.scrollTo({ top: target, behavior: "smooth" });
    }
  }, [playingMeasure]);

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
            <span className="text-brand-secondary text-sm">
              Upload a score and send an instruction to see it here.
            </span>
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
          <ScoreInfoBar
            musicXml={musicXml}
            onTempoChange={onMusicXmlChange && musicXml ? (bpm) => {
              const updated = setTempo(musicXml, bpm);
              capture("tempo_changed_inline", { bpm });
              onMusicXmlChange(updated, `Tempo: ♩ = ${bpm}`);
            } : undefined}
          />
        </div>
        {/* Controls — grouped with consistent style */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Jazz / Straight toggle */}
          {midiSrc && (
            <button
              onClick={() => { capture("swing_toggled", { enabled: !swingEnabled }); setSwingEnabled(!swingEnabled); }}
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
              playFromMeasure={selectedNoteIndex !== null ? noteMapRef.current[selectedNoteIndex]?.measureNumber : undefined}
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
          {selectedNoteIndex !== null && (<>
            <span className="text-[10px] text-gray-400 mr-0.5 shrink-0">{noteMapRef.current[selectedNoteIndex]?.isRest ? "Rest:" : "Note:"}</span>
            {!noteMapRef.current[selectedNoteIndex]?.isRest && !noteMapRef.current[selectedNoteIndex]?.isDrum && (<>
              <ToolBtn onClick={() => { const p = noteMapRef.current[selectedNoteIndex]; if (p && musicXml) onMusicXmlChange(changeNotePitch(musicXml, p, -12), "Octave down"); }} title="Octave down (Ctrl+↓)">↓ 8va</ToolBtn>
              <ToolBtn onClick={() => { const p = noteMapRef.current[selectedNoteIndex]; if (p && musicXml) onMusicXmlChange(changeNotePitch(musicXml, p, -1), "Move note down"); }} title="Semitone down (↓)">↓</ToolBtn>
              <ToolBtn onClick={() => { const p = noteMapRef.current[selectedNoteIndex]; if (p && musicXml) onMusicXmlChange(changeNotePitch(musicXml, p, 1), "Move note up"); }} title="Semitone up (↑)">↑</ToolBtn>
              <ToolBtn onClick={() => { const p = noteMapRef.current[selectedNoteIndex]; if (p && musicXml) onMusicXmlChange(changeNotePitch(musicXml, p, 12), "Octave up"); }} title="Octave up (Ctrl+↑)">↑ 8va</ToolBtn>
              <div className="w-px h-3.5 bg-gray-200 mx-0.5" />
            </>)}
            {([1,2,3,4,5,6,7] as const).map((dur) => (
              <ToolBtn key={dur} onClick={() => { const p = noteMapRef.current[selectedNoteIndex]; if (p && musicXml) onMusicXmlChange(changeNoteDuration(musicXml, p, String(dur) as "1"|"2"|"3"|"4"|"5"|"6"|"7"), "Change duration"); }} title={["64th","32nd","16th","Eighth","Quarter","Half","Whole"][dur - 1]}><NoteSymbol dur={dur} /></ToolBtn>
            ))}
            <div className="w-px h-3.5 bg-gray-200 mx-0.5" />
            <ToolBtn danger onClick={() => { const p = noteMapRef.current[selectedNoteIndex]; if (p && musicXml) { onMusicXmlChange(deleteNote(musicXml, p), "Delete note"); setSelectedNoteIndex(null); } }} title="Delete note (Delete)">✕ Delete</ToolBtn>
          </>)}
          {selectedMeasures.size > 0 && (<>
            <span className="text-[10px] text-gray-400 mr-0.5 shrink-0">{selectedMeasures.size} measure{selectedMeasures.size > 1 ? "s" : ""}:</span>
            <ToolBtn onClick={() => setCopiedMeasures(new Set(selectedMeasures))} title="Copy (Ctrl+C)">Copy</ToolBtn>
            <ToolBtn disabled={copiedMeasures.size === 0} onClick={() => { if (musicXml && copiedMeasures.size > 0) onMusicXmlChange(pasteMeasures(musicXml, [...copiedMeasures], Math.min(...selectedMeasures)), "Paste measures"); }} title="Paste (Ctrl+V)">Paste</ToolBtn>
            <ToolBtn onClick={() => { if (musicXml) onMusicXmlChange(duplicateMeasures(musicXml, [...selectedMeasures].sort((a,b)=>a-b)), "Duplicate measures"); }} title="Duplicate (Ctrl+D)">Duplicate</ToolBtn>
            <ToolBtn danger onClick={() => { if (musicXml) { onMusicXmlChange(deleteMeasures(musicXml, [...selectedMeasures]), "Delete measures"); onClearMeasureSelection?.(); } }} title="Delete measures">✕ Delete</ToolBtn>
          </>)}
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

// ─── Score info bar ─────────────────────────────────────────────────────────

const FIFTHS_KEYS = ["Cb","Gb","Db","Ab","Eb","Bb","F","C","G","D","A","E","B","F#","C#"];

function ScoreInfoBar({ musicXml, onTempoChange }: { musicXml: string; onTempoChange?: (bpm: number) => void }) {
  const instruments = [...musicXml.matchAll(/<part-name>([^<]+)<\/part-name>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .join(", ");

  const fifths = parseInt(musicXml.match(/<fifths>(-?\d+)<\/fifths>/)?.[1] ?? "0");
  const key = FIFTHS_KEYS[fifths + 7] ?? "C";

  const beatsStr = musicXml.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4";
  const beatTypeStr = musicXml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4";

  const tempoMatch = musicXml.match(/<sound\b[^>]*tempo="(\d+(?:\.\d+)?)"/);
  const tempoExplicit = tempoMatch ? Math.round(parseFloat(tempoMatch[1])) : null;
  const tempo = tempoExplicit ?? 120;

  // Count measures in first part only
  const firstPart = musicXml.match(/<part\b[^>]*>[\s\S]*?<\/part>/);
  const measureCount = firstPart
    ? (firstPart[0].match(/<measure\b/g) ?? []).length
    : 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tempo);
  const committedRef = useRef(false);

  function startEdit() {
    if (!onTempoChange) return;
    committedRef.current = false;
    setDraft(tempo);
    setEditing(true);
  }

  function commit(value: number) {
    if (committedRef.current) { setEditing(false); return; }
    const bpm = Math.round(value);
    if (bpm >= 20 && bpm <= 300 && bpm !== tempo) {
      committedRef.current = true;
      onTempoChange?.(bpm);
    }
    setEditing(false);
  }

  // Reset editing state when musicXml changes (e.g. after a commit re-render)
  const prevTempoRef = useRef(tempo);
  if (prevTempoRef.current !== tempo) {
    prevTempoRef.current = tempo;
    setDraft(tempo);
    if (editing) setEditing(false);
  }

  const items: Array<{ label: string; dim?: boolean; isTempoSlot?: boolean }> = [];
  if (instruments) items.push({ label: instruments });
  items.push({ label: key });
  items.push({ label: `${beatsStr}/${beatTypeStr}` });
  items.push({ label: `♩ = ${tempo}`, dim: !tempoExplicit, isTempoSlot: true });
  items.push({ label: `${measureCount} bars` });

  return (
    <div className="flex items-center gap-3 text-[11px] text-brand-secondary">
      {items.map((item, i) => (
        <span key={i} className={`flex items-center gap-3${item.dim ? " opacity-40" : ""}`}>
          {i > 0 && <span className="text-gray-300">·</span>}
          {item.isTempoSlot && onTempoChange ? (
            editing ? (
              <span className="flex items-center gap-2">
                <span className="shrink-0">♩ =</span>
                <input
                  type="range"
                  min={20}
                  max={300}
                  step={1}
                  value={draft}
                  onChange={(e) => setDraft(Number(e.target.value))}
                  onMouseUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
                  onTouchEnd={(e) => commit(Number((e.target as HTMLInputElement).value))}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditing(false);
                    if (e.key === "Enter") commit(draft);
                  }}
                  onBlur={() => commit(draft)}
                  className="w-24 accent-brand-primary cursor-pointer"
                />
                <span className="tabular-nums text-gray-900 w-7 shrink-0">{draft}</span>
              </span>
            ) : (
              <button
                onClick={startEdit}
                title="Click to change tempo"
                className="hover:text-gray-900 hover:underline decoration-dotted underline-offset-2 transition cursor-pointer"
              >
                {item.label}
              </button>
            )
          ) : (
            item.label
          )}
        </span>
      ))}
    </div>
  );
}

// ─── NoteSymbol ───────────────────────────────────────────────────────────────

function NoteSymbol({ dur }: { dur: 1|2|3|4|5|6|7 }) {
  const numFlags = [4, 3, 2, 1, 0, 0, 0][dur - 1];
  const filled = dur <= 5;
  const hasStem = dur <= 6;
  return (
    <svg viewBox="0 0 9 16" width="9" height="16" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <ellipse
        cx="3" cy="13" rx="2.8" ry="1.8"
        fill={filled ? "currentColor" : "none"}
        stroke={filled ? "none" : "currentColor"}
        strokeWidth="1.1"
        transform="rotate(-20 3 13)"
      />
      {hasStem && <line x1="5.5" y1="12" x2="5.5" y2="1" stroke="currentColor" strokeWidth="1" />}
      {numFlags >= 1 && <path d="M5.5 1 C8.5 2.5 8 5 6.5 6" stroke="currentColor" strokeWidth="1" fill="none" />}
      {numFlags >= 2 && <path d="M5.5 3.5 C8.5 5 8 7.5 6.5 8.5" stroke="currentColor" strokeWidth="1" fill="none" />}
      {numFlags >= 3 && <path d="M5.5 6 C8.5 7.5 8 10 6.5 11" stroke="currentColor" strokeWidth="1" fill="none" />}
      {numFlags >= 4 && <path d="M5.5 8.5 C8.5 9.5 8 11.5 6.5 12" stroke="currentColor" strokeWidth="1" fill="none" />}
    </svg>
  );
}

// ─── ToolBtn ──────────────────────────────────────────────────────────────────

// ─── Mobile bottom sheet ──────────────────────────────────────────────────────

function MobileEditSheet({
  selectedNoteIndex, noteMapRef, selectedMeasures, copiedMeasures,
  musicXml, onMusicXmlChange, onClearMeasureSelection,
  setSelectedNoteIndex, setCopiedMeasures,
}: {
  selectedNoteIndex: number | null;
  noteMapRef: React.RefObject<NotePosition[]>;
  selectedMeasures: Set<number>;
  copiedMeasures: Set<number>;
  musicXml: string | null;
  onMusicXmlChange?: (xml: string, label: string) => void;
  onClearMeasureSelection?: () => void;
  setSelectedNoteIndex: (i: number | null) => void;
  setCopiedMeasures: (s: Set<number>) => void;
}) {
  const isOpen = (selectedNoteIndex !== null || selectedMeasures.size > 0) && !!onMusicXmlChange;
  const note = selectedNoteIndex !== null ? noteMapRef.current[selectedNoteIndex] : null;

  function dismiss() {
    setSelectedNoteIndex(null);
    onClearMeasureSelection?.();
  }

  return (
    <div
      className={`md:hidden fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 ease-out ${
        isOpen ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="bg-white rounded-t-2xl shadow-2xl border-t border-gray-200">
        {/* Handle + dismiss */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="w-8" />
          <div className="w-10 h-1 rounded-full bg-gray-300" />
          <button onClick={dismiss} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 transition">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Note editing */}
        {selectedNoteIndex !== null && note && (
          <div className="px-4 pb-8 space-y-3">
            <p className="text-xs font-medium text-gray-400 text-center uppercase tracking-wide">
              {note.isRest ? "Rest" : note.isDrum ? "Drum" : "Note"}
            </p>

            {/* Pitch row — pitched notes only (not rests, not drum notes) */}
            {!note.isRest && !note.isDrum && (
              <div className="grid grid-cols-4 gap-2">
                {([
                  { label: "↓ 8va", delta: -12, title: "Octave down" },
                  { label: "↓", delta: -1, title: "Semitone down" },
                  { label: "↑", delta: 1, title: "Semitone up" },
                  { label: "↑ 8va", delta: 12, title: "Octave up" },
                ] as const).map(({ label, delta, title }) => (
                  <button
                    key={label}
                    onClick={() => { if (musicXml) onMusicXmlChange!(changeNotePitch(musicXml, note, delta), title); }}
                    className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-sm font-medium text-gray-700 transition active:scale-95"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Duration row */}
            <div className="grid grid-cols-7 gap-1.5">
              {([1, 2, 3, 4, 5, 6, 7] as const).map((dur) => (
                <button
                  key={dur}
                  onClick={() => { if (musicXml) onMusicXmlChange!(changeNoteDuration(musicXml, note, String(dur) as "1"|"2"|"3"|"4"|"5"|"6"|"7"), "Change duration"); }}
                  title={["64th","32nd","16th","Eighth","Quarter","Half","Whole"][dur - 1]}
                  className="flex items-center justify-center py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-gray-700 transition active:scale-95"
                >
                  <NoteSymbol dur={dur} />
                </button>
              ))}
            </div>

            {/* Delete */}
            <button
              onClick={() => { if (musicXml) { onMusicXmlChange!(deleteNote(musicXml, note), "Delete note"); setSelectedNoteIndex(null); } }}
              className="w-full py-3 rounded-xl bg-red-50 active:bg-red-100 text-red-600 text-sm font-medium transition active:scale-95"
            >
              ✕ Delete note
            </button>
          </div>
        )}

        {/* Measure editing */}
        {selectedMeasures.size > 0 && (
          <div className="px-4 pb-8 space-y-3">
            <p className="text-xs font-medium text-gray-400 text-center uppercase tracking-wide">
              {selectedMeasures.size} measure{selectedMeasures.size > 1 ? "s" : ""} selected
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setCopiedMeasures(new Set(selectedMeasures))}
                className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-sm font-medium text-gray-700 transition active:scale-95"
              >
                Copy
              </button>
              <button
                disabled={copiedMeasures.size === 0}
                onClick={() => { if (musicXml && copiedMeasures.size > 0) onMusicXmlChange!(pasteMeasures(musicXml, [...copiedMeasures], Math.min(...selectedMeasures)), "Paste measures"); }}
                className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 disabled:opacity-30 text-sm font-medium text-gray-700 transition active:scale-95"
              >
                Paste
              </button>
              <button
                onClick={() => { if (musicXml) onMusicXmlChange!(duplicateMeasures(musicXml, [...selectedMeasures].sort((a, b) => a - b)), "Duplicate measures"); }}
                className="py-3 rounded-xl bg-gray-100 active:bg-gray-200 text-sm font-medium text-gray-700 transition active:scale-95"
              >
                Duplicate
              </button>
              <button
                onClick={() => { if (musicXml) { onMusicXmlChange!(deleteMeasures(musicXml, [...selectedMeasures]), "Delete measures"); onClearMeasureSelection?.(); } }}
                className="py-3 rounded-xl bg-red-50 active:bg-red-100 text-red-600 text-sm font-medium transition active:scale-95"
              >
                ✕ Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ToolBtn ──────────────────────────────────────────────────────────────────

function ToolBtn({ onClick, title, danger, disabled, children }: {
  onClick: () => void;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`text-[11px] px-1.5 py-0.5 rounded transition shrink-0 ${
        danger
          ? "bg-red-50 hover:bg-red-100 text-red-600 disabled:opacity-30"
          : "bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-30"
      }`}
    >
      {children}
    </button>
  );
}

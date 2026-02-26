"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import MidiPlayer from "./MidiPlayer";

type Props = {
  musicXml: string | null;
  scoreName: string | null;
  selectedMeasures: Set<number>;
  onMeasureClick: (measureNumber: number, addToSelection: boolean) => void;
  // History controls
  canUndo?: boolean;
  canRedo?: boolean;
  historyIndex?: number;
  historyLength?: number;
  historyEntries?: { name: string; timestamp: string }[];
  onUndo?: () => void;
  onRedo?: () => void;
  onJumpTo?: (index: number) => void;
  onPlaybackStop?: () => void;
  onSingClick?: () => void;
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ScoreViewer({
  musicXml, scoreName, selectedMeasures, onMeasureClick,
  canUndo, canRedo, historyIndex = -1, historyLength = 0,
  historyEntries = [], onUndo, onRedo, onJumpTo, onPlaybackStop, onSingClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const onClickRef = useRef(onMeasureClick);
  onClickRef.current = onMeasureClick;
  const [midiSrc, setMidiSrc] = useState<string | null>(null);
  const [playingMeasure, setPlayingMeasure] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Parse time signature from MusicXML to calculate ticks per measure
  const beats = parseInt(musicXml?.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4");
  const beatType = parseInt(musicXml?.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4");
  const quarterNotesPerMeasure = beats * (4 / beatType);

  // Build channel → instrument map from all <midi-instrument> blocks in MusicXML
  const channelInstruments: Record<number, string> = {};
  if (musicXml) {
    const blockRe = /<midi-instrument[\s\S]*?<\/midi-instrument>/g;
    for (const block of musicXml.matchAll(blockRe)) {
      const channel = parseInt(block[0].match(/<midi-channel>(\d+)<\/midi-channel>/)?.[1] ?? "0");
      const program = parseInt(block[0].match(/<midi-program>(\d+)<\/midi-program>/)?.[1] ?? "1");
      if (channel > 0) channelInstruments[channel] = GM_INSTRUMENTS[program - 1] ?? "acoustic_grand_piano";
    }
  }

  // ── render with Verovio ───────────────────────────────────────────────────
  useEffect(() => {
    if (!musicXml || !containerRef.current) return;
    let cancelled = false;

    async function render() {
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
        setMidiSrc(`data:audio/midi;base64,${midiBase64}`);
      }

      // Wait one frame so the browser lays out the SVGs before getBBox()
      requestAnimationFrame(() => {
        if (cancelled || !containerRef.current) return;
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
            onClickRef.current(measureNum, (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey);
          });
        });
      });
    }

    render().catch(console.error);
    return () => { cancelled = true; };
  }, [musicXml]);

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
      onPlaybackStop?.();
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

  if (!musicXml) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900 min-h-[48px]">
          <Link
            href="/editor"
            className="text-gray-500 hover:text-gray-300 transition text-xs px-1.5 py-1 rounded hover:bg-gray-800"
            title="All files"
          >
            ← Files
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Upload a score and send an instruction to see it here.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900 min-h-[48px]">
        {/* Back to files */}
        <Link
          href="/editor"
          className="text-gray-500 hover:text-gray-300 transition text-xs px-1.5 py-1 rounded hover:bg-gray-800 shrink-0"
          title="All files"
        >
          ← Files
        </Link>
        <span className="text-gray-700 text-xs">|</span>
        {/* Undo / Redo */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="px-2 py-1 rounded text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-30 transition"
          >
            ↩
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="px-2 py-1 rounded text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-30 transition"
          >
            ↪
          </button>
        </div>

        {/* History dropdown */}
        {historyLength > 0 && (
          <div className="relative shrink-0">
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              title="Version history"
              className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
            >
              v{historyIndex + 1}/{historyLength}
            </button>
            {historyOpen && (
              <>
                {/* backdrop */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setHistoryOpen(false)}
                />
                <div className="absolute left-0 top-full mt-1 z-20 bg-gray-900 border border-gray-700 rounded-lg shadow-xl min-w-[300px] max-h-64 overflow-y-auto">
                  {historyEntries.map((entry, i) => (
                    <button
                      key={i}
                      onClick={() => { onJumpTo?.(i); setHistoryOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800 transition flex items-center gap-2 ${
                        i === historyIndex ? "text-indigo-400 font-semibold" : "text-gray-300"
                      }`}
                    >
                      <span className="text-gray-500 tabular-nums w-5 shrink-0">{i + 1}.</span>
                      <span className="truncate flex-1">{entry.name}</span>
                      <span className="text-gray-600 shrink-0 tabular-nums">
                        {timeAgo(entry.timestamp)}
                      </span>
                      {i === historyIndex && <span className="text-indigo-400">←</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Sing */}
        {onSingClick && (
          <button
            onClick={onSingClick}
            title="Sing a melody"
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition shrink-0"
          >
            ♪ Sing
          </button>
        )}

        {/* MIDI player */}
        <div className="flex-1 min-w-0">
          {midiSrc ? (
            <MidiPlayer
              src={midiSrc}
              channelInstruments={channelInstruments}
              quarterNotesPerMeasure={quarterNotesPerMeasure}
              selectedMeasures={selectedMeasures}
              onMeasureChange={setPlayingMeasure}
            />
          ) : (
            <span className="text-xs text-gray-500">Rendering…</span>
          )}
        </div>

        {/* Download MusicXML */}
        <button
          onClick={() => {
            if (!musicXml) return;
            const blob = new Blob([musicXml], { type: "application/xml" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${scoreName ?? "score"}.musicxml`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition shrink-0"
          title="Download as MusicXML"
        >
          ⬇ MusicXML
        </button>
      </div>

      {/* Score info bar */}
      <ScoreInfoBar musicXml={musicXml} />

      {/* Score */}
      <div className="flex-1 overflow-y-auto bg-white" ref={scrollContainerRef}>
        <div className="p-6" ref={containerRef} />
      </div>
    </div>
  );
}

// ─── Score info bar ─────────────────────────────────────────────────────────

const FIFTHS_KEYS = ["Cb","Gb","Db","Ab","Eb","Bb","F","C","G","D","A","E","B","F#","C#"];

function ScoreInfoBar({ musicXml }: { musicXml: string }) {
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

  const items: Array<{ label: string; dim?: boolean }> = [];
  if (instruments) items.push({ label: instruments });
  items.push({ label: key });
  items.push({ label: `${beatsStr}/${beatTypeStr}` });
  items.push({ label: `♩ = ${tempo}`, dim: !tempoExplicit });
  items.push({ label: `${measureCount} bars` });

  return (
    <div className="flex items-center gap-3 px-4 py-1 border-b border-gray-800 bg-gray-850 text-[11px] text-gray-400">
      {items.map((item, i) => (
        <span key={i} className={`flex items-center gap-3${item.dim ? " opacity-40" : ""}`}>
          {i > 0 && <span className="text-gray-700">·</span>}
          {item.label}
        </span>
      ))}
    </div>
  );
}

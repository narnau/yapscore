"use client";

import { useEffect, useRef, useState } from "react";
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
  historyNames?: string[];
  onUndo?: () => void;
  onRedo?: () => void;
  onJumpTo?: (index: number) => void;
};

export default function ScoreViewer({
  musicXml, scoreName, selectedMeasures, onMeasureClick,
  canUndo, canRedo, historyIndex = -1, historyLength = 0,
  historyNames = [], onUndo, onRedo, onJumpTo,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onClickRef = useRef(onMeasureClick);
  onClickRef.current = onMeasureClick;
  const [midiSrc, setMidiSrc] = useState<string | null>(null);
  const [playingMeasure, setPlayingMeasure] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Parse time signature from MusicXML to calculate ticks per measure
  const beats = parseInt(musicXml?.match(/<beats>(\d+)<\/beats>/)?.[1] ?? "4");
  const beatType = parseInt(musicXml?.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] ?? "4");
  const quarterNotesPerMeasure = beats * (4 / beatType);

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

  if (!musicXml) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500 text-sm">
        Upload a score and send an instruction to see it here.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900 min-h-[48px]">
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
                <div className="absolute left-0 top-full mt-1 z-20 bg-gray-900 border border-gray-700 rounded-lg shadow-xl min-w-[280px] max-h-64 overflow-y-auto">
                  {historyNames.map((name, i) => (
                    <button
                      key={i}
                      onClick={() => { onJumpTo?.(i); setHistoryOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800 transition flex items-center gap-2 ${
                        i === historyIndex ? "text-indigo-400 font-semibold" : "text-gray-300"
                      }`}
                    >
                      <span className="text-gray-500 tabular-nums w-5 shrink-0">{i + 1}.</span>
                      <span className="truncate">{name}</span>
                      {i === historyIndex && <span className="ml-auto text-indigo-400">←</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* MIDI player */}
        <div className="flex-1 min-w-0">
          {midiSrc ? (
            <MidiPlayer
              src={midiSrc}
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

      {/* Score */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="p-6" ref={containerRef} />
      </div>
    </div>
  );
}

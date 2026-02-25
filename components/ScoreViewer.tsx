"use client";

import { useEffect, useRef, useState } from "react";
import MidiPlayer from "./MidiPlayer";

type Props = {
  musicXml: string | null;
  selectedMeasures: Set<number>;
  onMeasureClick: (measureNumber: number, addToSelection: boolean) => void;
};

export default function ScoreViewer({ musicXml, selectedMeasures, onMeasureClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onClickRef = useRef(onMeasureClick);
  onClickRef.current = onMeasureClick;
  const [midiSrc, setMidiSrc] = useState<string | null>(null);
  const [playingMeasure, setPlayingMeasure] = useState<number | null>(null);

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

          // pointer-events: bounding-box → clicking anywhere in the measure area works,
          // not just on notes/staff lines
          measureEl.style.pointerEvents = "bounding-box";
          measureEl.style.cursor = "pointer";

          // Add highlight rect as FIRST CHILD so it renders behind notes.
          // Being inside the group means it shares the same coordinate system — no CTM math.
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
        rect.setAttribute("fill", "rgba(34,197,94,0.35)");       // green — playing
      } else if (selectedMeasures.has(num)) {
        rect.setAttribute("fill", "rgba(99,102,241,0.25)");       // blue — selected
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
      <div className="flex items-center px-4 py-2 border-b border-gray-800 bg-gray-900 min-h-[48px]">
        {midiSrc ? (
          <MidiPlayer
            src={midiSrc}
            quarterNotesPerMeasure={quarterNotesPerMeasure}
            onMeasureChange={setPlayingMeasure}
          />
        ) : (
          <span className="text-xs text-gray-500">Rendering…</span>
        )}
      </div>

      {/* Score */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="p-6" ref={containerRef} />
      </div>
    </div>
  );
}

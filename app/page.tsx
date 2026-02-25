"use client";

import { useState, useCallback } from "react";
import ChatPanel from "@/components/ChatPanel";
import ScoreViewer from "@/components/ScoreViewer";
import LibraryModal from "@/components/LibraryModal";

export default function Home() {
  const [musicXml, setMusicXml] = useState<string | null>(null);
  const [scoreName, setScoreName] = useState<string | null>(null);
  const [selectedMeasures, setSelectedMeasures] = useState<Set<number>>(new Set());
  const [libraryOpen, setLibraryOpen] = useState(false);

  const handleMeasureClick = useCallback((measureNumber: number, addToSelection: boolean) => {
    setSelectedMeasures((prev) => {
      const next = addToSelection ? new Set(prev) : new Set<number>();
      if (next.has(measureNumber)) {
        next.delete(measureNumber);
      } else {
        next.add(measureNumber);
      }
      return next;
    });
  }, []);

  const handleScoreReady = useCallback((xml: string, name?: string) => {
    setMusicXml(xml);
    setSelectedMeasures(new Set());
    if (name !== undefined) setScoreName(name);
  }, []);

  return (
    <main className="flex h-full">
      {/* Chat — 34% */}
      <div className="w-[34%] min-w-[280px] border-r border-gray-800 flex flex-col">
        <ChatPanel
          currentMusicXml={musicXml}
          scoreName={scoreName}
          selectedMeasures={selectedMeasures}
          onClearSelection={() => setSelectedMeasures(new Set())}
          onScoreReady={handleScoreReady}
          onOpenLibrary={() => setLibraryOpen(true)}
        />
      </div>

      {/* Score viewer — 66% */}
      <div className="flex-1 flex flex-col">
        <ScoreViewer
          musicXml={musicXml}
          selectedMeasures={selectedMeasures}
          onMeasureClick={handleMeasureClick}
        />
      </div>

      {libraryOpen && (
        <LibraryModal
          onClose={() => setLibraryOpen(false)}
          onScoreReady={(xml, name) => handleScoreReady(xml, name)}
        />
      )}
    </main>
  );
}

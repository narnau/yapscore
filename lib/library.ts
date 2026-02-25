import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const LIBRARY_DIR = path.join(process.cwd(), "score-library");
const FILES_DIR = path.join(LIBRARY_DIR, "files");
const METADATA_PATH = path.join(LIBRARY_DIR, "metadata.json");

export type ScoreEntry = {
  id: string;
  name: string;
  description: string;
  filename: string;
  uploadedAt: string;
};

function ensureDirs() {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  if (!fs.existsSync(METADATA_PATH)) {
    fs.writeFileSync(METADATA_PATH, "[]", "utf-8");
  }
}

export function listScores(): ScoreEntry[] {
  ensureDirs();
  return JSON.parse(fs.readFileSync(METADATA_PATH, "utf-8")) as ScoreEntry[];
}

function saveMetadata(scores: ScoreEntry[]) {
  fs.writeFileSync(METADATA_PATH, JSON.stringify(scores, null, 2), "utf-8");
}

export function addScore(name: string, description: string, msczBuffer: Buffer): ScoreEntry {
  ensureDirs();
  const id = randomUUID();
  const filename = `${id}.mscz`;
  fs.writeFileSync(path.join(FILES_DIR, filename), msczBuffer);

  const entry: ScoreEntry = {
    id,
    name,
    description,
    filename,
    uploadedAt: new Date().toISOString(),
  };

  const scores = listScores();
  scores.push(entry);
  saveMetadata(scores);
  return entry;
}

export function deleteScore(id: string): boolean {
  ensureDirs();
  const scores = listScores();
  const idx = scores.findIndex((s) => s.id === id);
  if (idx === -1) return false;

  const entry = scores[idx];
  const filePath = path.join(FILES_DIR, entry.filename);
  if (fs.existsSync(filePath)) fs.rmSync(filePath);

  scores.splice(idx, 1);
  saveMetadata(scores);
  return true;
}

export function getScorePath(id: string): string | null {
  ensureDirs();
  const scores = listScores();
  const entry = scores.find((s) => s.id === id);
  if (!entry) return null;
  const filePath = path.join(FILES_DIR, entry.filename);
  return fs.existsSync(filePath) ? filePath : null;
}

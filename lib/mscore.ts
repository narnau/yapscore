import { spawnSync } from "child_process";
import fs from "fs";

function mscoreCmd(): string {
  return process.env.MSCORE_PATH ?? "mscore";
}

function filterMscoreErrors(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !line.startsWith("qt.qml.typeregistration:"))
    .join("\n")
    .trim();
}

/**
 * Converts a .mscz to MusicXML using mscore.
 * Returns { ok: true, content } on success, { ok: false, error } on failure.
 * This doubles as validation: if mscore can export it, the file is valid.
 */
export function toMusicXml(
  msczPath: string,
  outputPath: string
): { ok: true; content: string } | { ok: false; error: string } {
  const result = spawnSync(mscoreCmd(), ["-o", outputPath, msczPath], { encoding: "utf-8" });

  if (result.error) return { ok: false, error: result.error.message };
  if (!fs.existsSync(outputPath)) {
    return { ok: false, error: filterMscoreErrors(result.stderr ?? "") };
  }
  return { ok: true, content: fs.readFileSync(outputPath, "utf-8") };
}

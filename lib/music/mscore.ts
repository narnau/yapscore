/**
 * Converts .mscz data to MusicXML using webmscore (MuseScore compiled to WASM).
 *
 * webmscore's Node.js CJS build uses fetch() to load its WASM binary, passing an
 * absolute filesystem path. Node.js 18+ fetch doesn't support absolute paths or
 * file:// URLs, so we patch global.fetch to handle them via fs.readFileSync.
 */

import fs from "fs";

let _webmscore: { load: Function; ready: Promise<void> } | null = null;
let _fetchPatched = false;

function patchFetch() {
  if (_fetchPatched || typeof globalThis.fetch !== "function") return;
  _fetchPatched = true;

  const orig = globalThis.fetch.bind(globalThis);
  (globalThis as Record<string, unknown>).fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit
  ) {
    // Resolve the path string
    let filePath: string | null = null;
    if (typeof input === "string" && /^\/[^/]/.test(input)) {
      filePath = input;
    } else if (input instanceof URL && input.protocol === "file:") {
      filePath = input.pathname;
    }

    if (filePath) {
      try {
        const data = fs.readFileSync(filePath);
        return Promise.resolve(new Response(data.buffer as ArrayBuffer));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return orig(input as RequestInfo, init);
  };
}

function resetWebMscore() {
  _webmscore = null;
  // Also evict from Node's require cache so the next getWebMscore() call
  // executes the module code fresh — otherwise require() returns the same
  // object with the same (potentially corrupted) WASM heap.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    delete (require as NodeJS.Require & { cache: Record<string, unknown> }).cache[
      require.resolve("webmscore")
    ];
  } catch { /* ignore — path resolution may fail outside Node */ }
}

async function getWebMscore(): Promise<{ load: Function; ready: Promise<void> }> {
  if (_webmscore) return _webmscore;
  patchFetch();
  // Use require() so the module loads AFTER the fetch patch is in place
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let mod = require("webmscore");
  if (mod?.default) mod = mod.default;
  await (mod.ready as Promise<void>);
  _webmscore = mod; // only cache after successful init
  return mod;
}

/**
 * Converts a .mscz buffer to MusicXML.
 * Returns { ok: true, content } on success, { ok: false, error } on failure.
 */
export async function toMusicXml(
  input: Buffer | Uint8Array
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const data = input instanceof Buffer ? new Uint8Array(input) : input;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const WebMscore = await getWebMscore();
      const score = await WebMscore.load("mscz", data);
      const xml = (await score.saveXml()) as string;
      score.destroy();
      return { ok: true, content: xml };
    } catch (err) {
      // Reset cached module + evict require cache so the next attempt (or the
      // next caller) gets a completely fresh WASM instance with a clean heap.
      resetWebMscore();
      if (attempt === 2) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // else: loop → retry once with a fresh WASM instance
    }
  }
  return { ok: false, error: "unreachable" }; // TypeScript needs this
}

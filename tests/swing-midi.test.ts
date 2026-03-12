import { describe, test, expect } from "bun:test";
import { applySwingToMidi } from "@/lib/music/swing-midi";

/**
 * Build a minimal valid MIDI file (format 0, single track) with the given
 * division (ticks per quarter note) and a sequence of note events.
 *
 * Each event: { deltaTicks, statusByte, data1, data2 }
 */
function buildMidi(division: number, events: Array<{ delta: number; bytes: number[] }>): string {
  // Build track data
  const trackData: number[] = [];
  for (const ev of events) {
    trackData.push(...writeVarLen(ev.delta));
    trackData.push(...ev.bytes);
  }
  // End of track
  trackData.push(0x00, 0xff, 0x2f, 0x00);

  // Header chunk: MThd
  const header = [
    0x4d,
    0x54,
    0x68,
    0x64, // MThd
    0x00,
    0x00,
    0x00,
    0x06, // header length = 6
    0x00,
    0x00, // format 0
    0x00,
    0x01, // 1 track
    (division >> 8) & 0xff,
    division & 0xff, // division
  ];

  // Track chunk: MTrk
  const trackChunk = [
    0x4d,
    0x54,
    0x72,
    0x6b, // MTrk
    (trackData.length >> 24) & 0xff,
    (trackData.length >> 16) & 0xff,
    (trackData.length >> 8) & 0xff,
    trackData.length & 0xff,
    ...trackData,
  ];

  const allBytes = [...header, ...trackChunk];
  let binary = "";
  for (const b of allBytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function writeVarLen(value: number): number[] {
  if (value === 0) return [0];
  const bytes: number[] = [];
  bytes.push(value & 0x7f);
  value >>>= 7;
  while (value > 0) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  return bytes.reverse();
}

/** Parse the output base64 MIDI back into bytes */
function decodeMidi(base64: string): Uint8Array {
  const binary = atob(base64);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
  return data;
}

/** Extract absolute ticks of Note On events from a single-track MIDI */
function extractNoteOnTicks(data: Uint8Array): number[] {
  // Skip header (14 bytes) + track header (8 bytes)
  let pos = 22;
  let absoluteTick = 0;
  const ticks: number[] = [];

  while (pos < data.length) {
    // Read variable-length delta
    let delta = 0;
    let byte: number;
    do {
      byte = data[pos++];
      delta = (delta << 7) | (byte & 0x7f);
    } while (byte & 0x80);
    absoluteTick += delta;

    const status = data[pos];
    if (status === 0xff) {
      // Meta event
      const type = data[pos + 1];
      let len = 0;
      let lenPos = pos + 2;
      let b: number;
      do {
        b = data[lenPos++];
        len = (len << 7) | (b & 0x7f);
      } while (b & 0x80);
      pos = lenPos + len;
    } else if ((status & 0xf0) === 0x90) {
      // Note On
      ticks.push(absoluteTick);
      pos += 3;
    } else if ((status & 0xf0) === 0x80) {
      // Note Off
      pos += 3;
    } else {
      // Other - skip 3 bytes as fallback
      pos += 3;
    }
  }
  return ticks;
}

describe("applySwingToMidi", () => {
  test("returns input unchanged for non-MIDI data", () => {
    const notMidi = btoa("not a midi file");
    expect(applySwingToMidi(notMidi)).toBe(notMidi);
  });

  test("ratio 0.5 (straight) leaves note positions unchanged", () => {
    const division = 480;
    const input = buildMidi(division, [
      { delta: 0, bytes: [0x90, 60, 100] }, // Note On at tick 0
      { delta: 240, bytes: [0x80, 60, 0] }, // Note Off at tick 240
      { delta: 0, bytes: [0x90, 62, 100] }, // Note On at tick 240 (off-beat)
      { delta: 240, bytes: [0x80, 62, 0] }, // Note Off at tick 480
    ]);

    const result = applySwingToMidi(input, 0.5);
    const originalData = decodeMidi(input);
    const resultData = decodeMidi(result);

    const originalTicks = extractNoteOnTicks(originalData);
    const resultTicks = extractNoteOnTicks(resultData);

    expect(resultTicks).toEqual(originalTicks);
  });

  test("standard triplet swing (2/3) shifts off-beat eighth notes", () => {
    const division = 480;
    const halfBeat = 240; // off-beat eighth position
    const input = buildMidi(division, [
      { delta: 0, bytes: [0x90, 60, 100] }, // Note On at tick 0 (on-beat)
      { delta: halfBeat, bytes: [0x80, 60, 0] }, // Note Off at 240
      { delta: 0, bytes: [0x90, 62, 100] }, // Note On at 240 (off-beat)
      { delta: halfBeat, bytes: [0x80, 62, 0] }, // Note Off at 480
    ]);

    const result = applySwingToMidi(input, 2 / 3);
    const resultData = decodeMidi(result);
    const ticks = extractNoteOnTicks(resultData);

    // On-beat note stays at 0
    expect(ticks[0]).toBe(0);
    // Off-beat note should be shifted: 240 + round((2/3 - 0.5) * 480) = 240 + 80 = 320
    expect(ticks[1]).toBe(320);
  });

  test("on-beat notes are not shifted", () => {
    const division = 480;
    const input = buildMidi(division, [
      { delta: 0, bytes: [0x90, 60, 100] }, // Note On at tick 0
      { delta: 480, bytes: [0x80, 60, 0] }, // Note Off at 480
      { delta: 0, bytes: [0x90, 62, 100] }, // Note On at 480 (on beat 1)
      { delta: 480, bytes: [0x80, 62, 0] }, // Note Off at 960
    ]);

    const result = applySwingToMidi(input, 2 / 3);
    const resultData = decodeMidi(result);
    const ticks = extractNoteOnTicks(resultData);

    expect(ticks[0]).toBe(0);
    expect(ticks[1]).toBe(480);
  });

  test("preserves valid MIDI structure after swing", () => {
    const division = 480;
    const input = buildMidi(division, [
      { delta: 0, bytes: [0x90, 60, 100] },
      { delta: 240, bytes: [0x80, 60, 0] },
      { delta: 0, bytes: [0x90, 62, 100] },
      { delta: 240, bytes: [0x80, 62, 0] },
    ]);

    const result = applySwingToMidi(input, 2 / 3);
    const data = decodeMidi(result);

    // Check MIDI header
    expect(data[0]).toBe(0x4d); // M
    expect(data[1]).toBe(0x54); // T
    expect(data[2]).toBe(0x68); // h
    expect(data[3]).toBe(0x64); // d

    // Check track header
    expect(data[14]).toBe(0x4d); // M
    expect(data[15]).toBe(0x54); // T
    expect(data[16]).toBe(0x72); // r
    expect(data[17]).toBe(0x6b); // k
  });

  test("default ratio is 2/3", () => {
    const division = 480;
    const input = buildMidi(division, [
      { delta: 0, bytes: [0x90, 60, 100] },
      { delta: 240, bytes: [0x80, 60, 0] },
      { delta: 0, bytes: [0x90, 62, 100] },
      { delta: 240, bytes: [0x80, 62, 0] },
    ]);

    const withDefault = applySwingToMidi(input);
    const withExplicit = applySwingToMidi(input, 2 / 3);

    expect(withDefault).toBe(withExplicit);
  });
});

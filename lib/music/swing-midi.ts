/**
 * MIDI binary post-processor for swing playback.
 *
 * Parses the MIDI produced by Verovio and shifts Note On/Off events that land
 * on off-beat eighth-note positions, producing the characteristic "long-short"
 * swing feel without altering the MusicXML notation.
 *
 * Standard triplet swing: ratio = 2/3
 *   - On-beat eighth  → stays at tick 0 in the beat
 *   - Off-beat eighth → moves from tick (division/2) to tick (division * 2/3)
 *
 * The swing offset = (ratio - 0.5) * division  [in ticks]
 */

// ─── Variable-length helpers ─────────────────────────────────────────────────

function readVarLen(data: Uint8Array, pos: number): [number, number] {
  let value = 0;
  let read = 0;
  let byte: number;
  do {
    byte = data[pos + read];
    value = (value << 7) | (byte & 0x7f);
    read++;
  } while (byte & 0x80);
  return [value, read];
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

function readUint32BE(data: Uint8Array, pos: number): number {
  return ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>> 0;
}

function writeUint32BE(val: number): number[] {
  return [(val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff];
}

// ─── Event model ─────────────────────────────────────────────────────────────

type MidiEvent = {
  absoluteTick: number;
  order: number;
  bytes: number[]; // raw MIDI bytes (without delta time)
  isNoteOnOff: boolean;
};

// ─── Track parser ────────────────────────────────────────────────────────────

function parseTrack(data: Uint8Array, start: number, end: number): MidiEvent[] {
  const events: MidiEvent[] = [];
  let pos = start;
  let absoluteTick = 0;
  let order = 0;
  let runningStatus = 0;

  while (pos < end) {
    if (pos >= data.length) break;
    const [delta, deltaLen] = readVarLen(data, pos);
    pos += deltaLen;
    absoluteTick += delta;

    if (pos >= end) break;

    let statusByte = data[pos];
    let eventBytes: number[];

    if (statusByte === 0xff) {
      // Meta event: 0xFF type varlen data
      const type = data[pos + 1];
      const [len, lenBytes] = readVarLen(data, pos + 2);
      eventBytes = Array.from(data.slice(pos, pos + 2 + lenBytes + len));
      pos += 2 + lenBytes + len;
      runningStatus = 0;
    } else if (statusByte === 0xf0 || statusByte === 0xf7) {
      // SysEx
      const [len, lenBytes] = readVarLen(data, pos + 1);
      eventBytes = Array.from(data.slice(pos, pos + 1 + lenBytes + len));
      pos += 1 + lenBytes + len;
      runningStatus = 0;
    } else {
      // Regular MIDI event (with possible running status)
      if (statusByte & 0x80) {
        runningStatus = statusByte;
        pos++;
      } else {
        statusByte = runningStatus;
      }

      const type = (statusByte >> 4) & 0x0f;
      const dataLen = type === 0xc || type === 0xd ? 1 : 2;
      const dataBytes = Array.from(data.slice(pos, pos + dataLen));
      pos += dataLen;
      eventBytes = [statusByte, ...dataBytes];
    }

    const statusNibble = (eventBytes[0] >> 4) & 0x0f;
    const isNoteOnOff = statusNibble === 0x8 || statusNibble === 0x9;

    events.push({ absoluteTick, order: order++, bytes: eventBytes, isNoteOnOff });
  }

  return events;
}

// ─── Track serializer ────────────────────────────────────────────────────────

function serializeTrack(events: MidiEvent[]): number[] {
  const bytes: number[] = [];
  let prevTick = 0;
  for (const ev of events) {
    const delta = Math.max(0, ev.absoluteTick - prevTick);
    prevTick = ev.absoluteTick;
    bytes.push(...writeVarLen(delta));
    bytes.push(...ev.bytes);
  }
  return bytes;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply swing timing to a base64-encoded MIDI file.
 *
 * @param base64   - The raw base64 string (without the data: prefix).
 * @param ratio    - Swing ratio: fraction of a beat for the first eighth note.
 *                   2/3 ≈ 0.667 = standard triplet swing.
 *                   0.5 = straight (no-op).
 */
export function applySwingToMidi(base64: string, ratio = 2 / 3): string {
  const binary = atob(base64);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);

  // Validate MIDI header "MThd"
  if (data[0] !== 0x4d || data[1] !== 0x54 || data[2] !== 0x68 || data[3] !== 0x64) {
    return base64;
  }

  const headerLen = readUint32BE(data, 4);
  const ntracks = readUint16BE(data, 10);
  const division = readUint16BE(data, 12);

  // Only handle ticks-per-beat (positive division); skip SMPTE
  if (division & 0x8000) return base64;

  const halfBeat = division / 2; // ticks per straight eighth
  const swingOffset = Math.round((ratio - 0.5) * division); // extra ticks for off-beat
  const tolerance = Math.round(division * 0.15); // ±15% of a beat

  const output: number[] = Array.from(data.slice(0, 8 + headerLen));

  let pos = 8 + headerLen;
  for (let t = 0; t < ntracks; t++) {
    if (pos + 8 > data.length) break;

    // Validate "MTrk"
    if (data[pos] !== 0x4d || data[pos + 1] !== 0x54 || data[pos + 2] !== 0x72 || data[pos + 3] !== 0x6b) {
      const len = readUint32BE(data, pos + 4);
      output.push(...Array.from(data.slice(pos, pos + 8 + len)));
      pos += 8 + len;
      continue;
    }

    const trackLen = readUint32BE(data, pos + 4);
    const trackStart = pos + 8;
    const trackEnd = trackStart + trackLen;

    const events = parseTrack(data, trackStart, trackEnd);

    // Shift off-beat eighth notes
    for (const ev of events) {
      if (!ev.isNoteOnOff) continue;
      const beatPos = ev.absoluteTick % division;
      if (Math.abs(beatPos - halfBeat) <= tolerance) {
        ev.absoluteTick += swingOffset;
      }
    }

    // Stable sort by absolute tick
    events.sort((a, b) => (a.absoluteTick !== b.absoluteTick ? a.absoluteTick - b.absoluteTick : a.order - b.order));

    // End-of-Track (FF 2F 00) must always be the last event.
    // Swing can push note-off events past it, so re-pin it to the end.
    const eotIdx = events.findIndex((ev) => ev.bytes[0] === 0xff && ev.bytes[1] === 0x2f);
    if (eotIdx !== -1 && eotIdx !== events.length - 1) {
      const [eot] = events.splice(eotIdx, 1);
      eot.absoluteTick = Math.max(eot.absoluteTick, events[events.length - 1]?.absoluteTick ?? 0);
      events.push(eot);
    }

    const trackBytes = serializeTrack(events);
    output.push(0x4d, 0x54, 0x72, 0x6b); // "MTrk"
    output.push(...writeUint32BE(trackBytes.length));
    output.push(...trackBytes);

    pos = trackEnd;
  }

  // Encode back to base64
  let result = "";
  for (const byte of output) result += String.fromCharCode(byte);
  return btoa(result);
}

function readUint16BE(data: Uint8Array, pos: number): number {
  return (data[pos] << 8) | data[pos + 1];
}

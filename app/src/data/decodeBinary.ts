import type { AgentWaypoints, PoopEvents } from "../types";

const AGENT_RECORD_BYTES = 13;
const POOP_RECORD_BYTES = 14;

/**
 * Reject a buffer that isn't a whole number of records.
 *
 * Without this, a stale bundle decodes silently rather than failing: the
 * fractional count is truncated when it sizes the typed arrays, every DataView
 * read still lands inside the larger buffer, and you get byte-misaligned garbage
 * positions and flags with no error. A CDN serving a cached bundle across a
 * format change is the realistic way to hit it.
 */
function recordCount(buffer: ArrayBuffer, recordBytes: number, label: string): number {
  if (buffer.byteLength % recordBytes !== 0) {
    throw new Error(
      `${label} is ${buffer.byteLength} bytes, not a multiple of the ` +
        `${recordBytes}-byte record — bundle and app are out of sync`,
    );
  }
  return buffer.byteLength / recordBytes;
}

export function decodeAgentWaypoints(buffer: ArrayBuffer): AgentWaypoints {
  const count = recordCount(buffer, AGENT_RECORD_BYTES, "agents.bin");
  const dv = new DataView(buffer);
  const tick = new Uint32Array(count);
  const lon = new Float32Array(count);
  const lat = new Float32Array(count);
  const vtype = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * AGENT_RECORD_BYTES;
    tick[i] = dv.getUint32(o, true);
    lon[i] = dv.getFloat32(o + 4, true);
    lat[i] = dv.getFloat32(o + 8, true);
    vtype[i] = dv.getUint8(o + 12);
  }
  return { tick, lon, lat, vtype, count };
}

export function decodePoopEvents(buffer: ArrayBuffer): PoopEvents {
  const count = recordCount(buffer, POOP_RECORD_BYTES, "poops.bin");
  const dv = new DataView(buffer);
  const tick = new Uint32Array(count);
  const lon = new Float32Array(count);
  const lat = new Float32Array(count);
  const vtype = new Uint8Array(count);
  const infected = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * POOP_RECORD_BYTES;
    tick[i] = dv.getUint32(o, true);
    lon[i] = dv.getFloat32(o + 4, true);
    lat[i] = dv.getFloat32(o + 8, true);
    vtype[i] = dv.getUint8(o + 12);
    infected[i] = dv.getUint8(o + 13);
  }
  return { tick, lon, lat, vtype, infected, count };
}

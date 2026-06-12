import type { AgentWaypoints, PoopEvents } from "../types";

const AGENT_RECORD_BYTES = 13;
const POOP_RECORD_BYTES = 18;

export function decodeAgentWaypoints(buffer: ArrayBuffer): AgentWaypoints {
  const count = buffer.byteLength / AGENT_RECORD_BYTES;
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
  const count = buffer.byteLength / POOP_RECORD_BYTES;
  const dv = new DataView(buffer);
  const tick = new Uint32Array(count);
  const lon = new Float32Array(count);
  const lat = new Float32Array(count);
  const vtype = new Uint8Array(count);
  const infected = new Uint8Array(count);
  const pathogen = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * POOP_RECORD_BYTES;
    tick[i] = dv.getUint32(o, true);
    lon[i] = dv.getFloat32(o + 4, true);
    lat[i] = dv.getFloat32(o + 8, true);
    vtype[i] = dv.getUint8(o + 12);
    infected[i] = dv.getUint8(o + 13);
    pathogen[i] = dv.getFloat32(o + 14, true);
  }
  return { tick, lon, lat, vtype, infected, pathogen, count };
}

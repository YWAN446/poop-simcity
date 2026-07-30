/**
 * Deterministic per-agent displacement around a venue centroid.
 *
 * 10,000 agents share 12,134 venues, so without this a crowded apartment block
 * and an empty one render identically — every occupant lands on the same pixel.
 * The offset must be a pure function of agentId: anything time-varying makes
 * parked agents vibrate in place.
 */

export const JITTER_RADIUS_M = 30;

const M_PER_DEG_LAT = 111_320;

/** 32-bit integer hash (xorshift-multiply); spreads sequential ids apart. */
function hash(n: number): number {
  let x = n | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  x = Math.imul(x, 0x9e3779b1);
  return x >>> 0;
}

/** [dLon, dLat] in degrees, uniformly distributed on a JITTER_RADIUS_M disc. */
export function jitterDegrees(agentId: number, lat: number): [number, number] {
  const h = hash(agentId);
  const angle = ((h & 0xffff) / 0x10000) * Math.PI * 2;
  // sqrt keeps the distribution uniform by area instead of bunching at the centre.
  const radius = JITTER_RADIUS_M * Math.sqrt(((h >>> 16) & 0xffff) / 0xffff);
  const north = radius * Math.sin(angle);
  const east = radius * Math.cos(angle);
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  return [east / (M_PER_DEG_LAT * cosLat), north / M_PER_DEG_LAT];
}

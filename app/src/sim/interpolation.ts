/**
 * Interpolated [lon, lat] at `queryTick` for the waypoint slice [start, start+count)
 * of the shared SoA arrays. Holds at the endpoints; lerps between neighbors.
 * Returns null for an empty slice.
 */
export function positionAtTick(
  tick: Uint32Array,
  lon: Float32Array,
  lat: Float32Array,
  start: number,
  count: number,
  queryTick: number,
): [number, number] | null {
  if (count <= 0) return null;
  const end = start + count;
  if (queryTick <= tick[start]) return [lon[start], lat[start]];
  if (queryTick >= tick[end - 1]) return [lon[end - 1], lat[end - 1]];

  // Binary search for the last waypoint with tick <= queryTick.
  let lo = start;
  let hi = end - 1;
  let i = start;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tick[mid] <= queryTick) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const t0 = tick[i];
  const t1 = tick[i + 1];
  const span = t1 - t0;
  const alpha = span === 0 ? 0 : (queryTick - t0) / span;
  return [
    lon[i] + (lon[i + 1] - lon[i]) * alpha,
    lat[i] + (lat[i + 1] - lat[i]) * alpha,
  ];
}

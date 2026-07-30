import type { Stays, StaySlice, Venues } from "../types2";

export const enum Presence {
  Absent = 0,
  Dwelling = 1,
  Travelling = 2,
}

export interface AgentPose {
  lon: number;
  lat: number;
  presence: Presence;
  /** Venue index while dwelling, -1 while travelling or absent. */
  venue: number;
}

/**
 * Resolve an agent's pose at `queryTick`, writing into `out` to avoid allocating
 * 10,000 objects per frame.
 *
 * A stay owns ticks [tick, tick + dwell). After it ends the agent travels toward
 * the next stay's venue, arriving exactly on that stay's check-in tick. The source
 * data guarantees at least one tick of travel between stays, so the span is never
 * zero.
 */
export function resolvePose(
  stays: Stays,
  venues: Venues,
  slice: StaySlice,
  queryTick: number,
  out: AgentPose,
): Presence {
  const { offset, count } = slice;
  if (count <= 0 || queryTick < stays.tick[offset]) {
    out.presence = Presence.Absent;
    out.venue = -1;
    return Presence.Absent;
  }

  // Last stay whose check-in is at or before queryTick.
  let lo = offset;
  let hi = offset + count - 1;
  let i = offset;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (stays.tick[mid] <= queryTick) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const venue = stays.venue[i];
  const departTick = stays.tick[i] + stays.dwell[i];
  const isLast = i === offset + count - 1;

  if (queryTick < departTick || isLast) {
    out.lon = venues.lon[venue];
    out.lat = venues.lat[venue];
    out.venue = venue;
    out.presence = Presence.Dwelling;
    return Presence.Dwelling;
  }

  const nextVenue = stays.venue[i + 1];
  const arriveTick = stays.tick[i + 1];
  const span = arriveTick - departTick;
  const alpha = span <= 0 ? 1 : (queryTick - departTick) / span;
  out.lon = venues.lon[venue] + (venues.lon[nextVenue] - venues.lon[venue]) * alpha;
  out.lat = venues.lat[venue] + (venues.lat[nextVenue] - venues.lat[venue]) * alpha;
  out.venue = -1;
  out.presence = Presence.Travelling;
  return Presence.Travelling;
}

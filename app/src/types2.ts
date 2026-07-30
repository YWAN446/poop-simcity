import type { Aggregates, WastewaterRegion } from "./types";

export interface ManifestV2 {
  schemaVersion: 2;
  runId: string;
  tickIntervalSec: number;
  windowStart: string;
  windowEnd: string;
  numTicks: number;
  numAgents: number;
  numVenues: number;
  bbox: [number, number, number, number];
  outbreakWindow: { startTick: number; endTick: number };
  venueTypes: string[];
  coverage: {
    transmissionsInWindow: number;
    recoveryTimeResolution: string;
    cleanPoopKeepFraction: number;
  };
  artifacts: Record<string, string>;
}

export interface Venues {
  lon: Float32Array;
  lat: Float32Array;
  type: Uint8Array;
  id: Int32Array;
  count: number;
}

/** Agent stays, sorted by (agent, tick). `dwell` is in ticks and is always >= 1. */
export interface Stays {
  tick: Uint16Array;
  dwell: Uint16Array;
  venue: Uint16Array;
  count: number;
}

export interface StaySlice {
  offset: number;
  count: number;
}

/** A row of stays_index.json. */
export interface StayIndexEntry extends StaySlice {
  agentId: number;
}

export interface PoopsV2 {
  tick: Uint16Array;
  lonQ: Uint16Array;
  latQ: Uint16Array;
  /**
   * Authoritative infected flag, computed at source float64 precision. There is no
   * per-event pathogen magnitude field: the simulation's decay model reaches
   * 4.89e-161, so a float32 magnitude column would read 0 for about 20% of
   * pathogen-bearing events, and nothing in the app renders a magnitude anyway -
   * see `poop_stream.py`'s module docstring for the full rationale.
   */
  infected: Uint8Array;
  count: number;
}

export interface Transmissions {
  tick: Uint16Array;
  source: Uint16Array;
  target: Uint16Array;
  count: number;
}

export interface WastewaterV2 {
  kind: string;
  cadenceSec: number;
  numBins: number;
  regions: WastewaterRegion[];
  values: Float32Array; // row-major [region][bin]
}

export interface BundleV2 {
  base: string;
  manifest: ManifestV2;
  venues: Venues;
  stays: Stays;
  stayIndex: Map<number, StaySlice>;
  agentIds: Int32Array;
  poops: PoopsV2;
  transitionsByAgent: Map<number, [number, number][]>;
  transmissions: Transmissions;
  aggregates: Aggregates;
  wastewater: WastewaterV2;
  poopLon(i: number): number;
  poopLat(i: number): number;
}

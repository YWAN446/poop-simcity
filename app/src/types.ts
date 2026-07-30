export interface Manifest {
  schemaVersion: number;
  runId: string;
  tickIntervalSec: number;
  startTime: string;
  endTime: string;
  numTicks: number;
  numAgents: number;
  bbox: [number, number, number, number];
  outbreakWindow: { startTick: number; endTick: number };
  venueTypes: string[];
  artifacts: Record<string, string>;
}

export interface AgentIndexEntry {
  agentId: number;
  offset: number;
  count: number;
}

export interface AgentWaypoints {
  tick: Uint32Array;
  lon: Float32Array;
  lat: Float32Array;
  vtype: Uint8Array;
  count: number;
}

export interface PoopEvents {
  tick: Uint32Array;
  lon: Float32Array;
  lat: Float32Array;
  vtype: Uint8Array;
  infected: Uint8Array;
  pathogen: Float32Array;
  count: number;
}

export interface DiseaseAgent {
  agentId: number;
  transitions: [number, number][];
  pathogenSamples: [number, number][];
}

export interface Disease {
  stateCodes: Record<string, number>;
  agents: DiseaseAgent[];
  transmissions: [number, number, number][];
}

export interface Aggregates {
  cadenceSec: number;
  startTime: string;
  gridTicks: number[];
  seir: { S: number[]; E: number[]; I: number[]; R: number[] };
  pathogenInflow: number[];
  /**
   * When each bin's SEIR counts are sampled, relative to `gridTicks[i]`. v1 bundles omit
   * this field and sample at each bin's OPENING tick (`gridTicks[i]` itself). v2 bundles
   * set this to `"binEnd"`: `gridTicks[i]` is still bin `i`'s opening tick, but
   * `seir[state][i]` is the population state at that bin's CLOSING tick, so SEIR
   * describes the same closed interval `pathogenInflow` sums over. Optional and
   * undefined-safe so v1 runtime behaviour (bin-open sampling) is unaffected.
   */
  seirSampledAt?: "binEnd";
}

export interface WastewaterRegion {
  id: string;
  centroid: [number, number];
  polygon: [number, number][];
}

export interface Wastewater {
  kind: string;
  cadenceSec: number;
  regions: WastewaterRegion[];
  series: Record<string, number[]>;
}

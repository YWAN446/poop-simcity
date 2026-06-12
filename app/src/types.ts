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

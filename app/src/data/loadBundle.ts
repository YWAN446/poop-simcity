import type {
  Aggregates, AgentIndexEntry, AgentWaypoints, Disease, Manifest,
  PoopEvents, Wastewater,
} from "../types";
import { decodeAgentWaypoints, decodePoopEvents } from "./decodeBinary";

export interface Bundle {
  base: string;
  manifest: Manifest;
  agents: AgentWaypoints;
  agentSlice: Map<number, { offset: number; count: number }>;
  poops: PoopEvents;
  disease: Disease;
  transitionsByAgent: Map<number, [number, number][]>;
  aggregates: Aggregates;
  wastewater: Wastewater;
}

export async function loadBundle(
  base: string,
  fetchFn: typeof fetch = fetch,
): Promise<Bundle> {
  const manifest = (await getJson(fetchFn, `${base}/manifest.json`)) as Manifest;
  const a = manifest.artifacts;

  const [index, agentsBuf, disease, poopsBuf, aggregates, wastewater] =
    await Promise.all([
      getJson(fetchFn, `${base}/${a.agentsIndex}`) as Promise<AgentIndexEntry[]>,
      getBuffer(fetchFn, `${base}/${a.agents}`),
      getJson(fetchFn, `${base}/${a.disease}`) as Promise<Disease>,
      getBuffer(fetchFn, `${base}/${a.poops}`),
      getJson(fetchFn, `${base}/${a.aggregates}`) as Promise<Aggregates>,
      getJson(fetchFn, `${base}/${a.wastewater}`) as Promise<Wastewater>,
    ]);

  const agentSlice = new Map<number, { offset: number; count: number }>();
  for (const e of index) agentSlice.set(e.agentId, { offset: e.offset, count: e.count });

  const transitionsByAgent = new Map<number, [number, number][]>();
  for (const ag of disease.agents) transitionsByAgent.set(ag.agentId, ag.transitions);

  return {
    base,
    manifest,
    agents: decodeAgentWaypoints(agentsBuf),
    agentSlice,
    poops: decodePoopEvents(poopsBuf),
    disease,
    transitionsByAgent,
    aggregates,
    wastewater,
  };
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

async function getBuffer(fetchFn: typeof fetch, url: string): Promise<ArrayBuffer> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.arrayBuffer();
}

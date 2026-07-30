import type { Aggregates } from "../types";
import type {
  BundleV2, ManifestV2, PoopsV2, Stays, StayIndexEntry, StaySlice,
  Transmissions, Venues, WastewaterV2,
} from "../types2";

const U16_MAX = 65535;
const TRANSITION_BYTES = 3;

interface DiseaseIndexEntry {
  agentId: number;
  transOffset: number;
  transCount: number;
  sampleOffset: number;
  sampleCount: number;
}

export async function loadBundleV2(
  base: string,
  fetchFn: typeof fetch = fetch,
): Promise<BundleV2> {
  const manifest = (await getJson(fetchFn, `${base}/manifest.json`)) as ManifestV2;
  if (manifest.schemaVersion !== 2) {
    throw new Error(
      `Unsupported bundle schemaVersion ${manifest.schemaVersion} (expected 2)`,
    );
  }
  const a = manifest.artifacts;
  const buf = (key: string) => getBuffer(fetchFn, `${base}/${a[key]}`);
  const json = (key: string) => getJson(fetchFn, `${base}/${a[key]}`);

  const [
    venuesLon, venuesLat, venuesType, venuesId,
    staysTick, staysDwell, staysVenue, staysIndex,
    poopsTick, poopsLon, poopsLat, poopsPathogen, poopsInfected,
    diseaseBuf, diseaseIndex, transmissionsBuf,
    aggregates, wastewaterBuf, wastewaterRegions,
  ] = await Promise.all([
    buf("venuesLon"), buf("venuesLat"), buf("venuesType"), buf("venuesId"),
    buf("staysTick"), buf("staysDwell"), buf("staysVenue"), json("staysIndex"),
    buf("poopsTick"), buf("poopsLon"), buf("poopsLat"), buf("poopsPathogen"),
    buf("poopsInfected"),
    buf("disease"), json("diseaseIndex"), buf("transmissions"),
    json("aggregates"), buf("wastewater"), json("wastewaterRegions"),
  ]);

  const venues: Venues = {
    lon: new Float32Array(venuesLon),
    lat: new Float32Array(venuesLat),
    type: new Uint8Array(venuesType),
    id: new Int32Array(venuesId),
    count: venuesType.byteLength,
  };

  const stays: Stays = {
    tick: new Uint16Array(staysTick),
    dwell: new Uint16Array(staysDwell),
    venue: new Uint16Array(staysVenue),
    count: staysTick.byteLength / 2,
  };

  const indexEntries = staysIndex as StayIndexEntry[];
  const stayIndex = new Map<number, StaySlice>();
  const agentIds = new Int32Array(indexEntries.length);
  indexEntries.forEach((e, i) => {
    agentIds[i] = e.agentId;
    stayIndex.set(e.agentId, { offset: e.offset, count: e.count });
  });

  const poops: PoopsV2 = {
    tick: new Uint16Array(poopsTick),
    lonQ: new Uint16Array(poopsLon),
    latQ: new Uint16Array(poopsLat),
    pathogen: new Float32Array(poopsPathogen),
    infected: new Uint8Array(poopsInfected),
    count: poopsTick.byteLength / 2,
  };

  const transmissionsRaw = new Uint16Array(transmissionsBuf);
  const txCount = transmissionsRaw.length / 3;
  const transmissions: Transmissions = {
    tick: new Uint16Array(txCount),
    source: new Uint16Array(txCount),
    target: new Uint16Array(txCount),
    count: txCount,
  };
  for (let i = 0; i < txCount; i++) {
    transmissions.tick[i] = transmissionsRaw[i * 3];
    transmissions.source[i] = transmissionsRaw[i * 3 + 1];
    transmissions.target[i] = transmissionsRaw[i * 3 + 2];
  }

  const transitionsByAgent = decodeTransitions(
    diseaseBuf, diseaseIndex as DiseaseIndexEntry[],
  );

  const regionsMeta = wastewaterRegions as Omit<WastewaterV2, "values">;
  const wastewater: WastewaterV2 = {
    ...regionsMeta,
    values: new Float32Array(wastewaterBuf),
  };

  const [minLon, minLat, maxLon, maxLat] = manifest.bbox;
  return {
    base,
    manifest,
    venues,
    stays,
    stayIndex,
    agentIds,
    poops,
    transitionsByAgent,
    transmissions,
    aggregates: aggregates as Aggregates,
    wastewater,
    poopLon: (i) => minLon + (poops.lonQ[i] / U16_MAX) * (maxLon - minLon),
    poopLat: (i) => minLat + (poops.latQ[i] / U16_MAX) * (maxLat - minLat),
  };
}

/** disease.bin is [all transitions][all samples]; only transitions are needed per frame. */
function decodeTransitions(
  buffer: ArrayBuffer,
  index: DiseaseIndexEntry[],
): Map<number, [number, number][]> {
  const dv = new DataView(buffer);
  const out = new Map<number, [number, number][]>();
  for (const e of index) {
    if (e.transCount === 0) continue;
    const list: [number, number][] = [];
    for (let i = 0; i < e.transCount; i++) {
      const o = (e.transOffset + i) * TRANSITION_BYTES;
      list.push([dv.getUint16(o, true), dv.getUint8(o + 2)]);
    }
    out.set(e.agentId, list);
  }
  return out;
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

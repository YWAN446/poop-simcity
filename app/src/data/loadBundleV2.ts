import type { Aggregates } from "../types";
import type {
  BundleV2, ManifestV2, PoopsV2, Stays, StayIndexEntry, StaySlice,
  Transmissions, Venues, WastewaterV2,
} from "../types2";

const U16_MAX = 65535;
const TRANSITION_BYTES = 3;

/**
 * Cross-artifact consistency guard. A partial or mismatched bundle regeneration (e.g. one
 * artifact regenerated against a different run than its siblings) fails silently downstream:
 * out-of-range typed-array writes are no-ops and reads past the end yield `undefined`,
 * producing a `NaN` render radius rather than an error. The producer side (the Python
 * preprocessor) already fails loudly on internal inconsistency; this makes the consumer do
 * the same, at load time, before any frame is drawn.
 */
function assertEqual(check: string, values: Record<string, number>): void {
  const entries = Object.entries(values);
  const [, first] = entries[0];
  if (entries.every(([, v]) => v === first)) return;
  const detail = entries.map(([k, v]) => `${k}=${v}`).join(", ");
  throw new Error(`Bundle inconsistency (${check}): ${detail}`);
}

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
    poopsTick, poopsLon, poopsLat, poopsInfected,
    diseaseBuf, diseaseIndex, transmissionsBuf,
    aggregates, wastewaterBuf, wastewaterRegions,
  ] = await Promise.all([
    buf("venuesLon"), buf("venuesLat"), buf("venuesType"), buf("venuesId"),
    buf("staysTick"), buf("staysDwell"), buf("staysVenue"), json("staysIndex"),
    buf("poopsTick"), buf("poopsLon"), buf("poopsLat"),
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
  assertEqual(
    "venue array lengths",
    { lon: venues.lon.length, lat: venues.lat.length, type: venues.type.length, id: venues.id.length },
  );
  assertEqual(
    "venue count vs manifest.numVenues",
    { venues: venues.count, "manifest.numVenues": manifest.numVenues },
  );

  const stays: Stays = {
    tick: new Uint16Array(staysTick),
    dwell: new Uint16Array(staysDwell),
    venue: new Uint16Array(staysVenue),
    count: staysTick.byteLength / 2,
  };
  assertEqual(
    "stays array lengths",
    { tick: stays.tick.length, dwell: stays.dwell.length, venue: stays.venue.length },
  );

  const indexEntries = staysIndex as StayIndexEntry[];
  const stayIndex = new Map<number, StaySlice>();
  const agentIds = new Int32Array(indexEntries.length);
  indexEntries.forEach((e, i) => {
    agentIds[i] = e.agentId;
    stayIndex.set(e.agentId, { offset: e.offset, count: e.count });
  });
  const stayIndexTotal = indexEntries.reduce((sum, e) => sum + e.count, 0);
  assertEqual(
    "stays_index.json counts vs stays array length",
    { "sum(stays_index.count)": stayIndexTotal, "stays.count": stays.count },
  );

  const poops: PoopsV2 = {
    tick: new Uint16Array(poopsTick),
    lonQ: new Uint16Array(poopsLon),
    latQ: new Uint16Array(poopsLat),
    infected: new Uint8Array(poopsInfected),
    count: poopsTick.byteLength / 2,
  };
  assertEqual(
    "poop array lengths",
    {
      tick: poops.tick.length, lonQ: poops.lonQ.length, latQ: poops.latQ.length,
      infected: poops.infected.length,
    },
  );

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
  assertEqual(
    "wastewater.values length vs regions.length * numBins",
    {
      "wastewater.values.length": wastewater.values.length,
      "regions.length * numBins": wastewater.regions.length * wastewater.numBins,
    },
  );

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

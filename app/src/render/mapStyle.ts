import type { StyleSpecification } from "maplibre-gl";

/**
 * CARTO basemap key, injected at build time (see `app/.env` and the README).
 *
 * CARTO moved these tiles behind a key in 2026: unauthenticated requests still
 * return HTTP 200 with a normal-looking PNG, but the watermark is rendered *into*
 * the image, so no cache-clearing or referer trick removes it. Without a key the
 * map still works — it is just watermarked.
 */
const CARTO_KEY = (import.meta.env.VITE_CARTO_API_KEY as string | undefined)?.trim();

/** CARTO takes the key as `?key=`; without one we request the bare URL. */
export function cartoTileUrl(subdomain: string, key = CARTO_KEY): string {
  const base = `https://${subdomain}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`;
  return key ? `${base}?key=${encodeURIComponent(key)}` : base;
}

/** Muted "game skin" basemap using CARTO's raster tiles. */
export const GAME_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [cartoTileUrl("a"), cartoTileUrl("b")],
      tileSize: 256,
      attribution: "© OpenStreetMap, © CARTO",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#e9e4d8" } },
    { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.7, "raster-saturation": -0.4 } },
  ],
};

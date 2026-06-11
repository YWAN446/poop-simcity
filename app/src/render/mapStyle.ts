import type { StyleSpecification } from "maplibre-gl";

/** Muted "game skin" basemap using CARTO's free raster tiles (no API key). */
export const GAME_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap, © CARTO",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#e9e4d8" } },
    { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.7, "raster-saturation": -0.4 } },
  ],
};

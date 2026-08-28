import { describe, it, expect } from "vitest";
import { cartoTileUrl, GAME_MAP_STYLE } from "../src/render/mapStyle";

describe("cartoTileUrl", () => {
  it("appends the key CARTO expects when one is configured", () => {
    const url = cartoTileUrl("a", "abc123");
    expect(url).toContain("basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png");
    expect(url).toContain("?key=abc123");
  });

  it("requests the bare URL when no key is configured", () => {
    // Without a key CARTO still serves tiles, watermarked — the map degrades
    // rather than breaking, so a missing key must not produce "?key=undefined".
    const url = cartoTileUrl("a", undefined);
    expect(url).not.toContain("key=");
    expect(url).toContain("basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png");
  });

  it("treats an empty or whitespace key as absent", () => {
    expect(cartoTileUrl("a", "")).not.toContain("key=");
  });

  it("url-encodes the key rather than injecting it raw", () => {
    expect(cartoTileUrl("a", "a b&c")).toContain("?key=a%20b%26c");
  });

  it("keeps the {z}/{x}/{y} placeholders MapLibre substitutes", () => {
    // A key appended before the placeholders would break tile fetching entirely.
    const url = cartoTileUrl("a", "k");
    expect(url.indexOf("{z}/{x}/{y}")).toBeLessThan(url.indexOf("?key="));
  });

  it("uses both subdomains so MapLibre can parallelise requests", () => {
    const tiles = (GAME_MAP_STYLE.sources.carto as { tiles: string[] }).tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toContain("//a.basemaps");
    expect(tiles[1]).toContain("//b.basemaps");
  });
});

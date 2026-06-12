export type RGBA = [number, number, number, number];

// Disease state colors (indexed by code). Susceptible/Recovered are muted and
// translucent so they recede into a calm backdrop; Exposed/Infectious are vivid
// and fully opaque so an outbreak pops out of the crowd.
export const STATE_COLORS: Record<number, RGBA> = {
  0: [110, 158, 160, 95], // S — quiet desaturated teal
  1: [245, 176, 48, 255], // E — vivid amber
  2: [235, 62, 45, 255], // I — bold red
  3: [140, 158, 140, 78], // R — faint gray-green
};

// Venue colors (indexed by venue type id): Apartment, Workplace, Restaurant, Pub.
export const VENUE_COLORS: Record<number, RGBA> = {
  0: [110, 130, 170, 255],
  1: [150, 140, 120, 255],
  2: [200, 140, 90, 255],
  3: [150, 110, 170, 255],
};

/** Brightness multiplier in [0.35, 1] following a daily cycle; hour in [0,24). */
export function dayNightTint(hour: number): number {
  const t = Math.cos(((hour - 13) / 24) * 2 * Math.PI); // peak ~1pm
  return 0.675 + 0.325 * t;
}

export function scaleRgb(c: RGBA, k: number): RGBA {
  return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k), c[3]];
}

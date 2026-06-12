export type RGBA = [number, number, number, number];

// Disease state colors (indexed by code): S=teal, E=amber, I=warm red, R=muted green.
export const STATE_COLORS: Record<number, RGBA> = {
  0: [56, 178, 172, 200],
  1: [237, 187, 79, 230],
  2: [229, 80, 57, 240],
  3: [120, 160, 120, 180],
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

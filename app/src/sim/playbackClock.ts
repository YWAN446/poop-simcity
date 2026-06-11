export interface TickRange {
  min: number;
  max: number;
}

/** New (fractional) tick after `dtMs` at `ticksPerSecond`, clamped to range. */
export function advanceTick(
  currentTick: number,
  dtMs: number,
  ticksPerSecond: number,
  range: TickRange,
): number {
  const next = currentTick + (dtMs / 1000) * ticksPerSecond;
  return Math.min(range.max, Math.max(range.min, next));
}

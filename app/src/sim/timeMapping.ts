/** Wall-clock Date for a tick. */
export function tickToDate(
  startTime: string,
  tickIntervalSec: number,
  tick: number,
): Date {
  return new Date(new Date(startTime).getTime() + tick * tickIntervalSec * 1000);
}

/** Index into an hourly aggregate series for a given tick. */
export function hourBinIndex(
  tick: number,
  tickIntervalSec: number,
  cadenceSec: number,
): number {
  const ticksPerBin = cadenceSec / tickIntervalSec;
  return Math.floor(tick / ticksPerBin);
}

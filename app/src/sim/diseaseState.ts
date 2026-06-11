/** State code active at `tick` = the last transition at-or-before it (default 0/S). */
export function stateAtTick(transitions: [number, number][], tick: number): number {
  let lo = 0;
  let hi = transitions.length - 1;
  let result = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (transitions[mid][0] <= tick) {
      result = transitions[mid][1];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

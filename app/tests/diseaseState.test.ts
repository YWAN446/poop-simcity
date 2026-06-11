import { describe, it, expect } from "vitest";
import { stateAtTick } from "../src/sim/diseaseState";

describe("stateAtTick", () => {
  const transitions: [number, number][] = [
    [0, 0],
    [48, 1],
    [72, 2],
  ];

  it("returns the last transition at or before the tick", () => {
    expect(stateAtTick(transitions, 0)).toBe(0);
    expect(stateAtTick(transitions, 47)).toBe(0);
    expect(stateAtTick(transitions, 48)).toBe(1);
    expect(stateAtTick(transitions, 100)).toBe(2);
  });

  it("defaults to Susceptible (0) before the first transition or when empty", () => {
    expect(stateAtTick([[10, 2]], 5)).toBe(0);
    expect(stateAtTick([], 5)).toBe(0);
  });
});

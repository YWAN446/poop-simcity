import { describe, it, expect } from "vitest";
import { DATASETS, resolveInitialDataset } from "../src/data/datasets";

describe("resolveInitialDataset", () => {
  it("has both datasets registered", () => {
    expect(DATASETS.map((d) => d.id)).toEqual(["dataset_00", "dataset_sdc-10k"]);
  });

  it("prefers the query param over the env default", () => {
    const result = resolveInitialDataset("?dataset=dataset_sdc-10k", "dataset_00");
    expect(result.id).toBe("dataset_sdc-10k");
  });

  it("falls back to the env default when there is no query param", () => {
    const result = resolveInitialDataset("", "dataset_sdc-10k");
    expect(result.id).toBe("dataset_sdc-10k");
  });

  it("falls back to dataset_00 when neither query param nor env default is set", () => {
    const result = resolveInitialDataset("", undefined);
    expect(result.id).toBe("dataset_00");
  });

  it("falls back past an unknown query param to the env default", () => {
    const result = resolveInitialDataset("?dataset=not-a-real-dataset", "dataset_sdc-10k");
    expect(result.id).toBe("dataset_sdc-10k");
  });

  it("falls back to dataset_00 when the env default is unknown", () => {
    const result = resolveInitialDataset("", "not-a-real-dataset");
    expect(result.id).toBe("dataset_00");
  });

  it("falls back to dataset_00 when both the query param and env default are unknown", () => {
    const result = resolveInitialDataset("?dataset=nope", "also-nope");
    expect(result.id).toBe("dataset_00");
  });

  it("does not throw for a malformed query string", () => {
    expect(() => resolveInitialDataset("???", "dataset_00")).not.toThrow();
  });
});

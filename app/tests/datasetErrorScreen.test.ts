import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import App from "../src/App";

// This file is `.test.ts` (not `.test.tsx`) like the rest of the suite, so it
// uses `createElement` rather than JSX — esbuild only parses JSX syntax in
// `.tsx`/`.jsx` files.

// Mirrors the mocking pattern in useBundleV2.test.ts: the hook imports this
// module directly, so mocking it (rather than `fetch`) is the narrowest way
// to force the "bundle failed to load" path this test exercises — the
// situation a fresh clone hits when it opens on the gitignored
// dataset_sdc-10k bundle.
const loadBundleV2 = vi.hoisted(() => vi.fn());
vi.mock("../src/data/loadBundleV2", () => ({ loadBundleV2 }));

beforeEach(async () => {
  loadBundleV2.mockReset();
  await Promise.resolve();
});

afterEach(() => {
  cleanup();
  window.history.pushState(null, "", "/");
});

describe("missing-bundle screen", () => {
  it("shows guidance naming the dataset, not a raw error, and keeps the switcher usable", async () => {
    window.history.pushState(null, "", "/?dataset=dataset_sdc-10k");
    const rawMessage = "Failed to load /data/dataset_sdc-10k/manifest.json: 404";
    loadBundleV2.mockRejectedValue(new Error(rawMessage));

    render(createElement(App));

    // Names the dataset. (Scoped to the heading — the switcher's own <option>
    // for this dataset also contains the label text.)
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /San Diego/i })).toBeTruthy(),
    );
    // Explains the bundle must be generated, with the actual preprocessor command.
    expect(screen.getByText(/not committed/i)).toBeTruthy();
    expect(screen.getByText(/poop_simcity_preprocess\.cli/)).toBeTruthy();
    expect(screen.getByText(/--dataset \.\.\/dataset_sdc-10k/)).toBeTruthy();
    // Not a raw error dump as the headline experience (the message may still
    // appear as a small aside, but the guidance text above must be present).
    expect(screen.queryByText(rawMessage)).toBeNull();

    // The switcher is still there and usable, so the user isn't stuck.
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("dataset_sdc-10k");
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain("dataset_00");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBundleV2 } from "../src/hooks/useBundleV2";

const loadBundleV2 = vi.hoisted(() => vi.fn());
vi.mock("../src/data/loadBundleV2", () => ({ loadBundleV2 }));

// `mockReset` runs synchronously in `beforeEach`, but under this Vitest/jsdom/
// testing-library combination a rejected promise created by a mock reset in a
// *hook* (as opposed to inline in the test body) can be seen as transiently
// unhandled by the time `renderHook`'s effect attaches its `.catch` — failing
// the *next* test with the *previous* test's rejection reason. Flushing one
// microtask after the reset avoids the race without changing the reset's
// per-test semantics. See investigation in task-14-report.md.
beforeEach(async () => {
  loadBundleV2.mockReset();
  await Promise.resolve();
});

describe("useBundleV2", () => {
  it("starts in the loading state", () => {
    loadBundleV2.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useBundleV2("/data/x"));
    expect(result.current.status).toBe("loading");
  });

  it("exposes the bundle once it resolves", async () => {
    const bundle = { manifest: { runId: "x" } };
    loadBundleV2.mockResolvedValue(bundle);
    const { result } = renderHook(() => useBundleV2("/data/x"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ status: "ready", bundle });
  });

  it("surfaces the failure message rather than throwing", async () => {
    loadBundleV2.mockRejectedValue(new Error("stays_tick.u16 404"));
    const { result } = renderHook(() => useBundleV2("/data/x"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ message: "stays_tick.u16 404" });
  });

  it("ignores a resolution that lands after unmount", async () => {
    let resolve!: (v: unknown) => void;
    loadBundleV2.mockReturnValue(new Promise((r) => { resolve = r; }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useBundleV2("/data/x"));
    unmount();
    resolve({ manifest: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.status).toBe("loading");   // never advanced post-unmount
    expect(errors).not.toHaveBeenCalled();           // no setState-after-unmount warning
    errors.mockRestore();
  });
});

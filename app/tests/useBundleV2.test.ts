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

  // NOTE: this replaces a prior test named "ignores a resolution that lands after
  // unmount", which asserted `result.current.status` stayed "loading" and that no
  // console.error fired post-unmount. Both assertions passed whether or not the
  // `cancelled` guard existed: React 18 silently drops a setState call on an
  // unmounted component (no warning, no re-render, so `result.current` — a
  // snapshot from the last commit before unmount — can never reflect it either
  // way). It was verified by deleting the guard entirely; the old test still
  // passed 100% of the time. There is no way to observe this stack silently
  // no-op a setState, so that scenario isn't a meaningful thing to assert on.
  //
  // The guard's actual job — ignoring a *stale* in-flight load once a newer one
  // has superseded it — has a real, observable failure mode while the component
  // is still mounted: rerender with a new `base` before the old promise settles,
  // let the newer load win, then resolve the old one. Without the guard, the old
  // `.then` still calls `setState` unconditionally and clobbers the current state
  // with stale data.
  it("ignores a stale resolution superseded by a newer load", async () => {
    let resolveFirst!: (v: unknown) => void;
    loadBundleV2.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    const secondBundle = { manifest: { runId: "second" } };
    loadBundleV2.mockImplementationOnce(() => Promise.resolve(secondBundle));

    const { result, rerender } = renderHook(
      ({ base }) => useBundleV2(base),
      { initialProps: { base: "/data/first" } },
    );
    rerender({ base: "/data/second" });
    await waitFor(() =>
      expect(result.current).toMatchObject({ status: "ready", bundle: secondBundle }),
    );

    // The superseded first load settles after the second one already won.
    resolveFirst({ manifest: { runId: "first" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toMatchObject({ status: "ready", bundle: secondBundle });
  });
});

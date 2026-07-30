import { useEffect, useState } from "react";
import { loadBundleV2 } from "../data/loadBundleV2";
import type { BundleV2 } from "../types2";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bundle: BundleV2 };

export function useBundleV2(base: string): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadBundleV2(base)
      .then((bundle) => {
        if (!cancelled) setState({ status: "ready", bundle });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [base]);
  return state;
}

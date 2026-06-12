import { useEffect, useState } from "react";
import { loadBundle, type Bundle } from "../data/loadBundle";

type State =
  | { status: "loading" }
  | { status: "ready"; bundle: Bundle }
  | { status: "error"; message: string };

export function useBundle(base: string): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    loadBundle(base)
      .then((bundle) => alive && setState({ status: "ready", bundle }))
      .catch((e) => alive && setState({ status: "error", message: String(e) }));
    return () => {
      alive = false;
    };
  }, [base]);
  return state;
}

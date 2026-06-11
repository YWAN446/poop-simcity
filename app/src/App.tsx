import { useBundle } from "./hooks/useBundle";
import { MapView } from "./ui/MapView";

const BUNDLE_BASE = "/data/dataset_00";

export default function App() {
  const state = useBundle(BUNDLE_BASE);
  if (state.status === "loading") return <div className="app-shell">Loading…</div>;
  if (state.status === "error")
    return <div className="app-shell">Error: {state.message}</div>;
  // Fixed mid-outbreak tick until playback lands in Task 9.
  const tick = Math.floor(state.bundle.manifest.outbreakWindow.endTick / 4);
  return (
    <div className="app-shell">
      <MapView bundle={state.bundle} tick={tick} />
    </div>
  );
}

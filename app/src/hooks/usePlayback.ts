import { useCallback, useEffect, useRef, useState } from "react";
import { advanceTick, type TickRange } from "../sim/playbackClock";

export function usePlayback(range: TickRange, initialTick: number) {
  const [tick, setTick] = useState(initialTick);
  const [playing, setPlaying] = useState(false);
  const [ticksPerSecond, setTicksPerSecond] = useState(48); // ~4 sim-hours / real sec
  const last = useRef<number | null>(null);
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const step = (now: number) => {
      if (last.current != null) {
        const next = advanceTick(tickRef.current, now - last.current, ticksPerSecond, range);
        setTick(next);
        if (next >= range.max) setPlaying(false);
      }
      last.current = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, ticksPerSecond, range]);

  const seek = useCallback((t: number) => setTick(Math.min(range.max, Math.max(range.min, t))), [range]);
  return { tick, playing, setPlaying, ticksPerSecond, setTicksPerSecond, seek };
}

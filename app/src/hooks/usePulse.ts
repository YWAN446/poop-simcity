import { useEffect, useRef, useState } from "react";

/**
 * A smooth 0→1→0 pulse driven by requestAnimationFrame, independent of playback,
 * so highlights (e.g. the infection glow) keep breathing even when paused.
 */
export function usePulse(periodMs = 1700): number {
  const [phase, setPhase] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const step = (now: number) => {
      if (start.current == null) start.current = now;
      const t = ((now - start.current) % periodMs) / periodMs; // 0..1
      setPhase(0.5 - 0.5 * Math.cos(t * 2 * Math.PI)); // eased 0→1→0
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [periodMs]);
  return phase;
}

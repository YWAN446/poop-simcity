import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { Aggregates } from "../types";

export function SeirChart({ agg, hourBin }: { agg: Aggregates; hourBin: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const x = agg.gridTicks.map((_, i) => i);
    const data = [x, agg.seir.S, agg.seir.E, agg.seir.I, agg.seir.R] as uPlot.AlignedData;
    const opts: uPlot.Options = {
      width: 320, height: 120, title: "SEIR",
      scales: { x: { time: false } },
      series: [
        {},
        { label: "S", stroke: "#38b2ac", fill: "rgba(56,178,172,0.2)" },
        { label: "E", stroke: "#edbb4f" },
        { label: "I", stroke: "#e55039", fill: "rgba(229,80,57,0.25)" },
        { label: "R", stroke: "#78a078" },
      ],
    };
    plot.current = new uPlot(opts, data, ref.current);
    return () => plot.current?.destroy();
  }, [agg]);

  useEffect(() => {
    if (!plot.current) return;
    const left = plot.current.valToPos(hourBin, "x");
    plot.current.setCursor({ left, top: 0 });
  }, [hourBin]);

  return <div ref={ref} />;
}

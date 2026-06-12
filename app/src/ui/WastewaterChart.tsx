import { useEffect, useRef } from "react";
import uPlot from "uplot";
import type { Aggregates } from "../types";

export function WastewaterChart({ agg, hourBin }: { agg: Aggregates; hourBin: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const x = agg.pathogenInflow.map((_, i) => i);
    const data = [x, agg.pathogenInflow] as uPlot.AlignedData;
    const opts: uPlot.Options = {
      width: 320, height: 100, title: "Wastewater pathogen / hr",
      scales: { x: { time: false } },
      series: [{}, { label: "load", stroke: "#7a6baa", fill: "rgba(122,107,170,0.3)" }],
    };
    plot.current = new uPlot(opts, data, ref.current);
    return () => {
      plot.current?.destroy();
      plot.current = null;
    };
  }, [agg]);

  useEffect(() => {
    if (!plot.current) return;
    const left = plot.current.valToPos(hourBin, "x");
    plot.current.setCursor({ left, top: 0 });
  }, [hourBin]);

  return <div ref={ref} />;
}

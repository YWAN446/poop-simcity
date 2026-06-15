import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { Aggregates } from "../types";

const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
};

export function SeirChart({ agg, hourBin }: { agg: Aggregates; hourBin: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const startSec = Math.floor(new Date(agg.startTime).getTime() / 1000);
  const cadence = agg.cadenceSec;

  useEffect(() => {
    if (!ref.current) return;
    const x = agg.gridTicks.map((_, i) => startSec + i * cadence);
    const data = [
      x,
      agg.seir.S,
      agg.seir.E,
      agg.seir.I,
      agg.seir.R,
    ] as uPlot.AlignedData;
    const opts: uPlot.Options = {
      width: 400,
      height: 150,
      title: "SEIR",
      legend: { show: false },
      scales: { x: { time: true } },
      series: [
        { label: "Date" },
        { label: "S", stroke: "#38b2ac", fill: "rgba(56,178,172,0.2)" },
        { label: "E", stroke: "#edbb4f" },
        { label: "I", stroke: "#e55039", fill: "rgba(229,80,57,0.25)" },
        { label: "R", stroke: "#78a078" },
      ],
    };
    plot.current = new uPlot(opts, data, ref.current);
    return () => {
      plot.current?.destroy();
      plot.current = null;
    };
  }, [agg, startSec, cadence]);

  useEffect(() => {
    if (!plot.current) return;
    const left = plot.current.valToPos(startSec + hourBin * cadence, "x");
    plot.current.setCursor({ left, top: 0 });
  }, [hourBin, startSec, cadence]);

  const dateStr = new Date((startSec + hourBin * cadence) * 1000).toLocaleString(
    undefined,
    DATE_FMT,
  );
  return (
    <div className="chart-block">
      <div ref={ref} />
      <div className="chart-readout">
        <div className="readout-date">{dateStr}</div>
        <div className="readout-values">
          <span className="c-s">S {agg.seir.S[hourBin]}</span>
          <span className="c-e">E {agg.seir.E[hourBin]}</span>
          <span className="c-i">I {agg.seir.I[hourBin]}</span>
          <span className="c-r">R {agg.seir.R[hourBin]}</span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import type { Aggregates } from "../types";

const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
};
const NUM_FMT = new Intl.NumberFormat(undefined, {
  notation: "compact", maximumFractionDigits: 2,
});

export function WastewaterChart({ agg, hourBin }: { agg: Aggregates; hourBin: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const startSec = Math.floor(new Date(agg.startTime).getTime() / 1000);
  const cadence = agg.cadenceSec;

  useEffect(() => {
    if (!ref.current) return;
    const x = agg.pathogenInflow.map((_, i) => startSec + i * cadence);
    const data = [x, agg.pathogenInflow] as uPlot.AlignedData;
    const opts: uPlot.Options = {
      width: 400,
      height: 210,
      title: "Number of Pathogen in Wastewater",
      legend: { show: false },
      scales: { x: { time: true } },
      series: [
        { label: "Date" },
        { label: "Pathogen", stroke: "#7a6baa", fill: "rgba(122,107,170,0.3)" },
      ],
      axes: [
        {},
        {
          // Pathogen totals run into the billions (vs. SEIR's low thousands), and
          // uPlot's default y-axis gutter is a fixed 50px sized for the default
          // comma-grouped formatter — wide raw numbers like "500,000" overflow it
          // and get left-clipped to "00,000". Compact notation (matching the
          // readout line below the chart) keeps labels short enough to fit, and
          // widening the gutter a bit gives headroom for the widest cases (e.g.
          // "15.2B").
          values: (_u, vals) => vals.map((v) => NUM_FMT.format(v)),
          size: 60,
        },
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
          <span className="c-path">Pathogen {NUM_FMT.format(agg.pathogenInflow[hourBin] ?? 0)}</span>
        </div>
      </div>
    </div>
  );
}

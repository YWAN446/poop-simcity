import { useState } from "react";
import { STATE_COLORS, VENUE_COLORS, type RGBA } from "../render/theme";

const rgb = (c: RGBA) => `rgb(${c[0]},${c[1]},${c[2]})`;

// Poop tints live in the poop layer (not shared constants); mirror them here.
const POOP_PATHOGEN = "rgb(230,60,48)";
const POOP_CLEAN = "rgb(150,110,70)";

const AGENT_LABELS = ["Susceptible", "Exposed", "Infectious", "Recovered"];
const VENUE_LABELS = ["Apartment", "Workplace", "Restaurant", "Pub"];

function Swatch({ color }: { color: string }) {
  return <span className="legend-swatch" style={{ background: color }} />;
}

export function Legend({ venueCounts }: { venueCounts: Record<number, number> }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="legend">
      <button className="legend-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Legend
      </button>
      {open && (
        <div className="legend-body">
          <div className="legend-section">
            <div className="legend-title">Agents</div>
            {AGENT_LABELS.map((label, i) => (
              <div key={label} className="legend-row">
                <Swatch color={rgb(STATE_COLORS[i])} />
                {label}
              </div>
            ))}
          </div>
          <div className="legend-section">
            <div className="legend-title">Poops</div>
            <div className="legend-row">
              <Swatch color={POOP_PATHOGEN} />
              Pathogen-bearing
            </div>
            <div className="legend-row">
              <Swatch color={POOP_CLEAN} />
              Clean
            </div>
          </div>
          <div className="legend-section">
            <div className="legend-title">Venues</div>
            {VENUE_LABELS.map((label, i) => (
              <div key={label} className="legend-row">
                <Swatch color={rgb(VENUE_COLORS[i])} />
                {label} <span className="legend-count">({venueCounts[i] ?? 0})</span>
              </div>
            ))}
          </div>
          <div className="legend-section">
            <div className="legend-title">Wastewater pathogen</div>
            <div className="legend-gradient" />
            <div className="legend-gradient-labels">
              <span>low</span>
              <span>high</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

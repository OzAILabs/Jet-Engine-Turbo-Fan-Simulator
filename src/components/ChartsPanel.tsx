/**
 * ChartsPanel
 *
 * A DOM (HTML) side panel that turns the live engine numbers into simple
 * horizontal bar charts so students can *see* how pressure, temperature,
 * thrust, and shaft work are distributed through the engine.
 *
 * Everything here is plain DOM (no 3D). We subscribe reactively to the
 * engine slice of the store so the bars recompute whenever the physics
 * updates. The bars themselves are pure CSS widths driven by percentages.
 */
import { useState, type ReactNode } from 'react';
import { useSimStore } from '../store/useSimStore';
import { temperatureColor } from '../util/colorScale';
import { paToKpa, newtonsToKn } from '../sim/units';
import { StartTrends } from './StartTrends';
import { CompressorMap } from './CompressorMap';
import { TsDiagram } from './TsDiagram';

/** StationId values we read from engine.stations. */
type StationKey = '2' | '25' | '3' | '4' | '45' | '5' | '8';

/**
 * Render a single horizontal bar.
 *
 * Layout: [label] [track with a colored fill] [value]
 * The fill width is a percentage; the color is any CSS color string.
 */
function Bar(props: {
  label: string;
  pct: number;
  color: string;
  value: string;
}) {
  const { label, pct, color, value } = props;
  // Clamp the visual width into [0, 100] so a stray number can't blow out
  // the layout. The displayed value is unaffected by this clamp.
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="bar">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: width + '%', background: color }} />
      </div>
      <span className="bar-val">{value}</span>
    </div>
  );
}

/**
 * Collapsible chart group. Children stay MOUNTED while collapsed (hidden via
 * CSS) so time-history components (StartTrends' ring buffer, CompressorMap's
 * trail) keep recording and reopen with their history intact.
 */
function ChartSection(props: { title: string; children: ReactNode }) {
  const { title, children } = props;
  const [open, setOpen] = useState(true);
  return (
    <div className="chart">
      <button className="chart-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span>
        <span className="chart-chevron">{open ? '▾' : '▸'}</span>
      </button>
      <div className={open ? undefined : 'chart-collapsed'}>{children}</div>
    </div>
  );
}

export function ChartsPanel() {
  // Reactive subscription: the panel re-renders when the engine state changes.
  const engine = useSimStore((s) => s.engine);
  const { stations, work } = engine;

  // --- Chart 1: Pressure by station (kPa) --------------------------------
  // Stagnation/static pressure climbs through the compressors, peaks around
  // the combustor, then drops across the turbines and nozzle.
  const pressureIds: StationKey[] = ['2', '25', '3', '4', '45', '5', '8'];
  const pressureVals = pressureIds.map((id) => paToKpa(stations[id].pressure));
  // Guard against zero/negative so we never divide by zero below.
  const maxPressure = Math.max(1e-6, ...pressureVals);

  // --- Chart 2: Temperature by station (K) -------------------------------
  // Temperature rises through compression and combustion (peaking at the
  // turbine inlet, station 4), then falls as the turbines extract work.
  const tempIds: StationKey[] = ['2', '25', '3', '4', '45', '5'];
  const tempVals = tempIds.map((id) => stations[id].temperature);
  const maxTemp = Math.max(1e-6, ...tempVals);

  // --- Chart 3: Thrust contribution (kN) ---------------------------------
  // A high-bypass turbofan makes most of its thrust from the cool bypass
  // stream, with the hot core contributing the rest.
  const bypassKn = newtonsToKn(engine.bypassThrust);
  const coreKn = newtonsToKn(engine.coreThrust);
  const netKn = newtonsToKn(engine.netThrust);
  const thrustRef = Math.max(1e-6, netKn);

  // --- Chart 4: Compressor work split (kW) -------------------------------
  // How the shaft power budget is divided between the fan, booster (LPC),
  // and high-pressure compressor. Values come from engine.work in watts.
  const fanKw = work.fan / 1000;
  const boosterKw = work.booster / 1000;
  const hpcKw = work.hpc / 1000;
  const maxWork = Math.max(1e-6, fanKw, boosterKw, hpcKw);

  return (
    <div className="panel">
      <div className="panel-title">Charts</div>

      {/* Start trends: rolling N1/EGT/FF strip chart — the start-sequence story */}
      <ChartSection title="Start trends — N1 · EGT · FF">
        <StartTrends />
      </ChartSection>

      {/* Compressor map: surge line vs the live operating point */}
      <ChartSection title="Compressor map">
        <CompressorMap />
      </ChartSection>

      {/* T-s diagram: the live Brayton cycle from the station entropy data */}
      <ChartSection title="T–s diagram — the live cycle">
        <TsDiagram />
      </ChartSection>

      {/* Pressure by station */}
      <div className="chart">
        <div className="chart-title">Pressure by station</div>
        <div className="bars">
          {pressureIds.map((id, i) => {
            const value = pressureVals[i];
            return (
              <Bar
                key={id}
                label={id}
                pct={(value / maxPressure) * 100}
                color="#5aa0ff"
                value={value.toFixed(0) + ' kPa'}
              />
            );
          })}
        </div>
      </div>

      {/* Temperature by station */}
      <div className="chart">
        <div className="chart-title">Temperature by station</div>
        <div className="bars">
          {tempIds.map((id, i) => {
            const value = tempVals[i];
            return (
              <Bar
                key={id}
                label={id}
                pct={(value / maxTemp) * 100}
                color={temperatureColor(value).getStyle()}
                value={value.toFixed(0) + ' K'}
              />
            );
          })}
        </div>
      </div>

      {/* Thrust contribution */}
      <div className="chart">
        <div className="chart-title">Thrust contribution</div>
        <div className="bars">
          <Bar
            label="Bypass"
            pct={(bypassKn / thrustRef) * 100}
            color="#5aa0ff"
            value={bypassKn.toFixed(1) + ' kN'}
          />
          <Bar
            label="Core"
            pct={(coreKn / thrustRef) * 100}
            color="#ff8a4a"
            value={coreKn.toFixed(1) + ' kN'}
          />
        </div>
        <div className="panel-subtitle">Most thrust comes from the bypass stream.</div>
      </div>

      {/* Compressor work split */}
      <div className="chart">
        <div className="chart-title">Compressor work split</div>
        <div className="bars">
          <Bar
            label="Fan"
            pct={(fanKw / maxWork) * 100}
            color="#5aa0ff"
            value={fanKw.toFixed(0) + ' kW'}
          />
          <Bar
            label="Booster"
            pct={(boosterKw / maxWork) * 100}
            color="#7bb8ff"
            value={boosterKw.toFixed(0) + ' kW'}
          />
          <Bar
            label="HPC"
            pct={(hpcKw / maxWork) * 100}
            color="#9c6bff"
            value={hpcKw.toFixed(0) + ' kW'}
          />
        </div>
      </div>
    </div>
  );
}

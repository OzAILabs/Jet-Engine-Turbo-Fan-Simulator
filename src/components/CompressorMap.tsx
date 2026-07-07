/**
 * CompressorMap — the core compressor map drawn the way engineers draw it:
 * CORRECTED FLOW (fraction of design core flow) on X vs PRESSURE RATIO on Y,
 * with real speed lines, the operating line, and the surge line.
 *
 * All geometry comes from src/sim/compressorMap.ts, which generates the map
 * FROM the cycle's own schedules — the live dot rides the plotted operating
 * line at every steady point by construction.
 *
 *  • SPEED LINES — one falling curve per corrected N2 (surge top → choke).
 *  • SURGE LINE — locus of speed-line tops; region above it shaded red.
 *  • LIVE POINT — (Wc(N2), OPR) with the throttle-transient margin penalty
 *    displayed as a PR lift toward the surge line (over-fueling raises the
 *    working line — that's what eats the margin), plus a fading ~8 s trail.
 *
 * Data flow (project convention for sub-60fps UI): a transient 10 Hz interval
 * reads useSimStore.getState() into a trail ref; the component re-renders at
 * the sample rate. Sampling (and the trail) freezes while the sim is paused.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSimStore } from '../store/useSimStore';
import { buildCoreCompressorMap } from '../sim/compressorMap';
import { coreFlowFraction } from '../sim/engineModel';
import { clamp } from '../sim/units';

/** Axis domain: corrected flow (fraction of design) × pressure ratio. */
const WC_MIN = 0;
const WC_MAX = 1.2;
const PR_MIN = 1;
const PR_MAX = 56;

/** Trail: ~8 s at 10 Hz. */
const SAMPLE_MS = 100;
const TRAIL_MAX = 80;

/** SVG geometry (viewBox units; CSS scales the SVG to panel width). */
const W = 240;
const H = 168;
const ML = 26;
const MR = 8;
const MT = 8;
const MB = 20;
const PW = W - ML - MR;
const PH = H - MT - MB;

const xMap = (wc: number) => ML + ((clamp(wc, WC_MIN, WC_MAX) - WC_MIN) / (WC_MAX - WC_MIN)) * PW;
const yMap = (pr: number) => MT + (1 - (clamp(pr, PR_MIN, PR_MAX) - PR_MIN) / (PR_MAX - PR_MIN)) * PH;

interface MapSample {
  wc: number;
  pr: number;
  surgeMargin: number;
  n2: number;
}

export function CompressorMap() {
  // Narrow reactive selector; config is static so this never re-renders.
  const cfg = useSimStore((s) => s.config);

  const trailRef = useRef<MapSample[]>([]);
  const [, setVersion] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      const state = useSimStore.getState();
      if (state.paused) return; // freeze dot + trail with the sim
      const { spool, engine, surgeMargin } = state;
      // Transient margin penalty displayed as a PR lift toward the surge line
      // (accel over-fueling raises the working line — that IS the mechanism).
      const penalty = Math.max(0, engine.surgeMarginSteady - surgeMargin);
      const trail = trailRef.current;
      trail.push({
        wc: coreFlowFraction(spool.n2, state.config),
        pr: engine.overallPressureRatio * (1 + penalty / 100),
        surgeMargin,
        n2: spool.n2,
      });
      while (trail.length > TRAIL_MAX) trail.shift();
      setVersion((v) => v + 1);
    }, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, []);

  // Static map geometry — computed once (config never changes at runtime).
  const { speedLines, surgeLine, surgeRegion, opLine } = useMemo(() => {
    const map = buildCoreCompressorMap(cfg);
    const toPts = (pts: { wc: number; pr: number }[]) =>
      pts.map((p) => `${xMap(p.wc).toFixed(1)},${yMap(p.pr).toFixed(1)}`).join(' ');
    return {
      speedLines: map.speedLines.map((l) => ({ n2c: l.n2c, pts: toPts(l.points) })),
      surgeLine: toPts(map.surgeLine),
      // Close the shaded region above the line via the top-left corner.
      surgeRegion: `${toPts(map.surgeLine)} ${xMap(map.surgeLine[map.surgeLine.length - 1].wc)},${MT} ${ML},${MT}`,
      opLine: toPts(map.operatingLine),
    };
  }, [cfg]);

  const trail = trailRef.current;
  const live = trail.length > 0 ? trail[trail.length - 1] : null;
  // Sub-idle the core flow is starter territory — park the dot off-map.
  const onMap = live !== null && live.n2 >= 0.5;
  const dotState = live === null ? '' : live.surgeMargin < 5 ? ' is-crit' : live.surgeMargin < 15 ? ' is-warn' : '';
  const smState = live === null ? '' : live.surgeMargin < 5 ? ' sm-crit' : live.surgeMargin < 15 ? ' sm-warn' : '';

  const xTicks = [0.2, 0.4, 0.6, 0.8, 1.0];
  const yTicks = [10, 20, 30, 40, 50];

  return (
    <div className="cm">
      <div className={`cm-readout${smState}`}>
        <span>
          N2 <b>{live ? (live.n2 * 100).toFixed(1) : '--'}%</b>
        </span>
        <span>
          PR <b>{live ? live.pr.toFixed(1) : '--'}</b>
        </span>
        <span className="cm-sm" title="Surge margin">
          SM <b>{live ? live.surgeMargin.toFixed(0) : '--'}%</b>
        </span>
      </div>

      <svg className="cm-svg" viewBox={`0 0 ${W} ${H}`} aria-label="Compressor map">
        <rect x={ML} y={MT} width={PW} height={PH} className="cm-frame" />

        {/* faint grid */}
        {xTicks.map((t) => (
          <line key={t} x1={xMap(t)} y1={MT} x2={xMap(t)} y2={MT + PH} className="cm-grid" />
        ))}
        {yTicks.map((t) => (
          <line key={t} x1={ML} y1={yMap(t)} x2={ML + PW} y2={yMap(t)} className="cm-grid" />
        ))}

        {/* constant corrected-speed lines (surge top → choke) */}
        {speedLines.map((l) => (
          <polyline key={l.n2c} points={l.pts} className="cm-grid" strokeWidth={0.8} fill="none" />
        ))}

        {/* surge region + line */}
        <polygon points={surgeRegion} className="cm-surge-region" />
        <polyline points={surgeLine} className="cm-surge-line" fill="none" />
        <text x={ML + 10} y={MT + 14} className="cm-region-label">
          SURGE
        </text>

        {/* steady operating line */}
        <polyline points={opLine} className="cm-op-line" fill="none" />
        <text x={xMap(0.52)} y={yMap(18)} className="cm-op-label">
          OP LINE
        </text>

        {/* live trail (oldest faintest) + dot */}
        {onMap &&
          trail.map((s, i) =>
            s.n2 >= 0.5 && i < trail.length - 1 ? (
              <circle
                key={i}
                cx={xMap(s.wc)}
                cy={yMap(s.pr)}
                r={1.6}
                className="cm-trail"
                opacity={0.08 + 0.5 * (i / trail.length)}
              />
            ) : null,
          )}
        {onMap && live && <circle cx={xMap(live.wc)} cy={yMap(live.pr)} r={3.2} className={`cm-dot${dotState}`} />}
        {!onMap && (
          <text x={ML + 10} y={MT + PH - 8} className="cm-offmap">
            SUB-IDLE — BELOW MAP RANGE
          </text>
        )}

        {/* axes (minimal) */}
        {xTicks.map((t) => (
          <text key={t} x={xMap(t)} y={MT + PH + 9} className="cm-tick cm-tick-x">
            {t.toFixed(1)}
          </text>
        ))}
        {yTicks.map((t) => (
          <text key={t} x={ML - 3} y={yMap(t) + 2.5} className="cm-tick cm-tick-y">
            {t}
          </text>
        ))}
        <text x={ML + PW / 2} y={H - 2} className="cm-axis-label">
          CORRECTED FLOW — FRACTION OF DESIGN
        </text>
        <text x={9} y={MT + PH / 2} className="cm-axis-label" transform={`rotate(-90 9 ${MT + PH / 2})`}>
          PR
        </text>
      </svg>
      <div className="cm-caption">
        Real map plane: speed lines surge→choke, live point vs the surge line (amber &lt; 15 % margin, red &lt; 5 %).
        Slam the throttle — over-fueling lifts the working line toward surge.
      </div>
    </div>
  );
}

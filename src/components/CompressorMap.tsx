/**
 * CompressorMap — a stylized core compressor map for teaching: corrected core
 * speed (N2, fraction of rated) on X vs overall pressure ratio on Y.
 *
 * The curves are derived from the sim's OWN steady relationships (rather than
 * an arbitrary hand fit) so the live dot rides the plotted operating line at
 * every steady point:
 *  • OPERATING LINE — mirrors engineModel.ts sea-level-static:
 *    opr = 1 + cRun · (lerp(idleOPR, oprMax, cOp^1.25) − 1). With the default
 *    config it passes idle 0.66 → OPR 9 [config idleOverallPressureRatio],
 *    ~0.95 → ~30, takeoff 1.08 → 42 [config overallPressureRatioMax].
 *  • SURGE LINE — the operating line lifted by the steady surge-margin
 *    schedule (surgeMarginSteady = 30 − 9·cOp + 2·(1 − cRun)): ~30 % headroom
 *    at idle converging toward ~21 % at takeoff, exiting the top of the plot
 *    just past 100 % N2. Region above it shaded faint red.
 *  • LIVE POINT — bright dot at (spool.n2, engine.overallPressureRatio) with
 *    a fading ~8 s trail. The dot recolors from the sim's real surgeMargin
 *    (amber < 15 %, red < 5 %) — slam the throttle and the transient penalty
 *    walks the dot toward the surge line and turns it amber.
 *
 * Data flow (project convention for sub-60fps UI): a transient 10 Hz interval
 * reads useSimStore.getState() into a trail ref; the component re-renders at
 * the sample rate. Sampling (and the trail) freezes while the sim is paused.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSimStore } from '../store/useSimStore';
import type { EngineConfig } from '../sim/types';
import { clamp, lerp, smootherstep } from '../sim/units';

/** Axis domain. */
const N2_MIN = 0.4;
const N2_MAX = 1.15;
const OPR_MIN = 1;
const OPR_MAX = 45;

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

const xMap = (n2: number) => ML + ((clamp(n2, N2_MIN, N2_MAX) - N2_MIN) / (N2_MAX - N2_MIN)) * PW;
const yMap = (opr: number) => MT + (1 - (clamp(opr, OPR_MIN, OPR_MAX) - OPR_MIN) / (OPR_MAX - OPR_MIN)) * PH;

/** Steady operating line — mirrors engineModel.ts at sea-level static. */
function steadyOpr(n2: number, cfg: EngineConfig): number {
  const cOp = clamp((n2 - cfg.idleN2) / (cfg.takeoffN2 - cfg.idleN2), 0, 1);
  const cRun = smootherstep(0.05, cfg.idleN2, n2);
  return 1 + cRun * (lerp(cfg.idleOverallPressureRatio, cfg.overallPressureRatioMax, Math.pow(cOp, 1.25)) - 1);
}

/** Surge line: operating line lifted by the steady surge-margin schedule. */
function surgeOpr(n2: number, cfg: EngineConfig): number {
  const cOp = clamp((n2 - cfg.idleN2) / (cfg.takeoffN2 - cfg.idleN2), 0, 1);
  const cRun = smootherstep(0.05, cfg.idleN2, n2);
  const marginPct = 30 - 9 * cOp + 2 * (1 - cRun);
  return steadyOpr(n2, cfg) * (1 + marginPct / 100);
}

interface MapSample {
  n2: number;
  opr: number;
  surgeMargin: number;
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
      const trail = trailRef.current;
      trail.push({
        n2: state.spool.n2,
        opr: state.engine.overallPressureRatio,
        surgeMargin: state.surgeMargin,
      });
      while (trail.length > TRAIL_MAX) trail.shift();
      setVersion((v) => v + 1);
    }, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, []);

  // Static curve geometry — computed once (config never changes at runtime).
  const { surgeRegion, surgeLine, opLine } = useMemo(() => {
    const surgePts: string[] = [];
    const opPts: string[] = [];
    for (let n2 = N2_MIN; n2 <= N2_MAX + 1e-9; n2 += 0.0125) {
      opPts.push(`${xMap(n2).toFixed(1)},${yMap(steadyOpr(n2, cfg)).toFixed(1)}`);
      // Stop the surge line where it exits the top of the plot (yMap clamps).
      if (surgePts.length === 0 || !surgePts[surgePts.length - 1].endsWith(`,${MT.toFixed(1)}`)) {
        surgePts.push(`${xMap(n2).toFixed(1)},${yMap(surgeOpr(n2, cfg)).toFixed(1)}`);
      }
    }
    return {
      surgeLine: surgePts.join(' '),
      // Close the shaded region above the line via the top-left corner.
      surgeRegion: `${surgePts.join(' ')} ${ML},${MT}`,
      opLine: opPts.join(' '),
    };
  }, [cfg]);

  const trail = trailRef.current;
  const live = trail.length > 0 ? trail[trail.length - 1] : null;
  const onMap = live !== null && live.n2 >= N2_MIN;
  const dotState = live === null ? '' : live.surgeMargin < 5 ? ' is-crit' : live.surgeMargin < 15 ? ' is-warn' : '';
  const smState = live === null ? '' : live.surgeMargin < 5 ? ' sm-crit' : live.surgeMargin < 15 ? ' sm-warn' : '';

  const xTicks = [0.5, 0.7, 0.9, 1.1];
  const yTicks = [10, 20, 30, 40];

  return (
    <div className="cm">
      <div className={`cm-readout${smState}`}>
        <span>
          N2 <b>{live ? (live.n2 * 100).toFixed(1) : '--'}%</b>
        </span>
        <span>
          OPR <b>{live ? live.opr.toFixed(1) : '--'}</b>
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

        {/* surge region + line */}
        <polygon points={surgeRegion} className="cm-surge-region" />
        <polyline points={surgeLine} className="cm-surge-line" />
        <text x={ML + 10} y={MT + 14} className="cm-region-label">
          SURGE
        </text>

        {/* steady operating line */}
        <polyline points={opLine} className="cm-op-line" />
        <text x={xMap(0.93)} y={yMap(steadyOpr(0.93, cfg)) + 12} className="cm-op-label">
          OP LINE
        </text>

        {/* live trail (oldest faintest) + dot */}
        {onMap &&
          trail.map((s, i) =>
            s.n2 >= N2_MIN && i < trail.length - 1 ? (
              <circle
                key={i}
                cx={xMap(s.n2)}
                cy={yMap(s.opr)}
                r={1.6}
                className="cm-trail"
                opacity={0.08 + 0.5 * (i / trail.length)}
              />
            ) : null,
          )}
        {onMap && live && <circle cx={xMap(live.n2)} cy={yMap(live.opr)} r={3.2} className={`cm-dot${dotState}`} />}
        {!onMap && (
          <text x={ML + 10} y={MT + PH - 8} className="cm-offmap">
            SUB-IDLE — BELOW MAP RANGE
          </text>
        )}

        {/* axes (minimal) */}
        {xTicks.map((t) => (
          <text key={t} x={xMap(t)} y={MT + PH + 9} className="cm-tick cm-tick-x">
            {Math.round(t * 100)}
          </text>
        ))}
        {yTicks.map((t) => (
          <text key={t} x={ML - 3} y={yMap(t) + 2.5} className="cm-tick cm-tick-y">
            {t}
          </text>
        ))}
        <text x={ML + PW / 2} y={H - 2} className="cm-axis-label">
          N2 — % RATED (CORRECTED)
        </text>
        <text x={9} y={MT + PH / 2} className="cm-axis-label" transform={`rotate(-90 9 ${MT + PH / 2})`}>
          OPR
        </text>
      </svg>
      <div className="cm-caption">
        Live operating point vs the surge line (dot: amber &lt; 15 % margin, red &lt; 5 %). Slam the throttle and watch
        it step toward the line.
      </div>
    </div>
  );
}

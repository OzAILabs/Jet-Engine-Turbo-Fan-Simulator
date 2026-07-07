/**
 * TsDiagram — the LIVE Brayton cycle on a temperature–entropy plane.
 *
 * Plots the core gas path (stations 0 → 2 → 2.5 → 3 → 4 → 4.5 → 5 → 8) from
 * the sim's own per-station entropy/enthalpy (engineModel mk()), connected in
 * cycle order; the dashed 8 → 0 return is the constant-pressure heat
 * rejection that closes every open cycle in the atmosphere. Compression
 * marches up-left-ish (entropy creeps right of vertical — real compressors
 * aren't isentropic), heat addition sweeps far right, expansion falls back
 * down. Push the throttle and watch the whole loop GROW — enclosed area is
 * net work.
 *
 * Same 10 Hz sampling convention as CompressorMap (sub-60fps UI panels).
 */
import { useEffect, useRef, useState } from 'react';
import { useSimStore } from '../store/useSimStore';
import { temperatureColor } from '../util/colorScale';
import type { StationId } from '../sim/types';
import { clamp } from '../sim/units';

/** Core-path cycle order. */
const CYCLE: StationId[] = ['0', '2', '25', '3', '4', '45', '5', '8'];

/** Axis domain. */
const S_MIN = -150;
const S_MAX = 1500; // J/(kg·K)
const T_MIN = 150;
const T_MAX = 2000; // K

const SAMPLE_MS = 100;

const W = 240;
const H = 170;
const ML = 30;
const MR = 8;
const MT = 8;
const MB = 20;
const PW = W - ML - MR;
const PH = H - MT - MB;

const xMap = (s: number) => ML + ((clamp(s, S_MIN, S_MAX) - S_MIN) / (S_MAX - S_MIN)) * PW;
const yMap = (t: number) => MT + (1 - (clamp(t, T_MIN, T_MAX) - T_MIN) / (T_MAX - T_MIN)) * PH;

interface CyclePoint {
  id: StationId;
  s: number;
  t: number;
}

export function TsDiagram() {
  const [pts, setPts] = useState<CyclePoint[]>([]);
  const colorRef = useRef(new Map<StationId, string>());

  useEffect(() => {
    const id = window.setInterval(() => {
      const state = useSimStore.getState();
      if (state.paused) return;
      const { stations } = state.engine;
      const next = CYCLE.map((sid) => ({
        id: sid,
        s: stations[sid].entropy,
        t: stations[sid].temperature,
      }));
      const colors = colorRef.current;
      for (const sid of CYCLE) {
        colors.set(sid, `#${temperatureColor(stations[sid].temperature).getHexString()}`);
      }
      setPts(next);
    }, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, []);

  const path = pts.map((p) => `${xMap(p.s).toFixed(1)},${yMap(p.t).toFixed(1)}`).join(' ');

  const sTicks = [0, 400, 800, 1200];
  const tTicks = [500, 1000, 1500];

  return (
    <div className="cm">
      <svg className="cm-svg" viewBox={`0 0 ${W} ${H}`} aria-label="T-s diagram">
        <rect x={ML} y={MT} width={PW} height={PH} className="cm-frame" />
        {sTicks.map((t) => (
          <line key={t} x1={xMap(t)} y1={MT} x2={xMap(t)} y2={MT + PH} className="cm-grid" />
        ))}
        {tTicks.map((t) => (
          <line key={t} x1={ML} y1={yMap(t)} x2={ML + PW} y2={yMap(t)} className="cm-grid" />
        ))}

        {pts.length > 0 && (
          <>
            {/* The open cycle 0 → 8 … */}
            <polyline points={path} fill="none" className="cm-op-line" />
            {/* …closed by atmospheric heat rejection (8 → 0, dashed). */}
            <line
              x1={xMap(pts[pts.length - 1].s)}
              y1={yMap(pts[pts.length - 1].t)}
              x2={xMap(pts[0].s)}
              y2={yMap(pts[0].t)}
              className="cm-grid"
              strokeDasharray="4 3"
            />
            {pts.map((p) => (
              <g key={p.id}>
                <circle
                  cx={xMap(p.s)}
                  cy={yMap(p.t)}
                  r={2.6}
                  fill={colorRef.current.get(p.id) ?? '#fff'}
                  stroke="#0a0d12"
                  strokeWidth={0.6}
                />
                <text x={xMap(p.s) + 4} y={yMap(p.t) - 3} className="cm-tick">
                  {p.id}
                </text>
              </g>
            ))}
          </>
        )}

        {sTicks.map((t) => (
          <text key={t} x={xMap(t)} y={MT + PH + 9} className="cm-tick cm-tick-x">
            {t}
          </text>
        ))}
        {tTicks.map((t) => (
          <text key={t} x={ML - 3} y={yMap(t) + 2.5} className="cm-tick cm-tick-y">
            {t}
          </text>
        ))}
        <text x={ML + PW / 2} y={H - 2} className="cm-axis-label">
          ENTROPY s — J/(kg·K)
        </text>
        <text x={9} y={MT + PH / 2} className="cm-axis-label" transform={`rotate(-90 9 ${MT + PH / 2})`}>
          T — K
        </text>
      </svg>
      <div className="cm-caption">
        The live Brayton cycle: up = compression, right = heat addition, down = expansion. Enclosed
        area ≈ net work — push the throttle and watch the loop grow.
      </div>
    </div>
  );
}

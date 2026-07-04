/**
 * StartTrends — rolling 120 s strip chart of N1 [%], EGT [°C] and fuel flow
 * [kg/s]: the classic QAR/flight-test view of an engine start. One time axis
 * tells the whole story — the dry-motoring rise, the fuel-on step in FF, the
 * light-off EGT spike toward (ideally under) the 750 °C ground-start limit,
 * then the accel to a stable idle.
 *
 * Data flow (project convention for sub-60fps UI): a transient ~4 Hz interval
 * reads useSimStore.getState() into a ring buffer held in a ref, and the
 * component re-renders at the SAMPLE rate — never per sim tick, never rAF.
 *  • Recording pauses while the sim is paused: the trace freezes with no gap
 *    (the X axis is sim time accumulated only while running).
 *  • The buffer clears on the off → motoring runState transition (a NEW
 *    start), edge-detected via startSeq.lastTransition object identity, so
 *    t = 0 always reads as "start initiated". Autostart retries
 *    (aborting → motoring) intentionally do NOT clear — the trace keeps the
 *    aborted attempt visible, which is the teaching point.
 *
 * Y ranges are fixed for start-regime emphasis (values clamp at full scale):
 * N1 0–110 %, EGT 0–1000 °C, FF 0–1.2 kg/s (takeoff FF ~3.3 pegs — fine,
 * this chart is about starts).
 */
import { useEffect, useRef, useState } from 'react';
import { useSimStore } from '../store/useSimStore';
import { clamp } from '../sim/units';

/** Rolling window [s] and sample cadence [Hz]. */
const WINDOW_S = 120;
const SAMPLE_HZ = 4;
const SAMPLE_DT = 1 / SAMPLE_HZ;

/** Fixed Y full-scales (sub-idle/start emphasis). */
const N1_MAX = 110; // %
const EGT_MAX = 1000; // °C
const FF_MAX = 1.2; // kg/s

/** SVG plot geometry (viewBox units; CSS scales the SVG to panel width). */
const W = 190;
const H = 96;
const ML = 6;
const MR = 6;
const MT = 5;
const MB = 14;
const PW = W - ML - MR;
const PH = H - MT - MB;

interface TrendSample {
  /** Sim seconds since recording began (reset on each new start). */
  t: number;
  n1Pct: number;
  egtC: number;
  ffKgs: number;
}

/** Map one series of the buffer into an SVG polyline points string. */
function toPoints(
  buf: TrendSample[],
  tNow: number,
  pick: (s: TrendSample) => number,
  fullScale: number,
): string {
  const tLeft = tNow - WINDOW_S;
  let pts = '';
  for (const s of buf) {
    const x = ML + ((s.t - tLeft) / WINDOW_S) * PW;
    const y = MT + (1 - clamp(pick(s) / fullScale, 0, 1)) * PH;
    pts += `${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return pts;
}

export function StartTrends() {
  // Ring buffer + start clock live in refs; a version bump re-renders at 4 Hz.
  const bufRef = useRef<TrendSample[]>([]);
  const clockRef = useRef(0);
  const lastTransitionRef = useRef(useSimStore.getState().startSeq.lastTransition);
  const [, setVersion] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      const state = useSimStore.getState();

      // Edge-detect run-state transitions (each transition allocates a fresh
      // lastTransition object, so identity inequality IS the edge).
      const lt = state.startSeq.lastTransition;
      if (lt && lt !== lastTransitionRef.current) {
        lastTransitionRef.current = lt;
        if (lt.from === 'off' && lt.to === 'motoring') {
          // A NEW start: wipe history, restart the clock at t = 0.
          bufRef.current = [];
          clockRef.current = 0;
        }
      }

      // Record (and re-render) only while the sim is advancing.
      if (state.paused) return;

      clockRef.current += SAMPLE_DT;
      const t = clockRef.current;
      const { instruments } = state;
      const buf = bufRef.current;
      buf.push({ t, n1Pct: instruments.n1Pct, egtC: instruments.egtC, ffKgs: instruments.fuelFlowKgs });
      while (buf.length > 0 && buf[0].t < t - WINDOW_S) buf.shift();

      setVersion((v) => v + 1);
    }, 1000 / SAMPLE_HZ);
    return () => window.clearInterval(id);
  }, []);

  const buf = bufRef.current;
  const tNow = clockRef.current;
  const last = buf.length > 0 ? buf[buf.length - 1] : null;

  // 30 s gridlines anchored to the start clock (t = 0 at start initiation).
  const grid: number[] = [];
  for (let g = Math.max(0, Math.ceil((tNow - WINDOW_S) / 30) * 30); g <= tNow; g += 30) grid.push(g);

  return (
    <div className="trend">
      <div className="trend-body">
        <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} aria-label="Start trends strip chart">
          <rect x={ML} y={MT} width={PW} height={PH} className="trend-frame" />
          {grid.map((g) => {
            const x = ML + ((g - (tNow - WINDOW_S)) / WINDOW_S) * PW;
            return (
              <g key={g}>
                <line x1={x} y1={MT} x2={x} y2={MT + PH} className="trend-grid" />
                <text x={x} y={H - 4} className="trend-tick">
                  {g}s
                </text>
              </g>
            );
          })}
          <polyline className="trend-line trend-n1" points={toPoints(buf, tNow, (s) => s.n1Pct, N1_MAX)} />
          <polyline className="trend-line trend-egt" points={toPoints(buf, tNow, (s) => s.egtC, EGT_MAX)} />
          <polyline className="trend-line trend-ff" points={toPoints(buf, tNow, (s) => s.ffKgs, FF_MAX)} />
        </svg>

        {/* Right-edge legend with live values (latest sample). */}
        <div className="trend-legend">
          <div className="trend-key key-n1">
            <span className="trend-key-name">N1</span>
            <span className="trend-key-val">{last ? last.n1Pct.toFixed(1) : '--'}</span>
            <span className="trend-key-unit">%</span>
          </div>
          <div className="trend-key key-egt">
            <span className="trend-key-name">EGT</span>
            <span className="trend-key-val">{last ? last.egtC.toFixed(0) : '--'}</span>
            <span className="trend-key-unit">°C</span>
          </div>
          <div className="trend-key key-ff">
            <span className="trend-key-name">FF</span>
            <span className="trend-key-val">{last ? last.ffKgs.toFixed(2) : '--'}</span>
            <span className="trend-key-unit">kg/s</span>
          </div>
        </div>
      </div>
      <div className="trend-caption">120 s window · fixed scales: N1 0–110 % · EGT 0–1000 °C · FF 0–1.2 kg/s</div>
    </div>
  );
}

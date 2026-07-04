/**
 * EicasGauges — 777-style EICAS primary engine cluster: N1 / EGT / N2 arc
 * gauges plus compact FF and oil-pressure digital rows. Drop-in replacement
 * for the three bare <Dial> gauges that used to live inside StartPanel.
 *
 * Rendering is plain SVG. The component re-renders on every `instruments`
 * store update (the established per-tick cadence for cockpit panels), so the
 * needles track the sim at tick rate without an extra rAF loop.
 *
 * One reusable <ArcGauge> primitive provides, per gauge:
 *  • 240° scale arc (same sweep/geometry convention as the old Dial, so
 *    needle positions are identical), graduated with minor/major ticks and
 *    compact 777-style scale numerals (printed as value ÷ numeralDiv),
 *  • white needle + thin white value arc from scale start to the needle,
 *  • boxed digital readout in the dial's open sector (large tabular digits),
 *  • red radial at the limit, optional amber caution band before it,
 *  • optional magenta command bug (N1: EEC-commanded target vs. actual — the
 *    gap between bug and needle IS the spool lag during accels),
 *  • dashed white ground-start-limit radial (EGT). FCOM gating preserved
 *    exactly from StartPanel's old cluster: the line shows whenever the fuel
 *    control is in CUTOFF or the engine is not running; it disappearing is
 *    the "stabilized at idle" cue,
 *  • exceedance latching: while the value is above the effective limit the
 *    digits and needle turn red, and a thin red "max recorded" tick latches
 *    at the peak; the latch clears when startSeq.runState returns to 'off'
 *    (cold & dark reset).
 */
import { useRef } from 'react';
import { useSimStore } from '../store/useSimStore';

// --- Shared geometry (matches the old Dial's convention exactly) -----------
const SWEEP = 240; // degrees of arc
const START_ANGLE = 150; // 0-value needle angle (degrees, CSS rotate)
const CX = 44; // dial centre — pushed left so the readout box fits in the gap
const CY = 52;
const R = 36; // scale-arc radius

/** EGT plotted scale max [°C] — same top-of-scale the old Dial used. The red
 *  radial sits here; the amber 5-minute takeoff band runs from the takeoff
 *  limit (config.egtTakeoffLimitC) up to it. */
const EGT_SCALE_MAX_C = 1150;

/** Point at `angleDeg` (CSS-rotate convention: 0 = up, clockwise) on radius r. */
function polar(angleDeg: number, r: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function arcPath(fromDeg: number, toDeg: number, r: number): string {
  const [x0, y0] = polar(fromDeg, r);
  const [x1, y1] = polar(toDeg, r);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * Latch the highest value recorded above `limit`; cleared by `reset`.
 * The ref is updated during render, but both operations (max, reset) are
 * idempotent, so StrictMode's double render cannot corrupt the latch.
 */
function usePeakLatch(value: number, limit: number, reset: boolean): number | null {
  const peak = useRef<number | null>(null);
  if (reset) peak.current = null;
  else if (value > limit) peak.current = Math.max(peak.current ?? -Infinity, value);
  return peak.current;
}

// ---------------------------------------------------------------------------
// ArcGauge — the reusable 777-style dial primitive.
// ---------------------------------------------------------------------------
interface ArcGaugeProps {
  label: string;
  unit: string;
  value: number;
  /** Top of the plotted scale (needle clamps just past it, like the old Dial). */
  scaleMax: number;
  /** Major graduation step (gets a long tick + numeral). */
  majorStep: number;
  /** Minor graduation step (short tick). Must divide into majorStep cleanly. */
  minorStep: number;
  /** Scale numerals are printed as value ÷ numeralDiv (777-style compact). */
  numeralDiv: number;
  /** Decimal places in the boxed readout. */
  digits: number;
  /** Red limit radial. */
  redline: number;
  /** Amber caution band painted from here up to the redline. */
  amberFrom?: number;
  /** Dashed white radial (FCOM ground-start limit); null hides it. */
  startLimit?: number | null;
  /** Magenta command caret; null hides it. */
  commandBug?: number | null;
  /** Exceedance threshold for red digits/needle + peak latch (default: redline). */
  exceedLimit?: number;
  /** True clears the latched peak (cold & dark reset). */
  latchReset: boolean;
}

function ArcGauge(props: ArcGaugeProps) {
  const {
    label,
    unit,
    value,
    scaleMax,
    majorStep,
    minorStep,
    numeralDiv,
    digits,
    redline,
    amberFrom,
    startLimit = null,
    commandBug = null,
    latchReset,
  } = props;
  const exceedLimit = props.exceedLimit ?? redline;

  const safe = Number.isFinite(value) ? value : 0;
  // Same clamps as the old Dial: needle may push 8% past scale, radials 5%.
  const frac = Math.max(0, Math.min(1.08, safe / scaleMax));
  const needleAngle = START_ANGLE + frac * SWEEP;
  const angleOf = (v: number) => START_ANGLE + Math.max(0, Math.min(1.05, v / scaleMax)) * SWEEP;

  const exceed = safe > exceedLimit;
  const peak = usePeakLatch(safe, exceedLimit, latchReset);

  // Graduations. All our scales use integer steps, so % is exact.
  const majors: number[] = [];
  for (let v = 0; v <= scaleMax; v += majorStep) majors.push(v);
  const minors: number[] = [];
  for (let v = minorStep; v <= scaleMax; v += minorStep) {
    if (v % majorStep !== 0) minors.push(v);
  }

  return (
    <div className={`eic-gauge${exceed ? ' is-exceed' : ''}`}>
      <svg viewBox="0 0 116 98">
        {/* amber caution band, painted just outside the scale arc */}
        {amberFrom !== undefined && amberFrom < redline && (
          <path d={arcPath(angleOf(amberFrom), angleOf(redline), R + 3)} className="eic-amber" />
        )}
        {/* base scale arc */}
        <path d={arcPath(START_ANGLE, START_ANGLE + SWEEP, R)} className="eic-arc" />
        {/* graduations */}
        {minors.map((v) => {
          const a = angleOf(v);
          const [x0, y0] = polar(a, R - 3.2);
          const [x1, y1] = polar(a, R);
          return <line key={`mi${v}`} x1={x0} y1={y0} x2={x1} y2={y1} className="eic-tick" />;
        })}
        {majors.map((v) => {
          const a = angleOf(v);
          const [x0, y0] = polar(a, R - 5.5);
          const [x1, y1] = polar(a, R);
          return <line key={`ma${v}`} x1={x0} y1={y0} x2={x1} y2={y1} className="eic-tick-major" />;
        })}
        {/* scale numerals (777 compact: tens for N1/N2, hundreds for EGT) */}
        {majors.map((v) => {
          const [x, y] = polar(angleOf(v), R - 11);
          return (
            <text
              key={`nu${v}`}
              x={x}
              y={y}
              className="eic-num"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {Math.round(v / numeralDiv)}
            </text>
          );
        })}
        {/* filled value arc: scale start → needle (777 style) */}
        {frac > 0.005 && <path d={arcPath(START_ANGLE, needleAngle, R)} className="eic-varc" />}
        {/* red limit radial */}
        <line
          x1={CX}
          y1={CY - (R - 6)}
          x2={CX}
          y2={CY - (R + 5)}
          className="eic-redline"
          transform={`rotate(${angleOf(redline)} ${CX} ${CY})`}
        />
        {/* dashed white start-limit radial (the famous disappearing line) */}
        {startLimit != null && (
          <line
            x1={CX}
            y1={CY - (R - 6)}
            x2={CX}
            y2={CY - (R + 5)}
            className="eic-startlimit"
            transform={`rotate(${angleOf(startLimit)} ${CX} ${CY})`}
          />
        )}
        {/* latched max-recorded exceedance tick */}
        {peak !== null && (
          <line
            x1={CX}
            y1={CY - (R - 5)}
            x2={CX}
            y2={CY - (R + 4)}
            className="eic-peak"
            transform={`rotate(${angleOf(peak)} ${CX} ${CY})`}
          />
        )}
        {/* magenta command bug (caret apex pointing in at the scale) */}
        {commandBug != null && (
          <path
            d={`M 0 ${-(R + 1.5)} L 3.6 ${-(R + 7.5)} L -3.6 ${-(R + 7.5)} Z`}
            className="eic-bug"
            transform={`translate(${CX} ${CY}) rotate(${angleOf(commandBug)})`}
          />
        )}
        {/* needle + hub */}
        <line
          x1={CX}
          y1={CY}
          x2={CX}
          y2={CY - (R - 3)}
          className="eic-needle"
          transform={`rotate(${needleAngle} ${CX} ${CY})`}
        />
        <circle cx={CX} cy={CY} r={3} className="eic-hub" />
        {/* boxed digital readout, sitting in the dial's open sector */}
        <rect x={54} y={42} width={58} height={20} rx={3} className="eic-lcd-box" />
        <text x={108} y={52} className="eic-lcd" textAnchor="end" dominantBaseline="central">
          {Number.isFinite(value) ? value.toFixed(digits) : '--'}
        </text>
      </svg>
      <div className="eic-label">
        {label} <span className="eic-unit">{unit}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EicasGauges — the cluster: N1 / EGT / N2 dials + FF / OIL / attempt strip.
// ---------------------------------------------------------------------------
export function EicasGauges() {
  // Narrow reactive slices. `instruments` is rebuilt every sim tick, which is
  // the established re-render cadence for cockpit panels (see StartPanel).
  const instruments = useSimStore((s) => s.instruments);
  const cfg = useSimStore((s) => s.config);
  const targetN1 = useSimStore((s) => s.engine.targetN1);
  const runState = useSimStore((s) => s.startSeq.runState);
  const attempt = useSimStore((s) => s.startSeq.attempt);
  const fuelControl = useSimStore((s) => s.fuelControl);

  const running = runState === 'running';
  // FCOM: the EGT start-limit line shows whenever fuel control is CUTOFF or
  // N2 is below idle; it disappears once the engine stabilizes at idle.
  // (Gating preserved verbatim from StartPanel's old Dial cluster.)
  const showStartLimit = fuelControl === 'CUTOFF' || !running;
  // Exceedance latches clear on the cold & dark reset only.
  const latchReset = runState === 'off';

  const n1Redline = cfg.n1RedlineFrac * 100; // 110.5%
  const n2Redline = cfg.n2RedlineFrac * 100; // 121%
  // EGT exceedance keys off the same effective FCOM limit the old Dial used:
  // the 750 °C ground-start limit while its line is displayed, the 1090 °C
  // takeoff limit otherwise. (The painted red radial sits at the top of the
  // plotted scale, past the amber 5-minute takeoff band.)
  const egtExceedLimit = showStartLimit ? cfg.egtStartLimitGroundC : cfg.egtTakeoffLimitC;

  // Same oil-pressure caution the old secondary row used.
  const oilWarn = instruments.oilPressurePsi < 10 && instruments.n2Pct > 10;

  return (
    <div className="eic-cluster">
      <div className="eic-dials">
        <ArcGauge
          label="N1"
          unit="%"
          value={instruments.n1Pct}
          scaleMax={n1Redline}
          majorStep={20}
          minorStep={10}
          numeralDiv={10}
          digits={1}
          redline={n1Redline}
          // Command bug only while running: sub-idle the start sequence owns
          // the spools and a bug at the idle target over a dead engine would
          // read as a fault. Above idle, bug-vs-needle IS the spool lag.
          commandBug={running ? targetN1 * 100 : null}
          latchReset={latchReset}
        />
        <ArcGauge
          label="EGT"
          unit="°C"
          value={instruments.egtC}
          scaleMax={EGT_SCALE_MAX_C}
          majorStep={200}
          minorStep={100}
          numeralDiv={100}
          digits={0}
          redline={EGT_SCALE_MAX_C}
          amberFrom={cfg.egtTakeoffLimitC}
          startLimit={showStartLimit ? cfg.egtStartLimitGroundC : null}
          exceedLimit={egtExceedLimit}
          latchReset={latchReset}
        />
        <ArcGauge
          label="N2"
          unit="%"
          value={instruments.n2Pct}
          scaleMax={n2Redline}
          majorStep={20}
          minorStep={10}
          numeralDiv={10}
          digits={1}
          redline={n2Redline}
          latchReset={latchReset}
        />
      </div>

      {/* Secondary digital strip: FF / OIL PRESS / start attempt. */}
      <div className="eic-strip">
        <div className="eic-cell">
          <span className="eic-cell-label">FF</span>
          <span className="eic-lcd-sm">
            {(instruments.fuelFlowKgs * 3600).toFixed(0)}
            <span className="eic-unit-sm">kg/h</span>
          </span>
        </div>
        <div className="eic-cell">
          <span className="eic-cell-label">OIL PRESS</span>
          <span className={`eic-lcd-sm${oilWarn ? ' is-warn' : ''}`}>
            {instruments.oilPressurePsi.toFixed(0)}
            <span className="eic-unit-sm">psi</span>
          </span>
        </div>
        <div className="eic-cell">
          <span className="eic-cell-label">START ATTEMPT</span>
          <span className="eic-lcd-sm is-dim">{attempt}/3</span>
        </div>
      </div>
    </div>
  );
}

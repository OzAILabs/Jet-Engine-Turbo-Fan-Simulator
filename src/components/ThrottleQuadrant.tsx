/**
 * ThrottleQuadrant — pedestal-style power controls in one vertical SVG stack.
 *
 *   FIRE HANDLE  (top)    — red T-handle. Pulling it latches the handle out,
 *                           lights the red ring, and chops fuel
 *                           (setFuelControl('CUTOFF')). Pushing it back in
 *                           only unlatches the handle — fuel stays CUTOFF
 *                           until the operator selects RUN again, exactly
 *                           like the real recovery procedure.
 *   THRUST LEVER (middle) — drag the knob (or grab anywhere on the arc)
 *                           through the idle→forward-stop arc; pointer Y maps
 *                           linearly to inputs.throttle 0–100. Writes are
 *                           coalesced to one setThrottle per animation frame.
 *                           Keyboard: focus the lever, ArrowUp/ArrowDown ±5
 *                           (Home/End for the stops). Disabled — dimmed, no
 *                           pointer — unless startSeq.runState === 'running',
 *                           the same gating as the old range slider.
 *   FUEL CONTROL (bottom) — 777-style guarded switch. Click the guard flap to
 *                           lift it, then click the exposed switch to flip
 *                           RUN/CUTOFF (setFuelControl). The guard re-seats
 *                           after the move. This intentionally duplicates the
 *                           StartPanel fuel buttons: both write the same store
 *                           key, so the two UIs can never disagree.
 *
 * Perf: narrow reactive selectors only (throttle, booleanized running flag,
 * fuel position, commanded-N1 scalar). engine.targetN1 depends only on the
 * inputs, so its selector value is stable across sim ticks and this component
 * does NOT re-render 60×/s while the engine idles untouched.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useSimStore } from '../store/useSimStore';
import { clamp } from '../sim/units';

// ---------------------------------------------------------------------------
// Geometry (SVG user units; viewBox 0 0 140 260).
// ---------------------------------------------------------------------------
const VB_H = 260;
/** Lever pivot (bottom-right of the lever zone) and arm length. */
const PX = 112;
const PY = 178;
const ARM = 100;
/** Arm angle above the −x axis: 15° at the idle stop, 80° at the forward stop. */
const BETA_IDLE = 15;
const BETA_MAX = 80;

/** Handle-center position for a throttle setting (0–100). */
function leverXY(throttlePct: number): { x: number; y: number } {
  const beta = ((BETA_IDLE + ((BETA_MAX - BETA_IDLE) * throttlePct) / 100) * Math.PI) / 180;
  return { x: PX - ARM * Math.cos(beta), y: PY - ARM * Math.sin(beta) };
}

const IDLE_XY = leverXY(0); //  (15.4, 152.1) — throttle 0
const MAX_XY = leverXY(100); // (94.6,  79.5) — throttle 100

/** Arc path along the lever track from throttle t0 to t1 (t1 > t0). */
function arcPath(t0: number, t1: number): string {
  const a = leverXY(t0);
  const b = leverXY(t1);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${ARM} ${ARM} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

const TRACK_PATH = arcPath(0, 100);

/** Radial tick stubs just outside the track at 0/25/50/75/100 %. */
const TICKS = [0, 25, 50, 75, 100].map((t) => {
  const beta = ((BETA_IDLE + ((BETA_MAX - BETA_IDLE) * t) / 100) * Math.PI) / 180;
  return {
    t,
    x1: PX - (ARM + 3) * Math.cos(beta),
    y1: PY - (ARM + 3) * Math.sin(beta),
    x2: PX - (ARM + 9) * Math.cos(beta),
    y2: PY - (ARM + 9) * Math.sin(beta),
  };
});

export function ThrottleQuadrant() {
  // --- Narrow reactive slices (never the whole engine/spool objects). ------
  const throttle = useSimStore((s) => s.inputs.throttle);
  const engineRunning = useSimStore((s) => s.startSeq.runState === 'running');
  const fuelControl = useSimStore((s) => s.fuelControl);
  /** EEC-commanded N1 as % of rated — what the lever is asking for. */
  const n1CmdPct = useSimStore((s) => s.engine.targetN1 * 100);
  const setThrottle = useSimStore((s) => s.setThrottle);
  const setFuelControl = useSimStore((s) => s.setFuelControl);

  // --- Local hardware state (visual latches only — no sim contract). -------
  const [dragging, setDragging] = useState(false);
  const [guardLifted, setGuardLifted] = useState(false);
  const [firePulled, setFirePulled] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // --- rAF-coalesced throttle writes: at most one store update per frame. --
  const rafRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const queueThrottle = (v: number) => {
    pendingRef.current = v;
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (pendingRef.current !== null) {
        setThrottle(pendingRef.current);
        pendingRef.current = null;
      }
    });
  };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  /** Map a pointer's clientY to throttle 0–100 along the lever's travel. */
  const throttleFromClientY = (clientY: number): number => {
    const svg = svgRef.current;
    if (!svg) return throttle;
    const r = svg.getBoundingClientRect();
    const vy = ((clientY - r.top) / r.height) * VB_H;
    return clamp(((IDLE_XY.y - vy) / (IDLE_XY.y - MAX_XY.y)) * 100, 0, 100);
  };

  // --- Thrust lever: pointer drag (with capture) + keyboard. ---------------
  const onLeverPointerDown = (e: PointerEvent<SVGGElement>) => {
    if (!engineRunning) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus(); // arm the Arrow keys after a click, too
    setDragging(true);
    queueThrottle(throttleFromClientY(e.clientY));
  };
  const onLeverPointerMove = (e: PointerEvent<SVGGElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    queueThrottle(throttleFromClientY(e.clientY));
  };
  const onLeverPointerUp = (e: PointerEvent<SVGGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };
  const onLeverKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (!engineRunning) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      setThrottle(clamp(throttle + 5, 0, 100));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setThrottle(clamp(throttle - 5, 0, 100));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setThrottle(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setThrottle(100);
    }
  };

  // --- Fire handle: pull = fuel chop + latch out; push = unlatch only. -----
  const handleFirePull = () => {
    if (firePulled) {
      setFirePulled(false); // back in — fuel stays CUTOFF (operator must select RUN)
      return;
    }
    setFuelControl('CUTOFF');
    setFirePulled(true);
  };

  // --- Guarded fuel switch. -------------------------------------------------
  const handleGuardClick = () => setGuardLifted((g) => !g);
  const handleSwitchClick = () => {
    if (!guardLifted) return; // physically covered by the guard
    setFuelControl(fuelControl === 'RUN' ? 'CUTOFF' : 'RUN');
    setGuardLifted(false); // guard snaps back over the switch after the move
  };

  /** Enter/Space activation for the button-like SVG groups. */
  const activateOnKey = (fn: () => void) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };

  // Per-render lever geometry: handle position + knob kept ⟂ to the arm.
  const { x: hx, y: hy } = leverXY(throttle);
  const armAngle = (Math.atan2(hy - PY, hx - PX) * 180) / Math.PI;
  const knobAngle = armAngle + 90;

  return (
    <div className="field tq-field">
      <div className="field-head">
        <span className="field-label">Throttle{engineRunning ? '' : ' (engine off)'}</span>
        <span className="field-value">{throttle.toFixed(0)} %</span>
      </div>

      <svg ref={svgRef} className="tq-svg" viewBox="0 0 140 260">
        {/* ================= FIRE HANDLE ================================== */}
        <g
          className={`tq-fire${firePulled ? ' is-pulled' : ''}`}
          role="button"
          tabIndex={0}
          aria-pressed={firePulled}
          aria-label={firePulled ? 'Fire handle pulled — push back in' : 'Pull fire handle (cuts fuel)'}
          onClick={handleFirePull}
          onKeyDown={activateOnKey(handleFirePull)}
        >
          <title>
            {firePulled
              ? 'Push the fire handle back in (fuel stays CUTOFF until RUN is selected)'
              : 'Pull: fuel control to CUTOFF, handle latches out'}
          </title>
          <rect className="tq-fire-plate" x={34} y={5} width={72} height={44} rx={6} />
          <rect className="tq-fire-ring" x={37.5} y={8.5} width={65} height={37} rx={5} />
          <rect className="tq-fire-collar" x={52} y={36} width={36} height={9} rx={2} />
          <g className="tq-fire-grip-g">
            <rect className="tq-fire-stem" x={65.5} y={20} width={9} height={17} />
            <rect className="tq-fire-grip" x={45} y={12} width={50} height={12} rx={5.5} />
            <line className="tq-fire-grip-line" x1={58} y1={14.5} x2={58} y2={21.5} />
            <line className="tq-fire-grip-line" x1={70} y1={14.5} x2={70} y2={21.5} />
            <line className="tq-fire-grip-line" x1={82} y1={14.5} x2={82} y2={21.5} />
          </g>
        </g>
        <text className={`tq-fire-label${firePulled ? ' is-alert' : ''}`} x={70} y={58}>
          {firePulled ? 'FIRE HANDLE PULLED' : 'ENG FIRE'}
        </text>

        <line className="tq-divider" x1={10} y1={64} x2={130} y2={64} />

        {/* ================= THRUST LEVER ================================= */}
        {/* Commanded N1 (the EEC target for the current lever position). */}
        <g className={`tq-readout${engineRunning ? '' : ' is-off'}`}>
          <text className="tq-ro-label" x={6} y={78}>
            N1 CMD
          </text>
          <text className="tq-ro-value" x={6} y={91}>
            {engineRunning ? `${n1CmdPct.toFixed(1)}%` : '--'}
          </text>
        </g>

        <g
          className={`tq-lever${engineRunning ? '' : ' is-disabled'}${dragging ? ' is-dragging' : ''}`}
          role="slider"
          aria-label="Thrust lever"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(throttle)}
          aria-disabled={!engineRunning}
          tabIndex={engineRunning ? 0 : -1}
          onPointerDown={onLeverPointerDown}
          onPointerMove={onLeverPointerMove}
          onPointerUp={onLeverPointerUp}
          onPointerCancel={onLeverPointerUp}
          onLostPointerCapture={() => setDragging(false)}
          onKeyDown={onLeverKeyDown}
        >
          <title>Thrust lever — drag, or focus and use the Arrow keys (±5%)</title>
          {TICKS.map((tk) => (
            <line key={tk.t} className="tq-tick" x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} />
          ))}
          <path className="tq-arc" d={TRACK_PATH} />
          {throttle > 0.5 && <path className="tq-arc-fill" d={arcPath(0, throttle)} />}
          {/* Fat invisible stroke along the track = generous drag/click target. */}
          <path className="tq-hit-arc" d={TRACK_PATH} />
          <text className="tq-detent" x={6} y={181}>
            IDLE
          </text>
          <text className="tq-detent tq-detent-max" x={93} y={66}>
            MAX
          </text>
          <line className="tq-arm" x1={PX} y1={PY} x2={hx} y2={hy} />
          <line className="tq-arm-core" x1={PX} y1={PY} x2={hx} y2={hy} />
          <circle className="tq-pivot-boss" cx={PX} cy={PY} r={7} />
          <g transform={`translate(${hx.toFixed(2)} ${hy.toFixed(2)}) rotate(${knobAngle.toFixed(2)})`}>
            <rect className="tq-knob" x={-16} y={-7} width={32} height={14} rx={5} />
            <line className="tq-knob-ridge" x1={-7} y1={-3.5} x2={-7} y2={3.5} />
            <line className="tq-knob-ridge" x1={0} y1={-3.5} x2={0} y2={3.5} />
            <line className="tq-knob-ridge" x1={7} y1={-3.5} x2={7} y2={3.5} />
          </g>
        </g>

        <line className="tq-divider" x1={10} y1={191} x2={130} y2={191} />

        {/* ================= FUEL CONTROL (guarded) ======================= */}
        <text className="tq-sec-title" x={70} y={201}>
          FUEL CONTROL
        </text>

        <g
          className="tq-fuelswitch"
          role="switch"
          aria-checked={fuelControl === 'RUN'}
          aria-label="Fuel control (lift the guard first)"
          tabIndex={0}
          onClick={handleSwitchClick}
          onKeyDown={activateOnKey(handleSwitchClick)}
        >
          <title>
            {guardLifted
              ? `Flip to ${fuelControl === 'RUN' ? 'CUTOFF' : 'RUN'}`
              : 'Guarded — lift the guard first'}
          </title>
          <rect className="tq-fuel-track" x={57} y={206} width={26} height={46} rx={5} />
          <rect className="tq-fuel-slot" x={67} y={212} width={6} height={34} rx={3} />
          <g className={`tq-fuel-knob-g${fuelControl === 'CUTOFF' ? ' is-cutoff' : ''}`}>
            <circle className="tq-fuel-knob" cx={70} cy={216} r={7.5} />
            <circle className="tq-fuel-knob-dot" cx={70} cy={216} r={2.6} />
          </g>
        </g>

        <text className={`tq-fuel-legend${fuelControl === 'RUN' ? ' is-on-run' : ''}`} x={53} y={219}>
          RUN
        </text>
        <text className={`tq-fuel-legend${fuelControl === 'CUTOFF' ? ' is-on-cutoff' : ''}`} x={53} y={245}>
          CUTOFF
        </text>

        <rect className="tq-guard-hinge" x={84} y={222} width={7} height={13} rx={1.5} />
        <g
          className={`tq-guard${guardLifted ? ' is-lifted' : ''}`}
          role="button"
          tabIndex={0}
          aria-pressed={guardLifted}
          aria-label={guardLifted ? 'Close fuel switch guard' : 'Lift fuel switch guard'}
          onClick={handleGuardClick}
          onKeyDown={activateOnKey(handleGuardClick)}
        >
          <title>{guardLifted ? 'Close the guard' : 'Lift the guard to unlock the switch'}</title>
          <rect className="tq-guard-flap" x={55} y={204} width={31} height={50} rx={4} />
          <line className="tq-guard-ridge" x1={59} y1={219} x2={82} y2={219} />
          <line className="tq-guard-ridge" x1={59} y1={229} x2={82} y2={229} />
          <line className="tq-guard-ridge" x1={59} y1={239} x2={82} y2={239} />
        </g>
      </svg>

      {!engineRunning && (
        <div className="field-hint">Start the engine from the ENGINE START panel below.</div>
      )}
    </div>
  );
}

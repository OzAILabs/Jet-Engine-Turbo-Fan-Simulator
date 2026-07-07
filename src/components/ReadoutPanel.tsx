/**
 * ReadoutPanel
 *
 * A plain DOM panel (lives in the HTML overlay, NOT inside the 3D canvas) that
 * shows the live steady-state engine solution as a list of labelled readouts.
 *
 * It subscribes reactively to the four store slices it needs: the engine
 * solution, the live spool fractions, the live surge margin, and the static
 * config (used only to know the turbine-inlet redline). Each of these is a
 * narrow selector so unrelated UI changes (camera, view mode, etc.) never
 * re-render this panel.
 *
 * Every numeric readout is guarded against non-finite values (NaN / Infinity)
 * so a transient infeasible solution shows "--" instead of a broken number.
 */
import { useState } from 'react';
import { useSimStore } from '../store/useSimStore';
import {
  newtonsToKn,
  newtonsToLbf,
  kelvinToCelsius,
  paToKpa,
} from '../sim/units';

/**
 * Format a finite number with the given decimal places, or return "--" for any
 * value we can't sensibly display (NaN, +/-Infinity).
 */
function fmt(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '--';
}

/** A single readout row: label, value, and (optional) unit. */
function Readout(props: {
  label: string;
  value: string;
  unit?: string;
  warn?: boolean;
}) {
  return (
    <div className={props.warn ? 'readout is-warn' : 'readout'}>
      <span className="label">{props.label}</span>
      <span className="value">{props.value}</span>
      {props.unit !== undefined ? <span className="unit">{props.unit}</span> : null}
    </div>
  );
}

export function ReadoutPanel() {
  // Reactive subscriptions: only re-render when one of these slices changes.
  const engine = useSimStore((s) => s.engine);
  const instruments = useSimStore((s) => s.instruments);
  const surgeMargin = useSimStore((s) => s.surgeMargin);
  const redline = useSimStore((s) => s.config.turbineInletTempRedline);
  const egtTakeoffLimitC = useSimStore((s) => s.config.egtTakeoffLimitC);

  // Live-formula section visibility (local UI state).
  const [showMath, setShowMath] = useState(false);

  // Pre-compute the warn flags once (keeps the JSX readable).
  const turbineHot = engine.turbineInletTemp > redline;
  const egtHot = instruments.egtC > egtTakeoffLimitC;
  const surgeLow = surgeMargin < 12;

  return (
    <div className="panel">
      {/* Primary flight-deck values (N1/EGT/N2/FF/oil) now live on the EICAS
          gauges; this panel is the full numeric engineering breakdown. */}
      <div className="panel-title">Engineering Data</div>

      <div className="readouts">
        {/* --- Thrust ----------------------------------------------------- */}
        <Readout label="Net thrust" value={fmt(newtonsToKn(engine.netThrust), 0)} unit="kN" />
        <Readout label="Net thrust" value={fmt(newtonsToLbf(engine.netThrust), 0)} unit="lbf" />

        {/* --- Spool speeds (% of rated speed and physical RPM, as EICAS) - */}
        <Readout label="N1 (fan)" value={fmt(instruments.n1Pct, 1)} unit="%" />
        <Readout label="N2 (core)" value={fmt(instruments.n2Pct, 1)} unit="%" />
        <Readout label="N1 RPM" value={fmt(instruments.n1Rpm, 0)} unit="rpm" />
        <Readout label="N2 RPM" value={fmt(instruments.n2Rpm, 0)} unit="rpm" />

        {/* --- Mass flow ------------------------------------------------- */}
        <Readout label="Core mass flow" value={fmt(engine.coreMassFlow, 1)} unit="kg/s" />
        <Readout label="Bypass mass flow" value={fmt(engine.bypassMassFlow, 1)} unit="kg/s" />
        <Readout label="Total mass flow" value={fmt(engine.totalMassFlow, 1)} unit="kg/s" />

        {/* --- Fuel ------------------------------------------------------ */}
        <Readout label="Fuel flow" value={fmt(instruments.fuelFlowKgs, 2)} unit="kg/s" />
        <Readout label="Fuel flow" value={fmt(instruments.fuelFlowKgs * 3600, 0)} unit="kg/h" />

        {/* --- Pressure ratios ------------------------------------------ */}
        <Readout label="Bypass ratio" value={fmt(engine.bypassRatio, 2)} unit="" />
        <Readout label="Overall pressure ratio" value={fmt(engine.overallPressureRatio, 1)} unit="" />

        {/* --- Compressor exit ------------------------------------------ */}
        <Readout
          label="Compressor exit pressure"
          value={fmt(paToKpa(engine.compressorExitPressure), 0)}
          unit="kPa"
        />
        <Readout label="Compressor exit temp" value={fmt(engine.compressorExitTemp, 0)} unit="K" />
        <Readout
          label="Compressor exit temp"
          value={fmt(kelvinToCelsius(engine.compressorExitTemp), 0)}
          unit="degC"
        />

        {/* --- Turbine / EGT (turbine inlet warns past redline) --------- */}
        <Readout
          label="Turbine inlet temp"
          value={fmt(engine.turbineInletTemp, 0)}
          unit="K"
          warn={turbineHot}
        />
        <Readout
          label="Turbine inlet temp"
          value={fmt(kelvinToCelsius(engine.turbineInletTemp), 0)}
          unit="degC"
          warn={turbineHot}
        />
        {/* EGT is the certified T49 (LPT inlet) the real EICAS displays. */}
        <Readout label="EGT (T49)" value={fmt(instruments.egtC, 0)} unit="degC" warn={egtHot} />
        {/* The blended temperature the HPT rotor actually sees after ~8% of
            core air (tapped at Tt3) film-cools the first stage. */}
        <Readout
          label="HPT rotor inlet (cooled)"
          value={fmt(engine.hptRotorInletTemp, 0)}
          unit="K"
        />
        <Readout label="Oil pressure" value={fmt(instruments.oilPressurePsi, 0)} unit="psi" />

        {/* --- Exhaust velocities ---------------------------------------- */}
        <Readout label="Core exhaust velocity" value={fmt(engine.coreExhaustVelocity, 0)} unit="m/s" />
        <Readout
          label="Bypass exhaust velocity"
          value={fmt(engine.bypassExhaustVelocity, 0)}
          unit="m/s"
        />

        {/* --- TSFC ------------------------------------------------------ */}
        {/* tsfc is kg/(N*s); * 1e6 -> g/(kN*s), * 35304 -> lb/(lbf*h). */}
        <Readout label="TSFC" value={fmt(engine.tsfc * 1e6, 1)} unit="g/(kN.s)" />
        <Readout label="TSFC" value={fmt(engine.tsfc * 35304, 3)} unit="lb/(lbf.h)" />

        {/* --- Surge margin (warns when low) ----------------------------- */}
        <Readout label="Surge margin" value={fmt(surgeMargin, 0)} unit="%" warn={surgeLow} />
      </div>

      {/* --- The math, live ---------------------------------------------
          The textbook equations with THIS moment's numbers substituted in —
          the bridge between the readouts above and the homework page. */}
      <div className="panel-section">
        <button className={`btn${showMath ? ' is-active' : ''}`} onClick={() => setShowMath((v) => !v)}>
          The math, live {showMath ? '▾' : '▸'}
        </button>
        {showMath && (
          <div className="rp-math">
            <code>
              F = ṁ_c(v_c−v₀) + ṁ_b(v_b−v₀)
              {'\n'}  = {fmt(engine.coreMassFlow, 0)}·({fmt(engine.coreExhaustVelocity, 0)}−
              {fmt(engine.flightVelocity, 0)}) + {fmt(engine.bypassMassFlow, 0)}·(
              {fmt(engine.bypassExhaustVelocity, 0)}−{fmt(engine.flightVelocity, 0)})
              {'\n'}  ≈ {fmt(newtonsToKn(engine.netThrust), 0)} kN
            </code>
            <code>
              BPR = ṁ_b / ṁ_c = {fmt(engine.bypassMassFlow, 0)} / {fmt(engine.coreMassFlow, 0)} ={' '}
              {fmt(engine.bypassRatio, 2)}
            </code>
            <code>
              OPR = P_t3 / P_t2 = {fmt(paToKpa(engine.compressorExitPressure), 0)} /{' '}
              {fmt(paToKpa(engine.stations['2'].pressure), 0)} = {fmt(engine.overallPressureRatio, 1)}
            </code>
            <code>
              TSFC = ṁ_f / F = {fmt(instruments.fuelFlowKgs * 1000, 1)} g/s /{' '}
              {fmt(newtonsToKn(engine.netThrust), 0)} kN = {fmt(engine.tsfc * 1e6, 1)} g/(kN·s)
            </code>
            <div className="rp-math-note">
              Thrust terms are shown pre-calibration-scale; the sim applies one global thrust
              calibration constant so the settled SLS/100% point hits the certified 513.9 kN.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const spool = useSimStore((s) => s.spool);
  const surgeMargin = useSimStore((s) => s.surgeMargin);
  const redline = useSimStore((s) => s.config.turbineInletTempRedline);
  const lpRedlineRpm = useSimStore((s) => s.config.lpSpoolRedlineRpm);
  const hpRedlineRpm = useSimStore((s) => s.config.hpSpoolRedlineRpm);

  // Pre-compute the warn flags once (keeps the JSX readable).
  const turbineHot = engine.turbineInletTemp > redline;
  const surgeLow = surgeMargin < 25;

  return (
    <div className="panel">
      <div className="panel-title">Live Readouts</div>

      <div className="readouts">
        {/* --- Thrust ----------------------------------------------------- */}
        <Readout label="Net thrust" value={fmt(newtonsToKn(engine.netThrust), 0)} unit="kN" />
        <Readout label="Net thrust" value={fmt(newtonsToLbf(engine.netThrust), 0)} unit="lbf" />

        {/* --- Spool speeds (normalized % and actual RPM) ---------------- */}
        <Readout label="Fan / N1" value={fmt(spool.n1 * 100, 1)} unit="%" />
        <Readout label="N2 (HP spool)" value={fmt(spool.n2 * 100, 1)} unit="%" />
        <Readout label="N1 (LP) RPM" value={fmt(spool.n1 * lpRedlineRpm, 0)} unit="rpm" />
        <Readout label="N2 (HP) RPM" value={fmt(spool.n2 * hpRedlineRpm, 0)} unit="rpm" />

        {/* --- Mass flow ------------------------------------------------- */}
        <Readout label="Core mass flow" value={fmt(engine.coreMassFlow, 1)} unit="kg/s" />
        <Readout label="Bypass mass flow" value={fmt(engine.bypassMassFlow, 1)} unit="kg/s" />
        <Readout label="Total mass flow" value={fmt(engine.totalMassFlow, 1)} unit="kg/s" />

        {/* --- Fuel ------------------------------------------------------ */}
        <Readout label="Fuel flow" value={fmt(engine.fuelFlow, 2)} unit="kg/s" />
        <Readout label="Fuel flow" value={fmt(engine.fuelFlow * 3600, 0)} unit="kg/h" />

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
        <Readout label="EGT" value={fmt(engine.exhaustGasTemp, 0)} unit="K" />
        <Readout label="EGT" value={fmt(kelvinToCelsius(engine.exhaustGasTemp), 0)} unit="degC" />

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
    </div>
  );
}

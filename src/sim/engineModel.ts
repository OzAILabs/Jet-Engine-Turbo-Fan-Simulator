/**
 * Quasi-1D Brayton-cycle turbofan model — TRANSIENT formulation.
 *
 * The key idea (and what makes this a *simulation* rather than an instant
 * calculator): the gas-path thermodynamics are computed from the engine's slow
 * STATE VARIABLES — the spool speeds N1, N2 (rotational inertia) and the
 * hot-section temperature Tt4 (thermal inertia) — NOT directly from the
 * throttle lever. The throttle only sets *targets*; the store integrates the
 * states toward those targets over time (see spoolDynamics.ts). Because
 * pressure ratio and mass flow are functions of corrected spool speed, and the
 * spools have inertia, pressures/flows/thrust all rise and fall gradually as
 * the engine spools up and down — and temperatures lag even further behind
 * because of thermal inertia.
 *
 * Spool speeds are *fractions of 100% rated speed* exactly as a real EICAS
 * displays them (N1 100% = 2,355 rpm, N2 100% = 9,332 rpm on the GE90-115B;
 * redlines sit at 110.5% / 121.0% [TCDS]). Ground idle is N2 ≈ 66%, N1 ≈ 18%.
 *
 * Below idle the engine is NOT driven by this file — a start/shutdown sequence
 * (startSequence.ts) integrates the spools from a starter/combustion/drag
 * torque balance and owns the fuel schedule; this cycle is still evaluated at
 * whatever spool state results, so the 3D scene and station readouts stay live
 * through a start.
 *
 * `computeEngineState(inputs)` with no dynamic state returns the *equilibrium*
 * (fully settled) operating point for that throttle — used by the tests and the
 * "reset to takeoff/cruise" snaps. `computeEngineState(inputs, config, dyn)`
 * evaluates the cycle at a specific (transient) dynamic state.
 *
 * This is a calibrated educational model — physically-grounded trends, not CFD
 * and not manufacturer data.
 */
import {
  CP_AIR,
  CP_GAS,
  COMBUSTOR_EFFICIENCY,
  COMBUSTOR_PRESSURE_LOSS,
  COMPRESSOR_EFFICIENCY_HIGH,
  COMPRESSOR_EFFICIENCY_LOW,
  EPS,
  FAN_EFFICIENCY,
  GAMMA_AIR,
  GAMMA_GAS,
  ISA_SEA_LEVEL_PRESSURE,
  ISA_SEA_LEVEL_TEMP,
  NOZZLE_EFFICIENCY,
  R_AIR,
  TURBINE_EFFICIENCY,
} from './constants';
import { computeISA } from './atmosphere';
import {
  burn,
  compressStage,
  compressStages,
  expandNozzle,
  expandTurbine,
  type ThermoPoint,
} from './stageModel';
import { defaultEngineConfig } from '../data/defaultEngineConfig';
import { STATION_X } from '../data/engineLayout';
import type {
  EngineConfig,
  EngineInputs,
  EngineState,
  SpoolState,
  StagePoint,
  StationId,
  StationState,
  Warning,
} from './types';
import { clamp, lerp, smootherstep } from './units';

// --- Maps from spool speed to an operating fraction 0..1 (idle → takeoff) ---
/** Core operating fraction: 0 at HP idle, 1 at the takeoff N2. */
const coreOpFrac = (n2: number, c: EngineConfig) =>
  clamp((n2 - c.idleN2) / (c.takeoffN2 - c.idleN2), 0, 1);
/** Fan operating fraction: 0 at LP idle, 1 at the takeoff N1. */
const fanOpFrac = (n1: number, c: EngineConfig) =>
  clamp((n1 - c.idleN1) / (c.takeoffN1 - c.idleN1), 0, 1);
/** Smooth "is the core at/above idle" gate: 0 when shut down, 1 at/above idle. */
const coreRun = (n2: number, c: EngineConfig) => smootherstep(0.05, c.idleN2, n2);
/** Smooth "is the fan pumping" gate: 0 when stopped, 1 at/above idle. */
const fanRun = (n1: number, c: EngineConfig) => smootherstep(0.03, c.idleN1, n1);

/** Subsonic inlet total-pressure recovery (~0.98 typical). */
const inletPressureRecovery = (mach: number) => clamp(1 - 0.03 * mach * mach, 0.9, 1.0);

/** Compressor isentropic efficiency rises with operating point. */
const compressorEfficiency = (opFrac: number) =>
  lerp(COMPRESSOR_EFFICIENCY_LOW, COMPRESSOR_EFFICIENCY_HIGH, clamp(opFrac, 0, 1));

/**
 * Core (gas-generator) flow fraction vs corrected HP spool speed. A steep
 * power law through the idle anchor (~12.6% of design core flow at N2 66%)
 * with a gentle linear floor below ~25% N2 so the starter-driven motoring
 * regime pumps a small but non-zero core flow (real engines flow air during
 * dry cranking — that's what cools a hot start).
 * Shared with startSequence.ts so sub-idle EGT uses the same airflow.
 */
export function coreFlowFraction(n2c: number, config: EngineConfig): number {
  const x = Math.max(0, n2c / config.takeoffN2);
  const powerLaw = Math.pow(x, 4.2);
  const subIdleFloor = 0.1412 * n2c; // linear: ~3.5% of design flow at 25% N2
  return Math.max(powerLaw, subIdleFloor) * smootherstep(0.01, 0.06, n2c);
}

// ---------------------------------------------------------------------------
// Commanded spool speeds (the throttle's job). These are the *targets* the
// store integrates toward with inertia while the engine is RUNNING. The lever
// spans idle → takeoff; it does NOT start or stop the engine — that is the
// fuel control switch + start sequence's job (startSequence.ts), exactly as
// on the real flight deck.
// ---------------------------------------------------------------------------
export function commandedSpeeds(
  inputs: EngineInputs,
  config: EngineConfig = defaultEngineConfig,
): { targetN1: number; targetN2: number } {
  const tf = clamp(inputs.throttle / 100, 0, 1);
  const targetN2 = clamp(
    config.idleN2 + (config.takeoffN2 - config.idleN2) * Math.sqrt(tf),
    0,
    config.takeoffN2 + 0.02,
  );
  const targetN1 = clamp(
    config.idleN1 + (config.takeoffN1 - config.idleN1) * Math.pow(tf, 0.7),
    0,
    config.takeoffN1 + 0.02,
  );
  return { targetN1, targetN2 };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function axialVelocity(massFlow: number, pt: number, tt: number, area: number): number {
  const rho = pt / (R_AIR * Math.max(tt, EPS));
  return clamp(massFlow / Math.max(rho * area, EPS), 0, 1200);
}

const stationName: Record<StationId, string> = {
  '0': 'Freestream',
  '2': 'Fan Face / Inlet',
  '13': 'Bypass Duct (after fan)',
  '25': 'Booster (LPC) Exit',
  '3': 'HPC Exit / Combustor Inlet',
  '4': 'Combustor Exit / Turbine Inlet',
  '45': 'HPT Exit',
  '5': 'LPT Exit',
  '8': 'Core Nozzle Exit',
  '18': 'Bypass Nozzle Exit',
};

// ---------------------------------------------------------------------------
// Uncalibrated cycle, evaluated at a specific dynamic state (n1, n2, tt4).
// Thrust fields are raw; computeEngineState scales them.
//
// @param tt4Override  the lagged actual Tt4 [K], or null to use the steady value
//                     (equilibrium). The combustor never cools the gas, so the
//                     value is floored at the compressor-exit temperature.
// ---------------------------------------------------------------------------
function computeRaw(
  inputs: EngineInputs,
  config: EngineConfig,
  n1: number,
  n2: number,
  tt4Override: number | null,
): EngineState {
  const atmosphere = computeISA(inputs.altitudeFt, inputs.isaTempOffsetC);
  const mach = clamp(inputs.mach, 0, 0.85);
  const v0 = mach * atmosphere.speedOfSound;
  const { targetN1, targetN2 } = commandedSpeeds(inputs, config);

  // Operating fractions & run gates from the (lagged) spool speeds.
  const cOp = coreOpFrac(n2, config);
  const fOp = fanOpFrac(n1, config);
  const cRun = coreRun(n2, config);
  const fRun = fanRun(n1, config);

  // --- Inlet: freestream → fan face (station 0 → 2) ---
  const ramFactor = 1 + ((GAMMA_AIR - 1) / 2) * mach * mach;
  const tt0 = atmosphere.temperature * ramFactor;
  const pt0 = atmosphere.pressure * Math.pow(ramFactor, GAMMA_AIR / (GAMMA_AIR - 1));
  const pt2 = pt0 * inletPressureRecovery(mach);
  const tt2 = tt0;
  const fanFace: ThermoPoint = { t: tt2, p: pt2 };

  // --- Mass flows -----------------------------------------------------------
  // Each stream tracks its own spool, so the bypass ratio is a DERIVED result:
  //  • Bypass stream: fan-pumped capture flow, ρ·A·V scaled by fan speed.
  //  • Core stream: corrected-flow scaling W = W_design·frac(N2c)·δ/√θ — the
  //    textbook way a gas generator's flow tracks corrected speed and inlet
  //    conditions. This keeps the core flowing during a starter-driven crank
  //    (N2 turning, fan nearly stopped), which is what a real start looks like.
  const fanArea = Math.PI * (config.fanTipRadius ** 2 - config.fanHubRadius ** 2);
  const vCapture = Math.max(v0, 55 + 95 * fOp);
  const bypassMassFlow = clamp(
    atmosphere.density * fanArea * vCapture * (0.15 + 0.85 * fOp) * config.massFlowCalibration * fRun,
    0,
    config.maxMassFlow,
  );
  const theta2 = tt2 / ISA_SEA_LEVEL_TEMP;
  const delta2 = pt2 / ISA_SEA_LEVEL_PRESSURE;
  const n2Corrected = n2 / Math.sqrt(Math.max(theta2, EPS));
  const coreMassFlow = clamp(
    config.designCoreMassFlow * coreFlowFraction(n2Corrected, config) * (delta2 / Math.sqrt(Math.max(theta2, EPS))),
    0,
    config.designCoreMassFlow * 1.25,
  );
  const totalMassFlow = clamp(bypassMassFlow + coreMassFlow, 0, config.maxMassFlow);
  const bypassRatio = coreMassFlow > 0.5 ? bypassMassFlow / coreMassFlow : 0;

  // --- Pressure ratios (functions of spool operating fraction) ---
  const fanPR = 1 + fRun * (lerp(1.05, config.fanPressureRatioMax, Math.pow(fOp, 1.1)) - 1);
  const boosterPR = 1 + cRun * (lerp(1.05, config.boosterPressureRatioMax, Math.pow(cOp, 1.2)) - 1);
  // Real engines idle around OPR ~9, not ~1 — the idle anchor matters for
  // getting compressor-exit temperature (and therefore idle fuel flow) right.
  const opr =
    1 + cRun * (lerp(config.idleOverallPressureRatio, config.overallPressureRatioMax, Math.pow(cOp, 1.25)) - 1);
  const hpcPR = Math.max(1.01, opr / (fanPR * boosterPR));
  const compEff = compressorEfficiency(cOp);

  // --- Fan / booster / HPC ---
  const fanOut = compressStage(fanFace, fanPR, FAN_EFFICIENCY, GAMMA_AIR);
  const bypassDuct = fanOut;
  const booster = compressStages(fanOut, boosterPR, config.boosterStages, compEff, GAMMA_AIR, 'booster');
  const hpc = compressStages(booster.exit, hpcPR, config.hpcStages, compEff, GAMMA_AIR, 'hpc');
  const compressorExit = hpc.exit; // station 3

  // --- Combustor target temperature (Tt4) ---
  // Equilibrium Tt4 for the current spool: idle → takeoff over the operating
  // range, plus a hot-day correction; falls to the compressor-exit temperature
  // (no fuel) as the core shuts down.
  const tt4Running =
    config.idleTurbineInletTemp +
    Math.pow(cOp, 1.1) * (config.takeoffTurbineInletTemp - config.idleTurbineInletTemp) +
    inputs.isaTempOffsetC * 3;
  // Transient over-fuel: when the lever commands more N2 than the spool has yet
  // reached, the fuel controller dumps extra fuel to accelerate the spool, so
  // Tt4 spikes ABOVE its steady value before settling (the classic accel TIT
  // bump that can trip a temperature limit on an aggressive slam).
  const accelBump = Math.max(0, targetN2 - n2) * 700;
  const tt4Steady = Math.max(compressorExit.t, compressorExit.t + cRun * (tt4Running - compressorExit.t) + accelBump);
  // Actual Tt4 used in the cycle: the lagged state if given, else the steady value.
  const tt4Used = tt4Override != null && tt4Override > 0 ? Math.max(tt4Override, compressorExit.t) : tt4Steady;

  const combustion = burn(compressorExit, tt4Used, COMBUSTOR_PRESSURE_LOSS, COMBUSTOR_EFFICIENCY);
  const f = combustion.fuelAirRatio;
  const turbineInlet = combustion.exit; // station 4
  const gasMassFlow = coreMassFlow * (1 + f);
  const fuelFlow = f * coreMassFlow;

  // --- Spool work balance ---
  const fanWork = totalMassFlow * CP_AIR * (fanOut.t - tt2);
  const boosterWork = coreMassFlow * CP_AIR * (booster.exit.t - fanOut.t);
  const hpcWork = coreMassFlow * CP_AIR * (hpc.exit.t - booster.exit.t);

  const hpt = expandTurbine(turbineInlet, hpcWork, gasMassFlow, config.hptStages, TURBINE_EFFICIENCY, GAMMA_GAS, 'hpt');
  const lpt = expandTurbine(hpt.exit, fanWork + boosterWork, gasMassFlow, config.lptStages, TURBINE_EFFICIENCY, GAMMA_GAS, 'lpt');

  // --- Nozzles ---
  const coreNozzle = expandNozzle(lpt.exit, atmosphere.pressure, GAMMA_GAS, CP_GAS, NOZZLE_EFFICIENCY);
  const bypassNozzle = expandNozzle(bypassDuct, atmosphere.pressure, GAMMA_AIR, CP_AIR, NOZZLE_EFFICIENCY);

  // --- Thrust (raw / uncalibrated). Momentum thrust only (v1). ---
  const rawCoreThrust = coreMassFlow * ((1 + f) * coreNozzle.velocity - v0);
  const rawBypassThrust = bypassMassFlow * (bypassNozzle.velocity - v0);
  const rawNetThrust = rawCoreThrust + rawBypassThrust;

  // --- Displayed EGT (T49, LPT inlet) ---
  // The certified EGT plane sits between the turbines; thermocouples read a
  // cooled, mixed-out gas. We map the cycle's HPT-exit temperature through a
  // two-point calibration (idle/takeoff anchors) so the displayed value matches
  // published GE90-115B behavior (~440 °C idle, ~1,045 °C takeoff vs the
  // 1,090 °C redline).
  const egtCal = egtCalibration(config);
  const egtC = egtCal.a * hpt.exit.t + egtCal.b - 273.15;

  // --- Stages list ---
  const stages: StagePoint[] = [
    { section: 'fan', index: 0, pIn: fanFace.p, pOut: fanOut.p, tIn: fanFace.t, tOut: fanOut.t, pressureRatio: fanPR },
    ...booster.stages,
    ...hpc.stages,
    ...hpt.stages,
    ...lpt.stages,
  ];

  // --- Stations ---
  const mk = (
    id: StationId,
    pressure: number,
    temperature: number,
    velocity: number,
    massFlow: number,
  ): StationState => ({ id, name: stationName[id], pressure, temperature, velocity, massFlow, x: STATION_X[id] });

  const A = config.stationAreas;
  const stations: Record<StationId, StationState> = {
    '0': mk('0', atmosphere.pressure, atmosphere.temperature, v0, totalMassFlow),
    '2': mk('2', pt2, tt2, axialVelocity(totalMassFlow, pt2, tt2, A['2']), totalMassFlow),
    '13': mk('13', bypassDuct.p, bypassDuct.t, axialVelocity(bypassMassFlow, bypassDuct.p, bypassDuct.t, A['13']), bypassMassFlow),
    '25': mk('25', booster.exit.p, booster.exit.t, axialVelocity(coreMassFlow, booster.exit.p, booster.exit.t, A['25']), coreMassFlow),
    '3': mk('3', compressorExit.p, compressorExit.t, axialVelocity(coreMassFlow, compressorExit.p, compressorExit.t, A['3']), coreMassFlow),
    '4': mk('4', turbineInlet.p, turbineInlet.t, axialVelocity(gasMassFlow, turbineInlet.p, turbineInlet.t, A['4']), gasMassFlow),
    '45': mk('45', hpt.exit.p, hpt.exit.t, axialVelocity(gasMassFlow, hpt.exit.p, hpt.exit.t, A['45']), gasMassFlow),
    '5': mk('5', lpt.exit.p, lpt.exit.t, axialVelocity(gasMassFlow, lpt.exit.p, lpt.exit.t, A['5']), gasMassFlow),
    '8': mk('8', atmosphere.pressure, coreNozzle.exitTemp, coreNozzle.velocity, gasMassFlow),
    '18': mk('18', atmosphere.pressure, bypassNozzle.exitTemp, bypassNozzle.velocity, bypassMassFlow),
  };

  // --- Diagnostics: surge margin ---
  // Real engines run ~20–30% surge margin on the operating line: highest at
  // idle, eroded toward high power, and eaten into during accel transients
  // (the store subtracts a transient penalty). The old "100% at idle" display
  // was fiction.
  const surgeMarginSteady = clamp(30 - 9 * cOp + 2 * (1 - cRun), 0, 100);

  const feasible = hpt.feasible && lpt.feasible;

  const warnings = buildWarnings({
    tt4: turbineInlet.t,
    redline: config.turbineInletTempRedline,
    egtC,
    egtTakeoffLimitC: config.egtTakeoffLimitC,
    egtMaxContinuousC: config.egtMaxContinuousC,
    surgeMargin: surgeMarginSteady,
    fuelAirRatio: f,
    feasible,
    netThrust: rawNetThrust,
    throttle: inputs.throttle,
    n2,
    idleN2: config.idleN2,
  });

  const tsfc = rawNetThrust > EPS ? fuelFlow / rawNetThrust : 0;

  return {
    inputs,
    atmosphere,
    flightVelocity: v0,
    totalMassFlow,
    coreMassFlow,
    bypassMassFlow,
    bypassRatio,
    fuelFlow,
    fuelAirRatio: f,
    fanPressureRatio: fanPR,
    boosterPressureRatio: boosterPR,
    hpcPressureRatio: hpcPR,
    overallPressureRatio: opr,
    compressorExitTemp: compressorExit.t,
    compressorExitPressure: compressorExit.p,
    turbineInletTemp: turbineInlet.t,
    hptExitTemp: hpt.exit.t,
    exhaustGasTemp: lpt.exit.t,
    egtC,
    coreExhaustVelocity: coreNozzle.velocity,
    bypassExhaustVelocity: bypassNozzle.velocity,
    coreNozzleChoked: coreNozzle.choked,
    bypassNozzleChoked: bypassNozzle.choked,
    coreThrust: rawCoreThrust,
    bypassThrust: rawBypassThrust,
    netThrust: rawNetThrust,
    tsfc,
    work: {
      fan: fanWork,
      booster: boosterWork,
      hpc: hpcWork,
      hpt: hpcWork,
      lpt: fanWork + boosterWork,
    },
    targetN1,
    targetN2,
    tt4Steady,
    surgeMarginSteady,
    feasible,
    stations,
    stages,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------
function buildWarnings(p: {
  tt4: number;
  redline: number;
  egtC: number;
  egtTakeoffLimitC: number;
  egtMaxContinuousC: number;
  surgeMargin: number;
  fuelAirRatio: number;
  feasible: boolean;
  netThrust: number;
  throttle: number;
  n2: number;
  idleN2: number;
}): Warning[] {
  const w: Warning[] = [];
  const running = p.n2 > p.idleN2 - 0.08;

  if (p.egtC > p.egtTakeoffLimitC) {
    w.push({ id: 'egt-redline', severity: 'critical', message: `EGT ${Math.round(p.egtC)} °C exceeds the ${p.egtTakeoffLimitC} °C takeoff limit` });
  } else if (running && p.egtC > p.egtMaxContinuousC) {
    w.push({ id: 'egt-mct', severity: 'caution', message: `EGT ${Math.round(p.egtC)} °C above the ${p.egtMaxContinuousC} °C max-continuous limit (5-min takeoff window)` });
  }

  if (p.tt4 > p.redline) {
    w.push({ id: 'tit-redline', severity: 'critical', message: `Turbine inlet temp ${Math.round(p.tt4)} K exceeds redline ${p.redline} K` });
  }

  if (running && p.surgeMargin < 7) {
    w.push({ id: 'surge-critical', severity: 'critical', message: `Compressor surge margin critically low (${Math.round(p.surgeMargin)}%)` });
  } else if (running && p.surgeMargin < 12) {
    w.push({ id: 'surge-low', severity: 'caution', message: `Compressor surge margin low (${Math.round(p.surgeMargin)}%)` });
  }

  if (!p.feasible) {
    w.push({ id: 'infeasible', severity: 'critical', message: 'Unrealistic operating point: turbine cannot supply demanded spool work' });
  }

  if (running && p.fuelAirRatio < 0.004 && p.throttle > 5) {
    w.push({ id: 'flameout', severity: 'caution', message: 'Flameout risk: fuel-air ratio too low to sustain stable combustion' });
  }

  return w;
}

// ---------------------------------------------------------------------------
// Equilibrium dynamic state — the fully-settled (n1, n2, Tt4) for a throttle.
// ---------------------------------------------------------------------------
export function equilibriumDynamics(
  inputs: EngineInputs,
  config: EngineConfig = defaultEngineConfig,
): SpoolState {
  const { targetN1, targetN2 } = commandedSpeeds(inputs, config);
  // Probe the settled Tt4 at these spools (no accel bump: target == current).
  const probe = computeRaw(inputs, config, targetN1, targetN2, null);
  return { n1: targetN1, n2: targetN2, lpAngle: 0, hpAngle: 0, tt4: probe.turbineInletTemp };
}

// ---------------------------------------------------------------------------
// Calibrations (memoized per config).
//  • Thrust: scale so settled SLS/100% produces exactly the rated thrust.
//  • EGT: linear map from the cycle's HPT-exit temperature to the displayed
//    T49 [K], anchored at idle (~713 K = 440 °C) and takeoff (~1318 K = 1045 °C).
// ---------------------------------------------------------------------------
const calibrationCache = new WeakMap<EngineConfig, number>();

export function thrustCalibration(config: EngineConfig): number {
  const cached = calibrationCache.get(config);
  if (cached !== undefined) return cached;
  const refInputs: EngineInputs = { throttle: 100, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };
  const eq = equilibriumDynamics(refInputs, config);
  const ref = computeRaw(refInputs, config, eq.n1, eq.n2, null);
  const k = ref.netThrust > EPS ? config.designThrust / ref.netThrust : 1;
  calibrationCache.set(config, k);
  return k;
}

/** Displayed-EGT anchors [°C]: gate idle and full takeoff. [EST video/margin data] */
const EGT_IDLE_ANCHOR_C = 440;
const EGT_TAKEOFF_ANCHOR_C = 1045; // ~45 °C margin to the 1,090 °C redline (newish engine)

const egtCalCache = new WeakMap<EngineConfig, { a: number; b: number }>();

export function egtCalibration(config: EngineConfig): { a: number; b: number } {
  const cached = egtCalCache.get(config);
  if (cached !== undefined) return cached;
  // Temporarily install an identity map so the probe evaluations don't recurse.
  egtCalCache.set(config, { a: 1, b: 0 });
  const probe = (throttle: number) => {
    const inputs: EngineInputs = { throttle, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };
    const eq = equilibriumDynamics(inputs, config);
    return computeRaw(inputs, config, eq.n1, eq.n2, null).hptExitTemp;
  };
  const t45Idle = probe(0);
  const t45Takeoff = probe(100);
  const yIdle = EGT_IDLE_ANCHOR_C + 273.15;
  const yTakeoff = EGT_TAKEOFF_ANCHOR_C + 273.15;
  const a = (yTakeoff - yIdle) / Math.max(t45Takeoff - t45Idle, EPS);
  const b = yIdle - a * t45Idle;
  const cal = { a, b };
  egtCalCache.set(config, cal);
  return cal;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
/**
 * Compute the engine condition.
 * @param dyn  optional live dynamic state. If omitted, the fully-settled
 *             (equilibrium) state for the throttle is used — this is the
 *             steady-state operating point used by tests and the reset presets.
 */
export function computeEngineState(
  inputs: EngineInputs,
  config: EngineConfig = defaultEngineConfig,
  dyn?: SpoolState,
): EngineState {
  const d = dyn ?? equilibriumDynamics(inputs, config);
  const state = computeRaw(inputs, config, d.n1, d.n2, dyn ? d.tt4 : null);
  const k = thrustCalibration(config);
  const coreThrust = state.coreThrust * k;
  const bypassThrust = state.bypassThrust * k;
  const netThrust = coreThrust + bypassThrust;
  const tsfc = netThrust > EPS ? state.fuelFlow / netThrust : 0;
  return { ...state, coreThrust, bypassThrust, netThrust, tsfc };
}

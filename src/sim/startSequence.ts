/**
 * Engine start / shutdown sequence — the sub-idle regime.
 *
 * Above idle the engine is governed by first-order spool lags toward
 * throttle-commanded targets (spoolDynamics.ts). BELOW idle that model is
 * meaningless: a real start is a torque balance on the HP spool —
 *
 *   J·dN2/dt = Q_starter + Q_turbine − Q_compressor/friction
 *
 * — sequenced by the EEC (FADEC): open the starter air valve, dry-motor the
 * core, introduce fuel + ignition at max motoring (~22% N2), detect light-off
 * by EGT rise, keep the starter engaged to ~63% N2 (GE90 cutout is near idle —
 * NOT the ~50% of other types), stabilize at ~66% N2 ground idle. Shutdown is
 * the same balance with everything off: the n² + Coulomb drag brings the core
 * to a stop in ~60–90 s while the huge fan windmills for minutes.
 *
 * Model structure follows the published "torque model" tier of sub-idle
 * simulation (Kurzke GPPS-TC-2022-0128; METU start-up thesis; Walsh & Fletcher
 * loss scalings): normalized speeds, starter torque falling linearly to a free
 * speed, drag = a·n² + c, combustion torque ∝ fuel flow × sub-idle combustion
 * efficiency. Timeline + limits calibrated to the 777/GE90 FCOM and the EASA
 * TCDS (750 °C ground-start EGT limit, ignition off 56% N2, valve closed
 * ~63% N2, idle 66% N2, ~60–90 s total). EEC-internal thresholds (hung-start
 * stagnation, retry motoring times) are proprietary — ours are reasoned
 * approximations of the FCOM-described behavior.
 */
import type { EngineConfig, EngineInputs, SpoolState } from './types';
import { coreFlowFraction } from './engineModel';
import { computeISA } from './atmosphere';
import { FUEL_LHV, CP_GAS } from './constants';
import { clamp, lerp, smootherstep } from './units';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EngineRunState =
  | 'off' // cold and dark (or windmilling in flight)
  | 'motoring' // starter air valve open, dry crank
  | 'fuelOn' // fuel valve open + ignition, waiting for light-off
  | 'lightoff' // flame established, EGT rising, starter still assisting
  | 'accel' // climbing through starter cutout toward idle
  | 'running' // at/above ground idle — spoolDynamics takes over
  | 'spooldown' // fuel cut, coasting down
  | 'aborting'; // EEC cut fuel after a fault; dry-motoring to clear/cool

export type StartFaultKind = 'hot' | 'hung' | 'noLight' | 'dutyCycle' | 'egtExceedance' | 'noBleed';

export interface StartFault {
  kind: StartFaultKind;
  message: string;
  /** Start-elapsed time when latched [s]. */
  at: number;
}

export interface StartControls {
  /** Overhead START/IGNITION selector. START latches; the EEC releases it. */
  startSelector: 'NORM' | 'START' | 'CON';
  /** Fuel control switch on the control stand. */
  fuelControl: 'RUN' | 'CUTOFF';
  /** Autostart armed (EEC sequences fuel/ignition and protects the start). */
  autostart: boolean;
  /** Bleed-air pressure available at the starter [psi] (APU ~38, min 25). */
  bleedPsi: number;
  /** Failure injection: igniters spark but nothing lights (training scenario). */
  igniterFailure?: boolean;
}

export interface StartSequenceState {
  runState: EngineRunState;
  starterEngaged: boolean;
  starterAirValveOpen: boolean;
  ignitionOn: boolean;
  /** EEC alternates A/B per ground start; BOTH for retries (and in-flight). */
  activeIgniter: 'A' | 'B' | 'BOTH';
  fuelValveOpen: boolean;
  /** Scheduled (EEC) fuel flow [kg/s] — the displayed FF below idle. */
  fuelFlow: number;
  /** Displayed EGT (T49) [°C], thermally lagged. Continuous with the cycle's egtC at idle. */
  egtC: number;
  oilPressurePsi: number;
  /** Flame established. */
  lit: boolean;
  /** Seconds since this start attempt began (selector to START). */
  startElapsed: number;
  timeSinceFuelOn: number;
  /** Autostart attempt number (1-based). The EEC tries up to 3 on the ground. */
  attempt: number;
  /** Cumulative starter-engaged seconds (duty-cycle limit 5 min). */
  starterOnTime: number;
  /** Remaining dry-motor seconds while aborting. */
  motorClearRemaining: number;
  fault: StartFault | null;
  /** EEC commands the latched START selector back to NORM. */
  selectorRelease: boolean;
  /** Last state transition, for audio/UI edge detection. */
  lastTransition: { from: EngineRunState; to: EngineRunState; at: number } | null;
  /** N2 stagnation timer for hung-start detection [s]. */
  stagnantTime: number;
  /** Previous tick's N2 acceleration [1/s] — max-motoring detection. */
  lastAccel: number;
}

// ---------------------------------------------------------------------------
// Calibration constants (normalized speeds: 1.0 = 100% rated N2).
// Torques are in "fraction of rated speed per second" with J = 1.
// ---------------------------------------------------------------------------

/** Air-turbine-starter stall torque at reference bleed pressure (38 psi). */
const STARTER_TORQUE = 0.019;
/** Starter free speed (geared) — torque falls linearly to zero here. */
const STARTER_FREE_SPEED = 0.72;
/** Reference / minimum bleed pressures [psi]. */
const BLEED_REF_PSI = 38;
export const BLEED_MIN_PSI = 25;

/** HP-spool drag: q = A·n² + C. The Coulomb term C makes rundown stop in finite time (~60–90 s from idle). */
const HP_DRAG_A = 0.1;
const HP_DRAG_C = 0.004;
/** LP-spool windmill drag — the 3-m fan coasts for minutes. */
const LP_DRAG_A = 0.02;
const LP_DRAG_C = 0.0008;

/** Combustion torque coefficient: q_turb = K_F · wf · η_b(n2). */
const K_F = 0.2;

/** EEC autostart schedule anchors (fraction of rated N2). */
const FUEL_ON_N2 = 0.22; // "max motoring" fuel introduction [FCOM ~22%]
const IGNITION_OFF_N2 = 0.56; // [FCOM]
const STARTER_CUTOUT_N2 = 0.63; // GE90: near idle [FCOM 62–64%]
const STABLE_IDLE_N2 = 0.655; // handoff to the running governor
export const STARTER_REENGAGE_MAX_N2 = 0.3; // never re-engage above 30% N2 [FCOM]

/** Light-off delay after fuel + ignition [s] (igniter-dependent, deterministic). */
const LIGHTOFF_DELAY: Record<'A' | 'B' | 'BOTH', number> = { A: 2.6, B: 1.9, BOTH: 1.4 };

/** Abort if no EGT rise (no light-off) within 20 s of fuel [FCOM]. */
const NO_LIGHT_TIMEOUT = 20;
/** EEC predictive hot-start abort threshold [°C] (just under the 750 limit). */
const AUTOSTART_HOT_ABORT_C = 740;
/** Hung start: lit, sub-idle, and N2 accel below this for HUNG_TIME seconds. */
const HUNG_ACCEL = 0.0004;
const HUNG_TIME = 6;
/** Starter duty cycle [s] (5 min ON) [FCOM]. */
const STARTER_DUTY_LIMIT = 300;
/** Dry-motor time after an aborted start to clear fuel / cool [s] [FCOM ~30 s]. */
const ABORT_MOTOR_TIME = 30;
const MAX_AUTOSTART_ATTEMPTS = 3;

const TWO_PI_OVER_60 = (2 * Math.PI) / 60;

// ---------------------------------------------------------------------------
// Sub-models
// ---------------------------------------------------------------------------

/** Starter torque: linear falloff from stall to free speed, scaled by bleed pressure. */
function starterTorque(n2: number, bleedPsi: number): number {
  const pressureScale = clamp((bleedPsi - 10) / (BLEED_REF_PSI - 10), 0, 1.15);
  return STARTER_TORQUE * pressureScale * Math.max(0, 1 - n2 / STARTER_FREE_SPEED);
}

/**
 * Sub-idle combustion-to-shaft effectiveness: how much of the fuel's heat the
 * turbine can turn into spool torque. Poor at very low N2 (the turbine is
 * barely a turbine at 12% speed), ~99% by idle (Walsh & Fletcher trend).
 */
function combustionEfficiency(n2: number, config: EngineConfig): number {
  return 0.12 + 0.87 * smootherstep(0.1, config.idleN2, n2);
}

/** EEC sub-idle fuel schedule [kg/s]: light-off flow, then enrich toward idle. */
function scheduledFuelTarget(seq: StartSequenceState, n2: number, config: EngineConfig): number {
  if (!seq.fuelValveOpen) return 0;
  if (!seq.lit) return 0.14; // pre-light metering (HMU minimum-flow stop)
  const base = lerp(0.19, config.idleFuelFlow, clamp((n2 - 0.25) / (config.idleN2 - 0.25), 0, 1));
  // Small governor enrichment near idle so the last few % N2 close out briskly.
  const trim = 0.02 * smootherstep(0.55, 0.62, n2) * clamp((config.idleN2 - n2) / 0.06, 0, 1);
  return Math.max(0.14, base + trim);
}

/**
 * Sub-idle displayed EGT target [K]: compressor-delivery temperature plus the
 * combustion temperature rise over the (small) core airflow. Low airflow at
 * low N2 is exactly why start EGT peaks (~550–630 °C here) well above idle EGT
 * — and why fuel too early (manual start) or weak bleed produces a hot start.
 * The 0.36·n2² delivery term is calibrated so the idle endpoint matches the
 * running cycle's displayed EGT (~440 °C) for a seamless handoff.
 */
function egtTargetK(seq: StartSequenceState, n2: number, ambientK: number, config: EngineConfig): number {
  const t3 = ambientK * (1 + 0.36 * n2 * n2);
  if (!seq.lit || seq.fuelFlow <= 0) return t3;
  const coreFlow = Math.max(config.designCoreMassFlow * coreFlowFraction(n2, config), 1.5);
  // Heat-release effectiveness at the EGT probes is HIGHER than the shaft
  // efficiency η_b: fuel the sub-idle combustor burns poorly still finishes
  // burning downstream, right where the thermocouples sit — which is exactly
  // why fuel introduced at too-low N2 (little airflow) spikes the gauge.
  const etaEgt = lerp(0.5, 0.99, smootherstep(FUEL_ON_N2, config.idleN2, n2));
  const deltaT = (seq.fuelFlow * etaEgt * FUEL_LHV) / (coreFlow * CP_GAS);
  return t3 + deltaT;
}

/** Oil pressure rises with N2 during the crank — the crew's first "it's alive" cue. */
function oilPressure(n2: number): number {
  return n2 < 0.005 ? 0 : 10 + 120 * Math.pow(n2, 1.3);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createOffSequence(ambientC = 15): StartSequenceState {
  return {
    runState: 'off',
    starterEngaged: false,
    starterAirValveOpen: false,
    ignitionOn: false,
    activeIgniter: 'A',
    fuelValveOpen: false,
    fuelFlow: 0,
    egtC: ambientC,
    oilPressurePsi: 0,
    lit: false,
    startElapsed: 0,
    timeSinceFuelOn: 0,
    attempt: 1,
    starterOnTime: 0,
    motorClearRemaining: 0,
    fault: null,
    selectorRelease: false,
    lastTransition: null,
    stagnantTime: 0,
    lastAccel: 0,
  };
}

/** A sequence already settled at RUNNING (for the takeoff/cruise snap presets). */
export function createRunningSequence(egtC: number): StartSequenceState {
  return { ...createOffSequence(), runState: 'running', egtC, oilPressurePsi: oilPressure(0.8), lit: true };
}

/** True whenever the torque-balance sequence (not spoolDynamics) owns the spools. */
export function isSequenceActive(runState: EngineRunState): boolean {
  return runState !== 'running';
}

// ---------------------------------------------------------------------------
// The integrator — one tick of the sub-idle world.
// ---------------------------------------------------------------------------

export interface StartAdvanceResult {
  seq: StartSequenceState;
  spool: SpoolState;
}

export function advanceStartSequence(
  prevSeq: StartSequenceState,
  prevSpool: SpoolState,
  controls: StartControls,
  inputs: EngineInputs,
  config: EngineConfig,
  dt: number,
): StartAdvanceResult {
  const seq: StartSequenceState = { ...prevSeq, selectorRelease: false };
  const atmosphere = computeISA(inputs.altitudeFt, inputs.isaTempOffsetC);
  const ambientK = atmosphere.temperature;
  const mach = clamp(inputs.mach, 0, 0.85);
  // Windmill floors: ram air keeps the spools turning in flight.
  const n1Windmill = 0.3 * mach;
  const n2Windmill = 0.14 * mach;

  const transition = (to: EngineRunState) => {
    if (seq.runState !== to) {
      seq.lastTransition = { from: seq.runState, to, at: seq.startElapsed };
      seq.runState = to;
    }
  };
  const latchFault = (kind: StartFaultKind, message: string) => {
    if (!seq.fault) seq.fault = { kind, message, at: seq.startElapsed };
  };

  seq.startElapsed += dt;
  if (seq.fuelValveOpen) seq.timeSinceFuelOn += dt;

  // --- Crew/EEC sequencing -------------------------------------------------
  const wantStart = controls.startSelector === 'START';
  const bleedOk = controls.bleedPsi >= BLEED_MIN_PSI;

  switch (seq.runState) {
    case 'off': {
      if (wantStart && prevSpool.n2 <= STARTER_REENGAGE_MAX_N2) {
        if (!bleedOk) {
          latchFault('noBleed', 'Insufficient starter air pressure (need ≥ 25 psi)');
          seq.selectorRelease = true;
        } else {
          // Fresh attempt: reset attempt-scoped trackers.
          seq.startElapsed = 0;
          seq.timeSinceFuelOn = 0;
          seq.lit = false;
          seq.fault = null;
          seq.starterEngaged = true;
          seq.starterAirValveOpen = true;
          transition('motoring');
        }
      }
      break;
    }

    case 'motoring': {
      if (!wantStart && seq.motorClearRemaining <= 0) {
        // Crew released the selector — abandon the crank.
        seq.starterEngaged = false;
        seq.starterAirValveOpen = false;
        transition(prevSpool.n2 > 0.02 ? 'spooldown' : 'off');
        break;
      }
      const fuelCommanded = controls.fuelControl === 'RUN';
      if (fuelCommanded) {
        // Autostart introduces fuel at ~22% N2 — or at max motoring if a weak
        // air supply can't crank that fast (N2 acceleration < ~1%/5 s). A
        // manual start obeys the switch IMMEDIATELY — selecting RUN too early
        // means low airflow and a hot start, exactly like the real procedure warns.
        const atMaxMotoring = seq.startElapsed > 15 && seq.lastAccel < 0.0002;
        if (!controls.autostart || prevSpool.n2 >= FUEL_ON_N2 || atMaxMotoring) {
          seq.fuelValveOpen = true;
          seq.ignitionOn = true;
          seq.timeSinceFuelOn = 0;
          transition('fuelOn');
        }
      }
      break;
    }

    case 'fuelOn': {
      if (controls.fuelControl === 'CUTOFF') {
        cutFuel(seq);
        transition('motoring');
        break;
      }
      if (!controls.igniterFailure && seq.timeSinceFuelOn >= LIGHTOFF_DELAY[seq.activeIgniter]) {
        seq.lit = true;
        transition('lightoff');
      } else if (seq.timeSinceFuelOn > NO_LIGHT_TIMEOUT) {
        latchFault('noLight', 'No light-off: no EGT rise within 20 s of fuel');
        beginAbort(seq, controls);
        transition('aborting');
      }
      break;
    }

    case 'lightoff':
    case 'accel': {
      if (controls.fuelControl === 'CUTOFF') {
        cutFuel(seq);
        seq.starterEngaged = false;
        seq.starterAirValveOpen = false;
        transition('spooldown');
        break;
      }
      if (seq.runState === 'lightoff' && prevSpool.n2 > 0.3) transition('accel');

      // EEC start protections (autostart). A manual start has no nanny:
      // exceeding the limit latches an exceedance for the maintenance log.
      const groundLimit = config.egtStartLimitGroundC;
      if (controls.autostart && seq.egtC > AUTOSTART_HOT_ABORT_C && prevSpool.n2 < STARTER_CUTOUT_N2) {
        latchFault('hot', `Hot start: EGT approaching the ${groundLimit} °C start limit — autostart aborted`);
        beginAbort(seq, controls);
        transition('aborting');
        break;
      }
      if (!controls.autostart && seq.egtC > groundLimit) {
        latchFault('egtExceedance', `EGT exceeded the ${groundLimit} °C ground-start limit — inspection required`);
      }

      // Hung start: lit but stagnating below idle.
      if (seq.stagnantTime > HUNG_TIME && prevSpool.n2 < 0.6) {
        latchFault('hung', 'Hung start: N2 stagnated below idle');
        if (controls.autostart) {
          beginAbort(seq, controls);
          transition('aborting');
          break;
        }
      }

      // Normal sequence milestones.
      if (seq.ignitionOn && prevSpool.n2 >= IGNITION_OFF_N2) seq.ignitionOn = false;
      if (seq.starterEngaged && prevSpool.n2 >= STARTER_CUTOUT_N2) {
        seq.starterEngaged = false;
        seq.starterAirValveOpen = false;
        seq.selectorRelease = true; // selector springs back to NORM
      }
      if (prevSpool.n2 >= STABLE_IDLE_N2) {
        seq.starterEngaged = false;
        seq.starterAirValveOpen = false;
        seq.selectorRelease = true;
        transition('running');
      }
      break;
    }

    case 'aborting': {
      seq.motorClearRemaining -= dt;
      if (seq.motorClearRemaining <= 0 || !bleedOk) {
        seq.starterEngaged = false;
        seq.starterAirValveOpen = false;
        const canRetry =
          controls.autostart &&
          controls.fuelControl === 'RUN' &&
          seq.fault &&
          (seq.fault.kind === 'hot' || seq.fault.kind === 'hung' || seq.fault.kind === 'noLight') &&
          seq.attempt < MAX_AUTOSTART_ATTEMPTS &&
          bleedOk;
        if (canRetry) {
          seq.attempt += 1;
          seq.activeIgniter = 'BOTH'; // retries always use both igniters [FCOM]
          seq.fault = null;
          seq.starterEngaged = true;
          seq.starterAirValveOpen = true;
          seq.timeSinceFuelOn = 0;
          transition('motoring');
        } else {
          seq.selectorRelease = true;
          transition(prevSpool.n2 > 0.02 ? 'spooldown' : 'off');
        }
      }
      break;
    }

    case 'spooldown': {
      if (prevSpool.n2 <= Math.max(0.02, n2Windmill + 0.005) && prevSpool.n1 <= Math.max(0.02, n1Windmill + 0.005)) {
        transition('off');
      }
      // A restart may begin once N2 is below the re-engagement limit.
      if (wantStart && bleedOk && prevSpool.n2 <= STARTER_REENGAGE_MAX_N2) {
        seq.startElapsed = 0;
        seq.lit = false;
        seq.fault = null;
        seq.starterEngaged = true;
        seq.starterAirValveOpen = true;
        transition('motoring');
      }
      break;
    }

    case 'running':
      // Handled by the store (spoolDynamics); we never integrate here.
      break;
  }

  // --- Starter duty cycle ----------------------------------------------------
  if (seq.starterEngaged) {
    seq.starterOnTime += dt;
    if (seq.starterOnTime > STARTER_DUTY_LIMIT) {
      latchFault('dutyCycle', 'Starter duty cycle exceeded (5 min) — let it cool 10 min');
      seq.starterEngaged = false;
      seq.starterAirValveOpen = false;
      seq.selectorRelease = true;
      cutFuel(seq);
      transition(prevSpool.n2 > 0.02 ? 'spooldown' : 'off');
    }
  } else {
    seq.starterOnTime = Math.max(0, seq.starterOnTime - dt * 0.5); // slow cool-down credit
  }

  // --- Fuel flow (EEC schedule, first-order valve/metering response) ---------
  const wfTarget = scheduledFuelTarget(seq, prevSpool.n2, config);
  const aWf = 1 - Math.exp(-dt / 1.2);
  seq.fuelFlow += (wfTarget - seq.fuelFlow) * aWf;
  if (!seq.fuelValveOpen && seq.fuelFlow < 0.005) seq.fuelFlow = 0;

  // --- HP-spool torque balance ----------------------------------------------
  const qStarter = seq.starterEngaged ? starterTorque(prevSpool.n2, controls.bleedPsi) : 0;
  const qTurbine = seq.lit ? K_F * seq.fuelFlow * combustionEfficiency(prevSpool.n2, config) : 0;
  const qDrag = HP_DRAG_A * prevSpool.n2 * prevSpool.n2 + (prevSpool.n2 > 0.001 ? HP_DRAG_C : 0);
  const dN2 = qStarter + qTurbine - qDrag;
  seq.lastAccel = dN2;
  let n2 = clamp(prevSpool.n2 + dN2 * dt, 0, 1.0);
  n2 = Math.max(n2, n2Windmill);

  // Hung-start stagnation tracking.
  if (seq.lit && n2 < 0.6 && dN2 < HUNG_ACCEL) seq.stagnantTime += dt;
  else seq.stagnantTime = 0;

  // --- LP spool: aerodynamically dragged along by core flow ------------------
  // During the crank the fan barely turns (Kurzke's example: N2 3.5% ⇒ N1 0.9%);
  // it only really wakes up once the core is pumping toward idle.
  const n1Eq =
    n2 > 0.25
      ? config.idleN1 * Math.pow((n2 - 0.25) / (config.idleN2 - 0.25), 1.5)
      : 0.004 * (n2 / 0.25);
  let n1: number;
  if (seq.lit || seq.starterEngaged) {
    const aN1 = 1 - Math.exp(-dt / 6); // slow aero coupling
    n1 = prevSpool.n1 + (Math.max(n1Eq, n1Windmill) - prevSpool.n1) * aN1;
  } else {
    // Free coast: tiny windage + bearing drag — minutes-long windmill.
    const dN1 = -(LP_DRAG_A * prevSpool.n1 * prevSpool.n1 + (prevSpool.n1 > 0.001 ? LP_DRAG_C : 0));
    n1 = Math.max(clamp(prevSpool.n1 + dN1 * dt, 0, 1), n1Windmill);
  }

  // --- Displayed EGT (thermal lag) -------------------------------------------
  const egtTarget = egtTargetK(seq, n2, ambientK, config);
  const tauEgt = seq.lit ? 1.5 : n2 > 0.1 ? 14 : 80; // ventilated vs heat-soaked cooling
  const aEgt = 1 - Math.exp(-dt / tauEgt);
  const egtK = seq.egtC + 273.15 + (egtTarget - (seq.egtC + 273.15)) * aEgt;
  seq.egtC = egtK - 273.15;

  seq.oilPressurePsi = oilPressure(n2);

  // --- Tt4 for the running cycle / combustor visuals -------------------------
  // Keep the hot-section state plausible so the 3D combustor glow and the
  // station readouts track the start: unlit = compressor-delivery temp, lit =
  // EGT plus a combustor-to-T49 offset that grows with fuel flow.
  const tt4Target = seq.lit ? egtTarget + 250 * clamp(seq.fuelFlow / config.idleFuelFlow, 0, 1) : egtTarget;
  const aTt4 = 1 - Math.exp(-dt / 2.5);
  const tt4 = prevSpool.tt4 + (tt4Target - prevSpool.tt4) * aTt4;

  const spool: SpoolState = {
    n1,
    n2,
    tt4,
    lpAngle: prevSpool.lpAngle + n1 * config.n1RatedRpm * TWO_PI_OVER_60 * dt,
    hpAngle: prevSpool.hpAngle + n2 * config.n2RatedRpm * TWO_PI_OVER_60 * dt,
  };

  return { seq, spool };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cutFuel(seq: StartSequenceState): void {
  seq.fuelValveOpen = false;
  seq.ignitionOn = false;
  seq.lit = false;
  seq.timeSinceFuelOn = 0;
}

function beginAbort(seq: StartSequenceState, controls: StartControls): void {
  cutFuel(seq);
  // Keep (or re-engage) the starter to motor fuel/heat out for ~30 s.
  seq.motorClearRemaining = ABORT_MOTOR_TIME;
  seq.starterEngaged = controls.bleedPsi >= BLEED_MIN_PSI;
  seq.starterAirValveOpen = seq.starterEngaged;
}

/**
 * Begin a shutdown from RUNNING (fuel control to CUTOFF): the store calls this
 * to hand the spools from spoolDynamics back to the sequence.
 */
export function beginShutdown(prevSeq: StartSequenceState): StartSequenceState {
  const seq: StartSequenceState = { ...prevSeq };
  cutFuel(seq);
  seq.starterEngaged = false;
  seq.starterAirValveOpen = false;
  seq.lastTransition = { from: seq.runState, to: 'spooldown', at: seq.startElapsed };
  seq.runState = 'spooldown';
  return seq;
}

/**
 * exhaustConstants — the shared physics anchors and the single per-frame drive
 * function both exhaust renderers read ("Realistic" ExhaustVolumetric and
 * "Dramatic" ExhaustShader). Centralizing this guarantees the two styles agree
 * on WHEN a plume exists (combustion only — a dry-motored engine pumps air but
 * shows nothing) and HOW HARD it is driven (rated thrust, takeoff jet
 * velocities, live EGT) instead of each file inventing its own magic numbers.
 */
import { useSimStore } from '../store/useSimStore';
import { clamp, smootherstep } from '../sim/units';

/** GE90-115B takeoff rating [N] (115,540 lbf) — full-power thrust normalization. */
export const THRUST_REF = 513900;
/** Core jet velocity near takeoff [m/s]. */
export const CORE_VEL_REF = 640;
/** Bypass jet velocity near takeoff [m/s]. */
export const BYPASS_VEL_REF = 300;

/** Sub-idle ramp anchors: fuel-on N2 (~22%) → ground idle N2 (66%). */
const SUBIDLE_N2_LO = 0.22;
const SUBIDLE_N2_HI = 0.66;
/** Light-off smoke puff: full strength hold, then linear decay [s]. */
const PUFF_HOLD_S = 2.0;
const PUFF_DECAY_S = 1.5;
/** Displayed-EGT anchors for the 0..1 heat tint (idle ≈ 440 °C → near the 1090 °C limit). */
const EGT_COOL_C = 300;
const EGT_HOT_C = 1000;
/** runFactor smoothing time constants [s]: quick bloom at light-off, short die-out at fuel chop. */
const RUN_RISE_TAU = 0.3;
const RUN_FALL_TAU = 0.35;

export interface PlumeDrive {
  /** Master gate 0..1: 0 with no flame (off/motoring/aborting/spooldown), ≈0.15 at light-off growing with N2 to idle, 1 when running. */
  runFactor: number;
  /** Net thrust / takeoff rating, 0..1 — the intensity shaper while running. */
  thrustFrac: number;
  /** Core jet velocity / takeoff reference (slight >1 headroom allowed). */
  coreVelN: number;
  /** Bypass jet velocity / takeoff reference. */
  bypassVelN: number;
  /** Displayed EGT mapped 0..1 across idle→takeoff — drives any warm tinting. */
  egtN: number;
  /** Flame established (startSeq.lit). */
  lit: boolean;
  /** Light-off smoke puff envelope: 1.0 for ~2 s after the flame catches, then fades to 0. */
  startPuff: number;
}

// Module-level trackers (shared by both renderers; only one mounts at a time).
let lastLitMs = Number.NEGATIVE_INFINITY; // performance.now() at the lit edge
let prevLit = false;
let smoothedRun = 0;
let lastDriveMs = 0;

/**
 * Read the live engine state (non-reactively) and reduce it to the handful of
 * normalized numbers an exhaust renderer needs. Call once per frame from
 * useFrame; cheap enough that an accidental double call costs nothing.
 */
export function plumeDrive(): PlumeDrive {
  const { startSeq, engine, spool, instruments } = useSimStore.getState();
  const { runState, lit } = startSeq;
  const now = performance.now();
  const dt = clamp((now - lastDriveMs) / 1000, 0, 0.1);
  lastDriveMs = now;

  // Light-off edge: only a REAL start (flame catching below idle) earns a
  // smoke puff — the snap-to-takeoff/cruise presets jump straight to 'running'.
  if (lit && !prevLit && (runState === 'fuelOn' || runState === 'lightoff' || runState === 'accel')) {
    lastLitMs = now;
  }
  prevLit = lit;

  // Puff envelope: real GE90 light-offs show a brief gray puff at the core
  // nozzle — hold ~2 s, then decay.
  const sinceLit = (now - lastLitMs) / 1000;
  const startPuff = sinceLit < PUFF_HOLD_S ? 1 : clamp(1 - (sinceLit - PUFF_HOLD_S) / PUFF_DECAY_S, 0, 1);

  // Master gate. No flame = no visible plume: off, dry motoring, an abort
  // motor-clear, or a post-cutoff spooldown all drive to zero. From light-off
  // the plume creeps in (≈0.15) and grows with N2 toward idle; at/above idle
  // the gate is fully open and thrustFrac carries the intensity.
  let rawRun = 0;
  switch (runState) {
    case 'running':
      rawRun = 1;
      break;
    case 'fuelOn':
    case 'lightoff':
    case 'accel':
      rawRun = lit ? 0.15 + 0.85 * smootherstep(SUBIDLE_N2_LO, SUBIDLE_N2_HI, spool.n2) : 0;
      break;
    default:
      rawRun = 0; // off | motoring | aborting | spooldown
  }
  // Short asymmetric smoothing so light-off blooms and a fuel chop snuffs the
  // flame without a single-frame pop; snaps to exactly 0 once negligible.
  smoothedRun += (rawRun - smoothedRun) * (1 - Math.exp(-dt / (rawRun > smoothedRun ? RUN_RISE_TAU : RUN_FALL_TAU)));
  if (rawRun === 0 && smoothedRun < 0.01) smoothedRun = 0;

  return {
    runFactor: smoothedRun,
    thrustFrac: clamp(engine.netThrust / THRUST_REF, 0, 1),
    coreVelN: clamp(engine.coreExhaustVelocity / CORE_VEL_REF, 0, 1.25),
    bypassVelN: clamp(engine.bypassExhaustVelocity / BYPASS_VEL_REF, 0, 1.25),
    // Heat tint from the DISPLAYED EGT — valid in both regimes, so the tint
    // tracks a hot start as faithfully as a takeoff run.
    egtN: clamp((instruments.egtC - EGT_COOL_C) / (EGT_HOT_C - EGT_COOL_C), 0, 1),
    lit,
    startPuff,
  };
}

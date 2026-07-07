/**
 * Time integration of the engine's slow dynamic states — the source of the
 * engine's transient "feel".
 *
 * Three first-order lags with physically-motivated time constants:
 *   - HP spool (N2): light, responds first.   τ ≈ 3 s
 *   - LP spool (N1): heavy (fan + 6-stage LPT), lags well behind N2.  τ ≈ 5.5 s
 *   - Hot-section temperature (Tt4): gas + metal heat capacity, lags behind
 *     even the spools.  τ ≈ 2.5 s
 *
 * A first-order lag is the textbook lumped model for both rotational inertia
 * (I·dω/dt = ΔTorque) and thermal inertia (m·c·dT/dt = ΔQ̇) when the driving
 * imbalance is roughly proportional to the error — which is why slamming the
 * throttle produces a slow spool-up and a temperature that trails the RPM.
 */
import type { EngineConfig, SpoolState } from './types';

/** Time constants [s] for the first-order responses. */
export const N1_TIME_CONSTANT = 5.5; // LP spool: heavy / slow
export const N2_TIME_CONSTANT = 3.0; // HP spool: lighter / faster
export const TT4_TIME_CONSTANT = 2.5; // hot-section thermal inertia

const TWO_PI_OVER_60 = (2 * Math.PI) / 60;

/**
 * Advance the live dynamic state by dt seconds toward the targets, using an
 * exact first-order step (unconditionally stable for any dt):
 *   x += (target − x)·(1 − e^(−dt/τ)).
 */
export function advanceSpools(
  prev: SpoolState,
  targetN1: number,
  targetN2: number,
  targetTt4: number,
  dt: number,
  config: EngineConfig,
): SpoolState {
  const a1 = 1 - Math.exp(-dt / N1_TIME_CONSTANT);
  const a2 = 1 - Math.exp(-dt / N2_TIME_CONSTANT);
  const aT = 1 - Math.exp(-dt / TT4_TIME_CONSTANT);

  const n1 = prev.n1 + (targetN1 - prev.n1) * a1;
  const n2 = prev.n2 + (targetN2 - prev.n2) * a2;
  const tt4 = prev.tt4 + (targetTt4 - prev.tt4) * aT;

  // Convert fraction-of-rated-speed into an angular increment for rendering.
  const lpOmega = n1 * config.n1RatedRpm * TWO_PI_OVER_60; // rad/s
  const hpOmega = n2 * config.n2RatedRpm * TWO_PI_OVER_60; // rad/s

  return {
    n1,
    n2,
    tt4,
    lpAngle: prev.lpAngle + lpOmega * dt,
    hpAngle: prev.hpAngle + hpOmega * dt,
  };
}

/**
 * Extra surge-margin penalty from an aggressive throttle transient. A fast push
 * (commanded N2 well above current N2) momentarily over-fuels the core and
 * pushes the operating point toward the surge line.
 */
export function transientSurgePenalty(targetN2: number, currentN2: number): number {
  const gap = targetN2 - currentN2; // positive when accelerating
  if (gap <= 0) return 0;
  // Scaled so a full idle→takeoff slam momentarily eats ~15–18 points of the
  // ~30% steady margin — uncomfortable but survivable, like the real thing.
  return Math.min(18, gap * 45);
}

// ---------------------------------------------------------------------------
// Torque-balance HP-spool dynamics (the physical alternative to the N2 lag).
//
// The real chain: lever → fuel schedule → turbine-inlet temperature → excess
// turbine work over compressor demand → net shaft torque → J·dω/dt. We model
// it with TEMPERATURE as the torque proxy — excess Tt4 over the value that
// merely HOLDS the current speed is proportional to surplus turbine specific
// work, i.e. net accelerating torque:
//
//   tt4Cmd  = tt4Req(N2) + G·(targetN2 − N2)      (the EEC fuel schedule:
//              over-fuels on accel, chops below the holding value on decel)
//   dTt4/dt = (tt4Cmd − tt4)/τ_T                   (combustor thermal lag)
//   dN2/dt  = (tt4 − tt4Req(N2)) / K               (rotor inertia)
//
// Equilibrium is IDENTICAL to the classic lag by construction: dN2 = 0 forces
// tt4 = tt4Req(N2) and N2 = targetN2 — the same steady points the cycle and
// all calibration anchors use. Linearized, the pair forms an overdamped
// second-order response (ζ ≈ 1.3 mid-range) with a ~10 s idle→takeoff time —
// and, unlike the lag, the spool visibly ACCELERATES (torque builds first,
// speed follows) and Tt4 leads N2 exactly as a real accel trace shows.
// ---------------------------------------------------------------------------

/** EEC fuel-schedule authority [K per unit N2 error] — same scale as the cycle's accel bump. */
export const FUEL_AUTHORITY_K = 1400;
/** HP rotor "thermal inertia" [K·s per unit dN2/dt]: K = τ_want · G. */
export const HP_TORQUE_GAIN = 1400;
/** Slew guard [1/s] — no physical spool changes speed faster than this. */
const MAX_N2_RATE = 0.15;

/**
 * Steady Tt4 required to HOLD a given N2 (no accel/decel bias) — mirrors the
 * cycle's tt4Running schedule in engineModel.ts computeRaw().
 */
export function tt4Required(n2: number, config: EngineConfig, isaTempOffsetC = 0): number {
  const cOp = Math.min(1, Math.max(0, (n2 - config.idleN2) / (config.takeoffN2 - config.idleN2)));
  return (
    config.idleTurbineInletTemp +
    Math.pow(cOp, 1.1) * (config.takeoffTurbineInletTemp - config.idleTurbineInletTemp) +
    isaTempOffsetC * 3
  );
}

/**
 * Advance the running-regime state with the torque-balance model. The LP
 * spool stays a first-order follower (it IS the heavy slow partner — its lag
 * behind the HP spool is the physics being taught), and Tt4 becomes a real
 * state in the loop rather than a display lag.
 */
export function advanceSpoolsTorque(
  prev: SpoolState,
  targetN1: number,
  targetN2: number,
  dt: number,
  config: EngineConfig,
  isaTempOffsetC = 0,
): SpoolState {
  // EEC fuel schedule → commanded TIT, floored at a flame-holding minimum and
  // capped just past redline (the EEC's own topping limiter).
  const req = tt4Required(prev.n2, config, isaTempOffsetC);
  const tt4Cmd = Math.min(
    Math.max(req + FUEL_AUTHORITY_K * (targetN2 - prev.n2), config.idleTurbineInletTemp * 0.9),
    config.turbineInletTempRedline + 40,
  );

  // Combustor/hot-section thermal lag (exact first-order step).
  const aT = 1 - Math.exp(-dt / TT4_TIME_CONSTANT);
  const tt4 = prev.tt4 + (tt4Cmd - prev.tt4) * aT;

  // Rotor: net torque ∝ temperature surplus over the speed-holding value.
  const dN2 = Math.max(-MAX_N2_RATE, Math.min(MAX_N2_RATE, (tt4 - req) / HP_TORQUE_GAIN)) * dt;
  // FADEC idle governor floor + redline-region ceiling.
  const n2 = Math.min(Math.max(prev.n2 + dN2, config.idleN2 * 0.985), config.takeoffN2 + 0.03);

  // LP spool: heavy first-order follower (unchanged physics story).
  const a1 = 1 - Math.exp(-dt / N1_TIME_CONSTANT);
  const n1 = prev.n1 + (targetN1 - prev.n1) * a1;

  const lpOmega = n1 * config.n1RatedRpm * TWO_PI_OVER_60;
  const hpOmega = n2 * config.n2RatedRpm * TWO_PI_OVER_60;

  return {
    n1,
    n2,
    tt4,
    lpAngle: prev.lpAngle + lpOmega * dt,
    hpAngle: prev.hpAngle + hpOmega * dt,
  };
}

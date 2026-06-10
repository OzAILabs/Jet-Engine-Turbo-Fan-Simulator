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

/**
 * FADEC-scheduled variable-geometry actuation — the single source of truth for
 * VSV (variable stator vane) and VBV (variable bleed valve) positions.
 *
 * On the real GE90 the EEC schedules both systems from corrected core speed.
 * Before this module existed, the 3D hardware (CompressorBleedSystems.tsx) and
 * the audio (engineAudio.ts) each faked their OWN N2 schedule — and disagreed
 * (the audio's VBV drone died at idle while the visual doors stayed partly open
 * to 85% N2). Everything now reads `store.actuation`, computed here once per
 * tick, so visuals, audio, and any future gauges always agree.
 *
 * Schedule anchors (fractions of rated N2; idle N2 = 0.66):
 *   VSV: fully CLOSED at/below idle, easing fully OPEN by takeoff N2 ≈ 1.08.
 *   VBV: fully OPEN at/below idle (booster air dumps into the fan duct during
 *        start — the famous GE90 sub-idle groan), closing over N2 0.66 → 0.85.
 */

export interface ActuationState {
  /** VSV position: 0 = vanes fully closed (sub-idle) … 1 = fully open (takeoff). */
  vsvOpenFrac: number;
  /** VBV position: 1 = doors fully open (sub-idle) … 0 = fully closed (climb power). */
  vbvOpenFrac: number;
}

/** N2 (fraction of rated) where the VSVs begin opening — the idle point. */
export const VSV_OPEN_START_N2 = 0.66;
/** N2 where the VSVs reach fully open — takeoff. */
export const VSV_OPEN_END_N2 = 1.08;
/** N2 where the VBV doors begin closing — the idle point. */
export const VBV_CLOSE_START_N2 = 0.66;
/** N2 where the VBV doors are fully closed. */
export const VBV_CLOSE_END_N2 = 0.85;

/** Commanded-decel gap (n2 − targetN2) where the VBV re-open begins. */
export const VBV_DECEL_DEADBAND = 0.03;
/** Gap beyond the deadband at which the decel re-open reaches fully open. */
export const VBV_DECEL_SPAN = 0.12;

/** Clamped smoothstep on [0,1]. */
const smooth01 = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * Compute the FADEC variable-geometry schedule.
 *
 * @param n2       Current core speed [fraction of rated].
 * @param targetN2 Commanded core speed (throttle target). During a rapid
 *   DECEL the core still spins fast while the command drops — the booster
 *   then delivers more air than the slowing core can swallow, so the real
 *   FADEC snaps the VBVs back open to dump it (booster-stall protection).
 *   We model that as a re-open proportional to the commanded decel gap,
 *   overlaid on the steady N2 schedule. Defaults to n2 (no decel bias) for
 *   the sub-idle regime, where the start sequence owns the spools.
 */
export function computeActuation(n2: number, targetN2: number = n2): ActuationState {
  const steadyOpen = 1 - smooth01((n2 - VBV_CLOSE_START_N2) / (VBV_CLOSE_END_N2 - VBV_CLOSE_START_N2));
  const decelOpen = smooth01((n2 - targetN2 - VBV_DECEL_DEADBAND) / VBV_DECEL_SPAN);
  return {
    vsvOpenFrac: smooth01((n2 - VSV_OPEN_START_N2) / (VSV_OPEN_END_N2 - VSV_OPEN_START_N2)),
    vbvOpenFrac: Math.max(steadyOpen, decelOpen),
  };
}

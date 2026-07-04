/**
 * rotorShared.ts — helpers shared by the rotating modules (Compressor.tsx,
 * Turbine.tsx). Extracted from the previously duplicated copies in those two
 * files so the tuning numbers can never drift apart.
 */

/** Sub-idle rotor rumble amplitude [m] (~1.5 mm — visible jiggle, not a bounce). */
export const RUMBLE_AMP = 0.0015;

/**
 * Irregular sub-idle rumble: a sum of incommensurate sines, active ONLY while
 * the HP spool is between barely-turning and ~50% — i.e. during start and
 * shutdown — and exactly zero at rest and at/above idle (idle N2 = 0.66).
 */
export function subIdleJitter(t: number, n2: number): number {
  if (n2 <= 0.001 || n2 >= 0.5) return 0;
  return (
    RUMBLE_AMP *
    (0.5 * Math.sin(37.0 * t) + 0.3 * Math.sin(61.3 * t + 1.7) + 0.2 * Math.sin(23.7 * t + 4.1))
  );
}

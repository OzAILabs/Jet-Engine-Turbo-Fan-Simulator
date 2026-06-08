/**
 * Unit conversions. Small, pure, and unit-tested.
 *
 * The whole simulation runs in SI internally; these helpers exist only at the
 * boundaries (UI inputs in ft, readouts in lbf / °C, etc.).
 */

// Length -------------------------------------------------------------------
export const FT_TO_M = 0.3048;
export const M_TO_FT = 1 / FT_TO_M;

export const feetToMeters = (ft: number): number => ft * FT_TO_M;
export const metersToFeet = (m: number): number => m * M_TO_FT;

// Force --------------------------------------------------------------------
/** 1 newton = 0.224808943 pound-force. */
export const N_TO_LBF = 0.224808943;
export const LBF_TO_N = 1 / N_TO_LBF;

export const newtonsToLbf = (n: number): number => n * N_TO_LBF;
export const lbfToNewtons = (lbf: number): number => lbf * LBF_TO_N;
export const newtonsToKn = (n: number): number => n / 1000;

// Temperature --------------------------------------------------------------
export const kelvinToCelsius = (k: number): number => k - 273.15;
export const celsiusToKelvin = (c: number): number => c + 273.15;

// Pressure -----------------------------------------------------------------
export const paToKpa = (pa: number): number => pa / 1000;
export const PA_TO_PSI = 0.000145037738;
export const paToPsi = (pa: number): number => pa * PA_TO_PSI;

// Mass flow ----------------------------------------------------------------
export const KGS_TO_LBMS = 2.20462262;
export const kgsToLbms = (kgs: number): number => kgs * KGS_TO_LBMS;

// Generic helpers ----------------------------------------------------------
export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

/** Linear interpolation, t expected in [0,1] but not clamped. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smootherstep (Ken Perlin) — eases 0→1 across [edge0,edge1] with zero 1st & 2nd derivatives at the ends. */
export const smootherstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Map x from [inMin,inMax] to [outMin,outMax]. */
export const mapRange = (
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number => {
  if (Math.abs(inMax - inMin) < 1e-12) return outMin;
  return outMin + ((x - inMin) * (outMax - outMin)) / (inMax - inMin);
};

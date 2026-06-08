/**
 * Thermodynamic building blocks for one pass through a turbofan.
 *
 * Each function models a single component (compressor stage, combustor,
 * turbine, nozzle) with a simplified but *traceable* equation. Nothing here is
 * random — given the same inputs you always get the same outputs, and every
 * formula maps to a line in a propulsion textbook.
 */
import {
  CP_GAS,
  EPS,
  FUEL_LHV,
  MECHANICAL_EFFICIENCY,
  TURBINE_BRACKET_FLOOR,
} from './constants';
import type { StageSection, StagePoint } from './types';
import { clamp } from './units';

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

export interface ThermoPoint {
  /** Total temperature [K]. */
  t: number;
  /** Total pressure [Pa]. */
  p: number;
}

/**
 * Compress through a single stage with a given stage pressure ratio.
 *
 *   T_out,ideal = T_in · PR^((γ-1)/γ)        (isentropic)
 *   T_out       = T_in + (T_out,ideal − T_in) / η   (real, η < 1 adds heat)
 *   P_out       = P_in · PR
 */
export function compressStage(
  inlet: ThermoPoint,
  stagePR: number,
  efficiency: number,
  gamma: number,
): ThermoPoint {
  const exponent = (gamma - 1) / gamma;
  const tOutIdeal = inlet.t * Math.pow(stagePR, exponent);
  const tOut = inlet.t + (tOutIdeal - inlet.t) / efficiency;
  return { t: tOut, p: inlet.p * stagePR };
}

/**
 * Compress through a multi-stage section, splitting the section pressure ratio
 * evenly across the stages (geometric mean per stage).
 */
export function compressStages(
  inlet: ThermoPoint,
  sectionPR: number,
  stageCount: number,
  efficiency: number,
  gamma: number,
  section: StageSection,
): { stages: StagePoint[]; exit: ThermoPoint } {
  const stagePR = Math.pow(sectionPR, 1 / stageCount);
  const stages: StagePoint[] = [];
  let current = inlet;
  for (let i = 0; i < stageCount; i++) {
    const next = compressStage(current, stagePR, efficiency, gamma);
    stages.push({
      section,
      index: i,
      pIn: current.p,
      pOut: next.p,
      tIn: current.t,
      tOut: next.t,
      pressureRatio: stagePR,
    });
    current = next;
  }
  return { stages, exit: current };
}

// ---------------------------------------------------------------------------
// Combustion
// ---------------------------------------------------------------------------

export interface BurnResult {
  exit: ThermoPoint;
  /** Fuel-to-air mass ratio. */
  fuelAirRatio: number;
}

/**
 * Burn fuel to raise the gas from the compressor-exit temperature (Tt3) to the
 * target turbine-inlet temperature (Tt4). The fuel-air ratio comes from an
 * energy balance across the combustor:
 *
 *   f = cp_gas·(Tt4 − Tt3) / (η_b·LHV − cp_gas·Tt4)
 *
 * A small total-pressure loss is applied (combustors are not free).
 */
export function burn(
  inlet: ThermoPoint,
  targetTt4: number,
  pressureLoss: number,
  combustorEfficiency: number,
): BurnResult {
  const tt3 = inlet.t;
  const tt4 = Math.max(targetTt4, tt3); // never "cool" the gas in the burner
  const denom = combustorEfficiency * FUEL_LHV - CP_GAS * tt4;
  let f = denom > EPS ? (CP_GAS * (tt4 - tt3)) / denom : 0;
  f = clamp(f, 0, 0.068); // 0 … near stoichiometric
  return {
    exit: { t: tt4, p: inlet.p * (1 - pressureLoss) },
    fuelAirRatio: f,
  };
}

// ---------------------------------------------------------------------------
// Turbine expansion
// ---------------------------------------------------------------------------

export interface TurbineResult {
  stages: StagePoint[];
  exit: ThermoPoint;
  /** False if the turbine was asked to extract more work than available. */
  feasible: boolean;
}

/**
 * Expand through a turbine that must deliver a required shaft work to a spool.
 *
 * The total temperature drop comes from a work balance (work = ṁ·cp·ΔT):
 *
 *   ΔT_total = W_required / (ṁ_gas · cp_gas · η_mech)
 *
 * The drop is spread evenly across stages. Each stage's pressure ratio is
 * recovered from its temperature drop using turbine efficiency:
 *
 *   ΔT = η_t · T_in · (1 − (1/PR)^((γ-1)/γ))
 *   ⇒  PR = (1 − ΔT/(η_t·T_in))^(−γ/(γ-1))
 *
 * If the bracket would go non-positive (impossible over-extraction), it is
 * clamped and `feasible` is set false so the caller can raise a warning.
 */
export function expandTurbine(
  inlet: ThermoPoint,
  requiredWork: number,
  gasMassFlow: number,
  stageCount: number,
  efficiency: number,
  gamma: number,
  section: StageSection,
): TurbineResult {
  const expEcap = gamma / (gamma - 1);
  const expEdrop = (gamma - 1) / gamma;
  const totalDeltaT =
    requiredWork / Math.max(gasMassFlow * CP_GAS * MECHANICAL_EFFICIENCY, EPS);
  const deltaTPerStage = totalDeltaT / stageCount;

  const stages: StagePoint[] = [];
  let current = inlet;
  let feasible = true;

  for (let i = 0; i < stageCount; i++) {
    const tOut = current.t - deltaTPerStage;
    let bracket = 1 - deltaTPerStage / Math.max(efficiency * current.t, EPS);
    if (bracket < TURBINE_BRACKET_FLOOR) {
      bracket = TURBINE_BRACKET_FLOOR;
      feasible = false;
    }
    const stagePR = Math.pow(bracket, -expEcap); // pIn/pOut
    const pOut = current.p / stagePR;
    stages.push({
      section,
      index: i,
      pIn: current.p,
      pOut,
      tIn: current.t,
      tOut,
      pressureRatio: stagePR,
    });
    current = { t: tOut, p: pOut };
  }

  // expEdrop is referenced so linting is happy and the relationship is documented.
  void expEdrop;
  return { stages, exit: current, feasible };
}

// ---------------------------------------------------------------------------
// Nozzle expansion
// ---------------------------------------------------------------------------

export interface NozzleResult {
  velocity: number;
  choked: boolean;
  exitTemp: number;
  nozzlePressureRatio: number;
}

/**
 * Expand a stream through a nozzle to ambient pressure and return the jet
 * velocity from the available enthalpy drop:
 *
 *   V_exit = sqrt( 2·η_n·cp·(Tt − T_exit) )
 *   T_exit = Tt·(P_amb/Pt)^((γ-1)/γ)      (fully-expanded, ideal)
 *
 * Choking is detected with the critical pressure ratio. For this educational
 * model we still use the fully-expanded enthalpy drop (pressure thrust is
 * omitted in v1), which slightly overestimates a choked jet — acceptable and
 * clearly labeled.
 */
export function expandNozzle(
  inlet: ThermoPoint,
  ambientPressure: number,
  gamma: number,
  cp: number,
  nozzleEfficiency: number,
): NozzleResult {
  const exponent = (gamma - 1) / gamma;
  const criticalPR = Math.pow((gamma + 1) / 2, gamma / (gamma - 1));
  const npr = inlet.p / Math.max(ambientPressure, EPS);
  const choked = npr > criticalPR;

  if (npr <= 1) {
    return { velocity: 0, choked: false, exitTemp: inlet.t, nozzlePressureRatio: npr };
  }

  const exitTempIdeal = inlet.t * Math.pow(ambientPressure / inlet.p, exponent);
  const deltaT = Math.max(0, inlet.t - exitTempIdeal);
  const velocity = Math.sqrt(2 * nozzleEfficiency * cp * deltaT);
  return { velocity, choked, exitTemp: exitTempIdeal, nozzlePressureRatio: npr };
}

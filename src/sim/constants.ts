/**
 * Physical constants and modeling coefficients for the turbofan cycle.
 *
 * These are textbook gas-turbine values. Everything is SI unless noted.
 * Keep this file boring and well-documented — students should be able to
 * read a constant here and trace exactly where it is used in the model.
 */

// ---------------------------------------------------------------------------
// Gas properties
// ---------------------------------------------------------------------------

/** Ratio of specific heats for cold air (inlet, fan, compressor). */
export const GAMMA_AIR = 1.4;
/** Ratio of specific heats for hot combustion gas (combustor → turbine → nozzle). */
export const GAMMA_GAS = 1.33;

/** Specific heat at constant pressure for air [J/(kg·K)]. */
export const CP_AIR = 1005;
/** Specific heat at constant pressure for combustion gas [J/(kg·K)]. */
export const CP_GAS = 1150;

/** Specific gas constant for dry air [J/(kg·K)]. */
export const R_AIR = 287.05;

/** Lower heating value of typical jet fuel (Jet-A) [J/kg]. */
export const FUEL_LHV = 43e6;

// ---------------------------------------------------------------------------
// Component efficiencies (isentropic unless noted)
// ---------------------------------------------------------------------------

export const COMBUSTOR_EFFICIENCY = 0.98;
export const MECHANICAL_EFFICIENCY = 0.99;
export const FAN_EFFICIENCY = 0.91;
/** Compressor isentropic efficiency at the high-power end of the range. */
export const COMPRESSOR_EFFICIENCY_HIGH = 0.9;
/** Compressor isentropic efficiency at the low-power (idle) end of the range. */
export const COMPRESSOR_EFFICIENCY_LOW = 0.86;
export const TURBINE_EFFICIENCY = 0.91;
export const NOZZLE_EFFICIENCY = 0.95;

/** Fractional total-pressure loss across the combustor (3%–6%). */
export const COMBUSTOR_PRESSURE_LOSS = 0.04;

// ---------------------------------------------------------------------------
// Atmosphere (ISA)
// ---------------------------------------------------------------------------

export const ISA_SEA_LEVEL_TEMP = 288.15; // K
export const ISA_SEA_LEVEL_PRESSURE = 101325; // Pa
export const ISA_SEA_LEVEL_DENSITY = 1.225; // kg/m^3
export const ISA_LAPSE_RATE = 0.0065; // K/m (troposphere)
export const ISA_TROPOPAUSE_ALT = 11000; // m
export const ISA_TROPOPAUSE_TEMP = 216.65; // K
export const GRAVITY = 9.80665; // m/s^2

// ---------------------------------------------------------------------------
// Numerical safety guards
// ---------------------------------------------------------------------------

/**
 * Minimum value allowed for the bracket (1 - ΔT/(η·Tt)) inside a turbine
 * pressure-ratio calculation. If a turbine is asked to extract more work than
 * the gas can supply, the bracket would go negative and produce NaN. Clamping
 * it keeps the model finite and lets us raise an "infeasible operating point"
 * warning instead of crashing.
 */
export const TURBINE_BRACKET_FLOOR = 0.05;

/** Smallest positive number we treat as "essentially zero" to avoid /0. */
export const EPS = 1e-9;

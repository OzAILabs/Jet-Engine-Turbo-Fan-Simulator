/**
 * Shared data contracts for the turbofan simulation.
 *
 * These types are the "interface" between the physics model, the Zustand store,
 * and the 3D / UI layers. Keeping them in one place means a component can read
 * an `EngineState` without ever importing the math.
 */

// ---------------------------------------------------------------------------
// User-facing inputs
// ---------------------------------------------------------------------------

export interface EngineInputs {
  /** Throttle lever, 0–100 %. */
  throttle: number;
  /** Altitude, 0–40 000 ft. */
  altitudeFt: number;
  /** Flight Mach number, 0–0.85. */
  mach: number;
  /** ISA temperature deviation, −20 °C … +20 °C. */
  isaTempOffsetC: number;
}

// ---------------------------------------------------------------------------
// Atmosphere
// ---------------------------------------------------------------------------

export interface Atmosphere {
  altitudeM: number;
  /** Static ambient temperature [K]. */
  temperature: number;
  /** Static ambient pressure [Pa]. */
  pressure: number;
  /** Static ambient density [kg/m^3]. */
  density: number;
  /** Speed of sound [m/s]. */
  speedOfSound: number;
}

// ---------------------------------------------------------------------------
// Stations (aerodynamic station numbering)
// ---------------------------------------------------------------------------

export type StationId =
  | '0' // freestream
  | '2' // fan face / inlet
  | '13' // bypass duct after fan
  | '25' // booster (LPC) exit
  | '3' // HPC exit / combustor inlet
  | '4' // combustor exit / turbine inlet
  | '45' // HPT exit
  | '5' // LPT exit
  | '8' // core nozzle exit
  | '18'; // bypass nozzle exit

export interface StationState {
  id: StationId;
  name: string;
  /** Total (stagnation) pressure [Pa]. For ambient/nozzle stations this is static. */
  pressure: number;
  /** Total (stagnation) temperature [K]. For ambient/nozzle stations this is static. */
  temperature: number;
  /** Representative flow velocity at the station [m/s]. */
  velocity: number;
  /** Mass flow through the station [kg/s]. */
  massFlow: number;
  /** X position of the station along the engine axis [scene units = m]. */
  x: number;
}

// ---------------------------------------------------------------------------
// Per-stage compressor / turbine data (for charts & visualization)
// ---------------------------------------------------------------------------

export type StageSection = 'fan' | 'booster' | 'hpc' | 'hpt' | 'lpt';

export interface StagePoint {
  section: StageSection;
  /** 0-based index within its section. */
  index: number;
  /** Total pressure entering the stage [Pa]. */
  pIn: number;
  /** Total pressure leaving the stage [Pa]. */
  pOut: number;
  /** Total temperature entering the stage [K]. */
  tIn: number;
  /** Total temperature leaving the stage [K]. */
  tOut: number;
  /** Pressure ratio of this single stage (pOut/pIn for compressors, pIn/pOut for turbines). */
  pressureRatio: number;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export type WarningSeverity = 'info' | 'caution' | 'critical';

export interface Warning {
  id: string;
  severity: WarningSeverity;
  message: string;
}

// ---------------------------------------------------------------------------
// Engine configuration (design constants)
// ---------------------------------------------------------------------------

export interface EngineConfig {
  name: string;

  // Stage counts
  fanStages: number;
  boosterStages: number;
  hpcStages: number;
  hptStages: number;
  lptStages: number;
  numFanBlades: number;

  // Geometry (meters)
  fanTipRadius: number;
  fanHubRadius: number;
  maxNacelleRadius: number;
  engineLength: number;

  // Design-point targets
  bypassRatioTakeoff: number;
  bypassRatioIdle: number;
  overallPressureRatioMax: number;
  fanPressureRatioMax: number;
  boosterPressureRatioMax: number;

  // Combustor / turbine temperatures (K)
  idleTurbineInletTemp: number;
  takeoffTurbineInletTemp: number;
  turbineInletTempRedline: number;

  // Displayed EGT (T49, LPT inlet) limits [°C] — certified values from the TCDS.
  egtTakeoffLimitC: number; // 5-minute takeoff limit
  egtMaxContinuousC: number;
  egtTransientLimitC: number; // 30-second transient
  egtStartLimitGroundC: number; // red start-limit line on the EICAS EGT dial
  egtStartLimitFlightC: number;

  // Mass flow (kg/s)
  designMassFlow: number;
  /** Core (gas-generator) mass flow at the takeoff operating point [kg/s]. */
  designCoreMassFlow: number;
  idleMassFlow: number;
  maxMassFlow: number;
  /** Dimensionless tuning factor so SL-static full-throttle lands near design. */
  massFlowCalibration: number;

  // Thrust calibration
  /** Target net thrust at sea-level static, 100% throttle [N]. */
  designThrust: number;

  // Spool speed definitions. n1/n2 state variables are *fractions of the 100%
  // rated speed* (so the displayed N1%/N2% read like a real EICAS); redline
  // sits ABOVE 1.0, exactly as certified.
  /** Physical rpm at 100% N1. */
  n1RatedRpm: number;
  /** Physical rpm at 100% N2. */
  n2RatedRpm: number;
  /** N1 redline as a fraction of rated speed (e.g. 1.105 = 110.5%). */
  n1RedlineFrac: number;
  /** N2 redline as a fraction of rated speed (e.g. 1.21 = 121.0%). */
  n2RedlineFrac: number;

  // Operating anchors (fractions of rated speed).
  /** Stable minimum ground idle. */
  idleN1: number;
  idleN2: number;
  /** Spool speeds commanded at 100% throttle, sea-level static. */
  takeoffN1: number;
  takeoffN2: number;

  // Idle pressure-ratio anchor (real engines idle around OPR ~8-10, not ~1).
  idleOverallPressureRatio: number;

  // Fuel-flow anchors [kg/s] used by the EEC start schedule + idle governor.
  idleFuelFlow: number;
  takeoffFuelFlow: number;

  // Representative annulus flow areas per station [m^2], for axial-velocity estimates.
  stationAreas: Record<StationId, number>;
}

// ---------------------------------------------------------------------------
// Full engine state (model output)
// ---------------------------------------------------------------------------

export interface EngineState {
  inputs: EngineInputs;
  atmosphere: Atmosphere;

  /** Flight speed [m/s]. */
  flightVelocity: number;

  // Mass flows
  totalMassFlow: number;
  coreMassFlow: number;
  bypassMassFlow: number;
  bypassRatio: number;
  fuelFlow: number; // kg/s
  fuelAirRatio: number;

  // Pressure ratios actually achieved
  fanPressureRatio: number;
  boosterPressureRatio: number;
  hpcPressureRatio: number;
  overallPressureRatio: number;

  // Key temperatures [K]
  compressorExitTemp: number; // Tt3
  compressorExitPressure: number; // Pt3
  turbineInletTemp: number; // Tt4
  hptExitTemp: number; // Tt45
  exhaustGasTemp: number; // Tt5 (LPT exit)
  /**
   * Displayed EGT [°C] at the certified measurement plane (T49, LPT inlet) —
   * the number a real EICAS shows and the one the TCDS limits apply to.
   * Derived from the cycle's HPT-exit temperature through a two-point
   * calibration (idle / takeoff anchors).
   */
  egtC: number;

  // Nozzle outputs
  coreExhaustVelocity: number;
  bypassExhaustVelocity: number;
  coreNozzleChoked: boolean;
  bypassNozzleChoked: boolean;

  // Thrust [N]
  coreThrust: number;
  bypassThrust: number;
  netThrust: number;
  /** Thrust-specific fuel consumption [kg/(N·s)]. */
  tsfc: number;

  /** Shaft work absorbed by each component [W] (turbine values = work delivered). */
  work: {
    fan: number;
    booster: number;
    hpc: number;
    hpt: number;
    lpt: number;
  };

  // Spool targets (fraction of rated speed; 1.0 = 100%). The store integrates
  // these with inertia. Only meaningful while the engine is RUNNING — during a
  // start/shutdown the sequence's torque balance owns the spools instead.
  targetN1: number;
  targetN2: number;
  /** Equilibrium turbine-inlet temperature the hot section is heading toward [K].
   *  The store integrates the actual Tt4 toward this with a thermal time constant. */
  tt4Steady: number;

  // Diagnostics
  /** Steady-state compressor surge margin, 0–100 %. The store may subtract a transient penalty. */
  surgeMarginSteady: number;
  feasible: boolean;

  // Detailed data
  stations: Record<StationId, StationState>;
  stages: StagePoint[];
  warnings: Warning[];
}

// ---------------------------------------------------------------------------
// Live (animated) engine state held in the store
// ---------------------------------------------------------------------------

/**
 * The live, time-integrated dynamic state of the engine. These are the "slow"
 * variables with inertia: spool speeds (rotational inertia) and the hot-section
 * temperature (thermal inertia). Everything else in EngineState is derived from
 * these each frame, which is what makes the engine respond gradually rather
 * than instantaneously.
 */
export interface SpoolState {
  /** Current LP spool speed as a fraction of 100% rated (redline ≈ 1.105). */
  n1: number;
  /** Current HP spool speed as a fraction of 100% rated (redline ≈ 1.21). */
  n2: number;
  /** Accumulated rotation angle of the LP spool [rad] (for rendering). */
  lpAngle: number;
  /** Accumulated rotation angle of the HP spool [rad] (for rendering). */
  hpAngle: number;
  /** Actual turbine-inlet temperature [K], lagged behind tt4Steady (thermal inertia). */
  tt4: number;
}

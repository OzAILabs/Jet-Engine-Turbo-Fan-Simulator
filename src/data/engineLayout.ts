/**
 * Engine spatial layout — the single source of truth for *where* things are.
 *
 * 1 scene unit = 1 meter. The engine runs left→right along +X. Y is up,
 * Z is lateral. Both the procedural geometry and the React components import
 * these numbers so the 3D model, the station markers, and the labels always
 * agree on positions.
 *
 * Values are GE90-115B-INSPIRED proportions, not manufacturer geometry.
 */
import type { StationId } from '../sim/types';

export const SCENE_SCALE = 1; // 1 unit == 1 meter

// --- Radii (meters) -------------------------------------------------------
export const RADII = {
  spinnerTip: 0.02,
  fanHub: 0.35,
  fanTip: 1.625, // ~3.25 m fan diameter
  nacelleInner: 1.645, // inner flow wall — just outside the fan tip (small clearance)
  // The cowl is substantially fatter than the fan (like the real engine), which
  // gives room for a thick, rounded inlet lip and a steady front-to-back taper.
  nacelleOuter: 1.85, // ~3.7 m max nacelle diameter
  /** Outer radius of the core casing at various axial locations. */
  // ~0.67 m (1.34 m dia) ≈ the real GE90 booster inlet, sized from BPR≈9: the
  // core swallows ~10% of the fan flow, giving a booster tip radius ~0.64 m with
  // a little casing clearance outside it.
  coreLpcOuter: 0.67,
  coreHpcOuter: 0.5,
  coreHpcExit: 0.42,
  combustorOuter: 0.55,
  hptOuter: 0.6,
  // The LP turbine flares into a pronounced rear cone (GE90 has 6 growing
  // stages); this is the last-stage tip the core casing must clear.
  lptOuter: 0.88,
  coreNozzleOuter: 0.55,
  coreNozzleExit: 0.34,
  plugTip: 0.12,
} as const;

// --- Axial positions (meters) --------------------------------------------
// The engine spans roughly x = -3.6 (inlet lip) to x = +3.5 (exhaust).
export const AXIS = {
  inletLip: -3.6,
  spinnerTip: -3.55,
  fanPlane: -3.2,
  fanBladeWidth: 0.55,
  bypassDuctStart: -2.95,
  bypassDuctEnd: 3.2,
  splitter: -2.7, // core/bypass splitter leading edge
  lpcStart: -2.45,
  lpcEnd: -1.35,
  hpcStart: -1.25,
  hpcEnd: 0.0,
  combustorStart: 0.1,
  combustorEnd: 0.85,
  hptStart: 0.9,
  hptEnd: 1.5,
  lptStart: 1.55,
  lptEnd: 2.3,
  coreNozzleStart: 2.35,
  coreNozzleExit: 3.05,
  // The exhaust plug (tail cone) is long and protrudes well aft of the fan
  // cowl, like the real engine — see the GE90 reference photos.
  plugEnd: 3.95,
  // Separate-flow turbofan: the fan/bypass cowl ends here as an annular nozzle,
  // exposing the core nozzle + plug aft of it (not a flat back wall).
  bypassNozzleExit: 2.55,
  nacelleBack: 2.72,
} as const;

/** X positions of each aerodynamic station along the axis. */
export const STATION_X: Record<StationId, number> = {
  '0': -4.2,
  '2': -3.2,
  '13': -2.4,
  '25': -1.35,
  '3': 0.0,
  '4': 0.85,
  '45': 1.5,
  '5': 2.3,
  '8': 3.05,
  '18': 2.55,
};

/** A vertical radius hint for where to float each station marker. */
export const STATION_MARKER_RADIUS: Record<StationId, number> = {
  '0': 0.0,
  '2': 1.625,
  '13': 1.2,
  '25': 0.55,
  '3': 0.45,
  '4': 0.55,
  '45': 0.62,
  '5': 0.82,
  '8': 0.42,
  '18': 1.0,
};

// --- Educational section descriptors (used for labels, cutaway, focus) ----
export interface EngineSectionDescriptor {
  id: string;
  label: string;
  /** Axial extent. */
  xStart: number;
  xEnd: number;
  /** Approximate outer radius for label/marker placement. */
  rOuter: number;
  /** Hex color used for the section accent. */
  color: string;
}

export const SECTIONS: EngineSectionDescriptor[] = [
  { id: 'fan', label: 'Fan', xStart: AXIS.fanPlane - 0.3, xEnd: AXIS.fanPlane + 0.3, rOuter: RADII.fanTip, color: '#5fa8ff' },
  { id: 'booster', label: 'LPC / Booster', xStart: AXIS.lpcStart, xEnd: AXIS.lpcEnd, rOuter: RADII.coreLpcOuter, color: '#56c2c0' },
  { id: 'hpc', label: 'HP Compressor', xStart: AXIS.hpcStart, xEnd: AXIS.hpcEnd, rOuter: RADII.coreHpcOuter, color: '#e3b341' },
  { id: 'combustor', label: 'Combustor', xStart: AXIS.combustorStart, xEnd: AXIS.combustorEnd, rOuter: RADII.combustorOuter, color: '#ff7847' },
  { id: 'hpt', label: 'HP Turbine', xStart: AXIS.hptStart, xEnd: AXIS.hptEnd, rOuter: RADII.hptOuter, color: '#ff5454' },
  { id: 'lpt', label: 'LP Turbine', xStart: AXIS.lptStart, xEnd: AXIS.lptEnd, rOuter: RADII.lptOuter, color: '#ff8d6b' },
  { id: 'nozzle', label: 'Exhaust Nozzle', xStart: AXIS.coreNozzleStart, xEnd: AXIS.coreNozzleExit, rOuter: RADII.coreNozzleOuter, color: '#ffa94d' },
  { id: 'bypass', label: 'Bypass Duct', xStart: AXIS.bypassDuctStart, xEnd: AXIS.bypassDuctEnd, rOuter: RADII.nacelleInner, color: '#7fd1ff' },
];

/** Geometric center of the engine (inlet → tail cone), used as the camera target. */
export const ENGINE_CENTER: [number, number, number] = [
  (AXIS.inletLip + AXIS.plugEnd) / 2,
  0,
  0,
];

/**
 * Exploded-view spread. Each module/marker is shifted along X away from the
 * engine center by this fraction of its distance from center, so the assembly
 * pulls apart along the axis while everything stays consistent.
 */
export const EXPLODE_FACTOR = 0.55;
export const explodeShiftX = (x: number): number =>
  (x - ENGINE_CENTER[0]) * EXPLODE_FACTOR;

// ===========================================================================
// EXTERNAL HARDWARE — accessory drive, plumbing, wiring, valves, fasteners.
//
// Positions follow the real GE90 powerplant geography (Avio AGB brochure,
// borescope training manual, 777 training excerpts). Clock positions use the
// aviation convention: Aft-Looking-Forward (ALF), 12:00 at top, clockwise.
// ===========================================================================

/** Convert an ALF clock hour (0–12) + radius into scene (y, z). */
export function clockToYZ(hour: number, r: number): { y: number; z: number } {
  const phi = (hour / 12) * Math.PI * 2;
  return { y: r * Math.cos(phi), z: -r * Math.sin(phi) };
}

/**
 * The lathe theta (annularSection convention) for an ALF clock hour.
 * Lathe vertices sit at y = −r·sin(θ), z = r·cos(θ).
 */
export function clockToTheta(hour: number): number {
  const phi = (hour / 12) * Math.PI * 2;
  let theta = (3 * Math.PI) / 2 - phi;
  while (theta < 0) theta += Math.PI * 2;
  return theta % (Math.PI * 2);
}

/**
 * Whether hardware at this clock position survives the museum cutaway wedge
 * (the wedge removes roughly clock 9:00 → 12:00 through the upper-camera side;
 * matches annularSection CUTAWAY: retained θ ∈ [0.08π, 1.47π]).
 */
export function visibleInCutaway(hour: number): boolean {
  const theta = clockToTheta(hour);
  return theta >= Math.PI * 0.08 && theta <= Math.PI * 1.47;
}

/** Core-casing outer radius at axial position x (linear over the shell profile). */
export function coreCaseRadiusAt(x: number): number {
  const profile: Array<[number, number]> = [
    [AXIS.lpcStart, RADII.coreLpcOuter],
    [AXIS.hpcStart, 0.56],
    [AXIS.hpcEnd, RADII.coreHpcOuter],
    [AXIS.combustorStart, 0.57],
    [AXIS.combustorEnd, RADII.combustorOuter],
    [AXIS.hptStart, RADII.hptOuter],
    [AXIS.lptEnd, RADII.lptOuter],
    [AXIS.coreNozzleStart, 0.6],
  ];
  if (x <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    if (x <= profile[i][0]) {
      const [x0, r0] = profile[i - 1];
      const [x1, r1] = profile[i];
      return r0 + ((x - x0) / (x1 - x0)) * (r1 - r0);
    }
  }
  return profile[profile.length - 1][1];
}

export const EXTERNALS = {
  /** Accessory gearbox — under the core at 6:00, axially under the HPC (Avio). */
  agb: { xStart: -1.1, xEnd: 0.05, clock: 6, standoff: 0.18, height: 0.3, width: 0.55 },
  /** Transfer gearbox at the bottom of the 6:00 fan-frame strut. */
  tgb: { x: -2.0, clock: 6, r: 0.78 },
  /** Radial driveshaft inside the 6:00 fan-frame strut (IGB → TGB). */
  radialShaft: { x: -2.0, clock: 6, rInner: 0.4, rOuter: 0.78 },
  /** Horizontal driveshaft TGB → AGB forward face. */
  horizontalShaft: { clock: 6, xStart: -1.95, xEnd: -1.1 },
  /** Air-turbine starter clamps to the AFT face of the AGB; valve + duct just aft. */
  starter: { x: 0.18, clock: 6, standoff: 0.16 },
  /** Fuel pump + HMU stack on the right (3:00-ish ALF) side of the AGB. */
  fuelPumpHmu: { x: -0.55, clock: 4.5, standoff: 0.2 },
  /** Oil tank on the fan case at 9:00 (hidden by the cutaway wedge — correct). */
  oilTank: { x: -2.65, clock: 8.6, r: 1.7, length: 0.55, radius: 0.16 },
  /** Dual-channel FADEC ECU on the fan case, right side, on vibration isolators. */
  ecu: { x: -2.85, clock: 2.2, r: 1.74, w: 0.55, h: 0.4, d: 0.12 },
  /** Two ignition exciter boxes on the lower-left core near the fan frame. */
  exciters: { x: -1.6, clock: 7.5, standoff: 0.1 },
  /** Igniter plugs on the combustor case (~8:30 and ~9:30 here for visibility). */
  igniterPlugs: [
    { x: 0.35, clock: 7.8 },
    { x: 0.35, clock: 8.6 },
  ],
  /** DAC staged fuel manifolds (pilot + main) wrapping the combustor case. */
  fuelManifolds: [
    { x: 0.18, rOffset: 0.06 },
    { x: 0.38, rOffset: 0.075 },
  ],
  /** Number of fuel-nozzle pigtails feeding the dome (30 dual-tip on the GE90 DAC). */
  fuelNozzleCount: 30,
  /** VSV unison rings on the forward HPC case (IGV + stages 1–3). */
  vsvRings: { xs: [-1.15, -0.97, -0.79, -0.61], rOffset: 0.035 },
  /** Two fueldraulic VSV actuators, one each side. */
  vsvActuators: [
    { x: -0.88, clock: 4 },
    { x: -0.88, clock: 8 },
  ],
  /** 10 VBV doors between booster exit and HPC inlet (open during start!). */
  vbv: { x: -1.32, doorCount: 10, rInner: 0.62, rOuter: 0.7 },
  /** Bolted case flanges (x, flange radius is coreCaseRadiusAt(x) + lip). */
  flanges: [
    { x: -2.45, boltCount: 36 },
    { x: -1.25, boltCount: 40 },
    { x: -0.62, boltCount: 40 },
    { x: 0.0, boltCount: 44 },
    { x: 0.88, boltCount: 44 },
    { x: 1.52, boltCount: 40 },
    { x: 2.28, boltCount: 36 },
  ],
  /** Borescope port bosses (borescope manual: A; B–H row; J/K/L/M; N/P; Q/R). */
  borescopePorts: [
    { id: 'A', x: -1.35, clock: 8 },
    ...['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id, i) => ({ id, x: -1.12 + i * 0.16, clock: 10 })),
    { id: 'J', x: 0.45, clock: 1 },
    { id: 'K', x: 0.45, clock: 4 },
    { id: 'L', x: 0.45, clock: 7 },
    { id: 'M', x: 0.45, clock: 10 },
    { id: 'N', x: 0.95, clock: 10 },
    { id: 'P', x: 1.2, clock: 11 },
    { id: 'Q', x: 1.7, clock: 10 },
    { id: 'R', x: 2.0, clock: 10 },
  ],
  /** Main wiring-harness trunks: ECU forward, then aft along both sides of the core. */
  harnessTrunks: [{ clock: 2.5 }, { clock: 9.5 }],
  /** EGT thermocouple harness ring on the LPT case. */
  egtHarnessRing: { x: 1.58, rOffset: 0.05 },
} as const;

/**
 * Fluid-line identification colors (MIL-STD-1247 tape bands; schematic tints).
 * fuel = red, oil = yellow, hydraulic = blue+yellow, pneumatic = orange+blue.
 */
export const TUBE_COLORS = {
  fuel: '#c43b2f',
  oil: '#d9a321',
  hydraulic: '#2f5fc4',
  pneumatic: '#d97a21',
  wiringConduit: '#6f6f74',
} as const;

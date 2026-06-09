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

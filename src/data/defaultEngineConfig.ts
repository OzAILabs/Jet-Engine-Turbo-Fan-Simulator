/**
 * Default engine configuration — GE90-115B-INSPIRED educational targets.
 *
 * IMPORTANT: these are public, rounded, teaching values. They are NOT
 * manufacturer data, tolerances, or certified performance figures.
 */
import type { EngineConfig, StationId } from '../sim/types';
import { RADII } from './engineLayout';

/** Area of an annulus from inner radius ri to outer radius ro [m^2]. */
const annulus = (ri: number, ro: number): number => Math.PI * (ro * ro - ri * ri);

/** Representative flow areas at each station, derived from the layout radii. */
const stationAreas: Record<StationId, number> = {
  '0': annulus(RADII.fanHub, RADII.fanTip), // capture area ~ fan face
  '2': annulus(RADII.fanHub, RADII.fanTip), // fan face
  '13': annulus(RADII.coreLpcOuter, RADII.nacelleInner), // bypass duct annulus
  '25': annulus(0.4, RADII.coreLpcOuter), // booster exit
  '3': annulus(0.36, RADII.coreHpcExit), // HPC exit (small, high pressure)
  '4': annulus(0.38, RADII.combustorOuter), // combustor / turbine inlet
  '45': annulus(0.4, RADII.hptOuter), // HPT exit
  '5': annulus(0.45, RADII.lptOuter), // LPT exit
  '8': annulus(RADII.plugTip, RADII.coreNozzleExit), // core nozzle exit
  '18': annulus(RADII.coreNozzleOuter, RADII.nacelleInner), // bypass nozzle exit
};

export const defaultEngineConfig: EngineConfig = {
  name: 'GE90-115B-inspired high-bypass turbofan (educational)',

  // Stage counts (public spec)
  fanStages: 1,
  boosterStages: 4,
  hpcStages: 9,
  hptStages: 2,
  lptStages: 6,
  numFanBlades: 22,

  // Geometry
  fanTipRadius: RADII.fanTip,
  fanHubRadius: RADII.fanHub,
  maxNacelleRadius: RADII.nacelleOuter,
  engineLength: 7.29,

  // Design-point targets
  bypassRatioTakeoff: 8.7,
  bypassRatioIdle: 6.5,
  overallPressureRatioMax: 42.0,
  fanPressureRatioMax: 1.58,
  boosterPressureRatioMax: 2.5,

  // Combustor / turbine temperatures [K]
  idleTurbineInletTemp: 950,
  takeoffTurbineInletTemp: 1830,
  turbineInletTempRedline: 1900,

  // Mass flow [kg/s]
  designMassFlow: 1350,
  idleMassFlow: 70,
  maxMassFlow: 1500,
  massFlowCalibration: 0.95,

  // Thrust
  designThrust: 513_000, // ~115,300 lbf

  // Spool redlines [rpm] (display only)
  lpSpoolRedlineRpm: 2600,
  hpSpoolRedlineRpm: 10000,

  stationAreas,
};

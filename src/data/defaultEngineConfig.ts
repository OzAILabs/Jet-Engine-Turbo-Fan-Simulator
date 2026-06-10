/**
 * Default engine configuration — GE90-115B educational model.
 *
 * Calibrated against public primary sources (see docs/NEXT_LEVEL_PLAN.md):
 *   [TCDS]  EASA Type Certificate Data Sheet IM.E.002 (mirrors FAA E00049EN)
 *   [ICAO]  ICAO Engine Emissions Databank v32 (measured)
 *   [EST]   estimated / triangulated (training material, videos, forums)
 *
 * IMPORTANT: still an educational model — NOT manufacturer data and NOT
 * suitable for design, maintenance, or operational use.
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
  name: 'GE90-115B educational model',

  // Stage counts [TCDS]: 1 fan + 4-stage booster on the LP spool (6-stage LPT),
  // 9-stage HPC on the HP spool (2-stage HPT).
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
  engineLength: 7.29, // 7,281 mm [TCDS]

  // Design-point targets
  bypassRatioTakeoff: 7.1, // measured 7.08–7.1 [ICAO]; the popular "9:1" is the base GE90
  bypassRatioIdle: 5.5, // [EST] — BPR in the model is *derived*; these are reference values
  overallPressureRatioMax: 42.0, // [ICAO 42.2–43.2; GE 42]
  fanPressureRatioMax: 1.58,
  boosterPressureRatioMax: 2.5,
  idleOverallPressureRatio: 9.0, // [EST] big turbofans idle near OPR ~8–10

  // Combustor / turbine temperatures [K]
  idleTurbineInletTemp: 950, // [EST] consistent with idle FF + idle core flow
  takeoffTurbineInletTemp: 1780, // [EST] 115k-class TIT ~1,700–1,900 K; tuned for FF 4.6–4.7 kg/s
  turbineInletTempRedline: 1900,

  // Displayed EGT (T49, LPT inlet) limits [°C] [TCDS]
  egtTakeoffLimitC: 1090,
  egtMaxContinuousC: 1050,
  egtTransientLimitC: 1095,
  egtStartLimitGroundC: 750,
  egtStartLimitFlightC: 825,

  // Mass flow [kg/s]
  designMassFlow: 1500, // [EST 1,450–1,550; no certified figure exists]
  designCoreMassFlow: 185, // gives BPR ≈ 7.1 at takeoff [ICAO anchor]
  idleMassFlow: 80,
  maxMassFlow: 1650,
  massFlowCalibration: 0.905, // tunes the BYPASS capture so SLS/100% totals ~1,500 kg/s at BPR 7.1

  // Thrust
  designThrust: 513_900, // 115,540 lbf takeoff rating [TCDS]

  // Spool speed definitions [TCDS]
  n1RatedRpm: 2355, // 100% N1
  n2RatedRpm: 9332, // 100% N2
  n1RedlineFrac: 1.105, // 2,602 rpm
  n2RedlineFrac: 1.21, // 11,292 rpm

  // Operating anchors (fraction of rated speed)
  idleN1: 0.18, // [EST] videos/forums show 17–21% N1 at gate idle
  idleN2: 0.66, // [EST] flashcards 66%; TCDS min icing idle floor is 65%
  takeoffN1: 1.0,
  takeoffN2: 1.08, // [EST] N2 runs above 100% at full takeoff thrust

  // Fuel-flow anchors [kg/s]
  idleFuelFlow: 0.24, // [EST] ~860 kg/h displayed gate idle (ICAO 7% point is higher)
  takeoffFuelFlow: 4.65, // 4.60–4.69 kg/s [ICAO]

  stationAreas,
};

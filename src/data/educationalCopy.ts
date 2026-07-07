/**
 * Student-friendly explanatory copy for stations and major sections.
 * Kept as data (not hard-coded in components) so it is easy to edit/translate.
 */
import type { StationId } from '../sim/types';

export interface StationCopy {
  /** Plain-language description of what this station represents. */
  explanation: string;
  /** "What changed here?" — what the gas did just upstream of this station. */
  whatChanged: string;
}

export const STATION_COPY: Record<StationId, StationCopy> = {
  '0': {
    explanation:
      'Undisturbed air far ahead of the engine. Its temperature and pressure are set by altitude; its speed is the aircraft flight speed.',
    whatChanged: 'Nothing yet — this is the reference condition the engine starts from.',
  },
  '2': {
    explanation:
      'The fan face, where captured air enters the engine. The inlet slows the air slightly and recovers most of its pressure.',
    whatChanged: 'The inlet diffused the incoming air, trading a little speed for a small pressure rise (ram recovery).',
  },
  '13': {
    explanation:
      'Just behind the fan in the bypass duct. Most of the engine’s air takes this path around the core — this is the main thrust stream of a high-bypass turbofan.',
    whatChanged: 'The fan added energy, raising the bypass air’s pressure and temperature a little, ready to be accelerated by the bypass nozzle.',
  },
  '25': {
    explanation:
      'Exit of the low-pressure compressor (booster). Only the core portion of the flow continues here, now at higher pressure.',
    whatChanged: 'Four booster stages squeezed the core air, raising both pressure and temperature.',
  },
  '3': {
    explanation:
      'High-pressure compressor exit — the highest pressure in the engine and the entrance to the combustor.',
    whatChanged: 'Nine HPC stages multiplied the pressure many times over. The air is now very hot purely from being compressed.',
  },
  '4': {
    explanation:
      'Combustor exit / turbine inlet. The hottest gas in the engine. Turbine materials and cooling set the limit here.',
    whatChanged: 'Fuel burned in the primary zone added enormous heat at nearly constant pressure; dilution air trimmed the peak before the turbine.',
  },
  '45': {
    explanation:
      'Exit of the high-pressure turbine, inlet to the LPT — and home of the flight-deck EGT probes (T49). The gas here is the hottest a thermocouple can survive long-term, so this is the temperature pilots actually watch.',
    whatChanged: 'The HPT expanded the hot gas, dropping its temperature and pressure to power the HPC on the same shaft.',
  },
  '5': {
    explanation:
      'Low-pressure turbine exit. The LPT has just extracted the work that drives the fan and booster. Note: the EGT gauge does not read here — it reads T49, measured upstream between the turbines at station 4.5.',
    whatChanged: 'Six LPT stages extracted the large amount of work the fan needs, dropping temperature and pressure further.',
  },
  '8': {
    explanation:
      'Core nozzle exit. The remaining pressure and heat in the core gas are converted into a fast jet.',
    whatChanged: 'The nozzle accelerated the core gas, converting pressure/temperature into kinetic energy (jet velocity).',
  },
  '18': {
    explanation:
      'Bypass nozzle exit. The large, cooler bypass stream is accelerated here and produces most of the thrust.',
    whatChanged: 'The bypass nozzle turned the fan’s modest pressure rise into a big, efficient mass of moderately fast air.',
  },
};

/** Short labels shown floating on the 3D model for each major section. */
export const SECTION_LABELS: Record<string, string> = {
  fan: 'Accelerates the huge bypass stream — most of the thrust. Moving a lot of air a little beats moving a little air a lot.',
  booster: 'Pre-compresses core air so the HPC does not have to do all the compression alone.',
  hpc: 'Nine stages squeeze air to ~40× ambient. High pressure is what lets the fuel release far more useful energy.',
  combustor: 'Fuel burns at nearly constant pressure; dilution air trims the peak so the turbine survives.',
  hpt: 'Extracts just enough power from the hottest gas to spin its shaft partner, the HPC.',
  lpt: 'Six stages pull the enormous power the fan demands out of the remaining lower-pressure gas.',
  bypass: 'The big, cool stream around the core — quieter and more efficient thrust than a hot jet alone.',
  nozzle: 'Converts leftover pressure & heat into jet velocity — the final push.',
};

/**
 * Why the operating limits exist — shown as tooltips on the EICAS gauges and
 * referenced by the glossary. Keys match the limit constants in
 * src/data/defaultEngineConfig.ts.
 */
export const LIMITS_EXPLAINED: Record<string, string> = {
  egtStartLimitGroundC:
    '750 °C ground-start limit: during start there is almost no cooling airflow through the turbine, ' +
    'so the blades tolerate far less heat than at full power. Exceeding it is a "hot start" — ' +
    'the autostart system cuts fuel to protect the hot section.',
  egtTakeoffLimitC:
    '1090 °C takeoff EGT limit (T49): turbine superalloys begin to creep — slowly stretch under ' +
    'centrifugal load — above their design temperature. The limit sits below that point so the ' +
    'blades last thousands of flight hours; minutes of exceedance can permanently shorten blade life.',
  n1RedlineFrac:
    'N1 redline 110.5% (≈2,602 rpm): fan blade root stress grows with the square of speed. ' +
    'Beyond redline, centrifugal force approaches the retention design margin of the fan disk dovetails.',
  n2RedlineFrac:
    'N2 redline 121% (≈11,292 rpm): the HP spool\'s disks carry enormous centrifugal load — ' +
    'overspeeding risks disk burst, the most dangerous uncontained failure a turbofan can have.',
  surgeMargin:
    'Surge margin is the headroom between the compressor\'s current operating point and the surge ' +
    'line, where airflow breaks down and reverses with a bang. Healthy engines keep 15–30%; ' +
    'rapid accelerations temporarily carve into it.',
};

export const DISCLAIMER =
  'This is an educational, simplified, GE90-inspired turbofan model. It is not manufacturer data, not CFD, and not suitable for design, maintenance, or operational use.';

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
      'Exit of the high-pressure turbine. The HPT has just extracted the work needed to drive the HP compressor.',
    whatChanged: 'The HPT expanded the hot gas, dropping its temperature and pressure to power the HPC on the same shaft.',
  },
  '5': {
    explanation:
      'Low-pressure turbine exit (exhaust gas temperature, EGT). The LPT drives the fan and booster.',
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
  fan: 'Accelerates huge bypass airflow. Main thrust producer.',
  booster: 'Raises core pressure before the HPC.',
  hpc: 'Many axial stages squeeze air to high pressure.',
  combustor: 'Fuel burns in the primary zone; dilution air protects the turbine.',
  hpt: 'Extracts energy to drive the HPC.',
  lpt: 'Extracts energy to drive the fan and booster.',
  bypass: 'A large mass of cooler air flows around the core.',
  nozzle: 'Converts pressure & temperature into jet velocity.',
};

export const DISCLAIMER =
  'This is an educational, simplified, GE90-inspired turbofan model. It is not manufacturer data, not CFD, and not suitable for design, maintenance, or operational use.';

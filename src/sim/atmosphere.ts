/**
 * International Standard Atmosphere (ISA) approximation, valid 0–40 000 ft.
 *
 * Two layers are needed because 40 000 ft (12 192 m) is above the tropopause:
 *   1. Troposphere  (0 – 11 000 m): temperature falls linearly with altitude.
 *   2. Lower stratosphere (11 000 – 20 000 m): temperature is constant.
 *
 * The optional ISA temperature offset shifts the *temperature* (and therefore
 * density and speed of sound) but, by altimetry convention, leaves the pressure
 * profile on the standard schedule. That is why a hot day reduces thrust:
 * same pressure, lower density.
 */
import {
  GAMMA_AIR,
  GRAVITY,
  ISA_LAPSE_RATE,
  ISA_SEA_LEVEL_PRESSURE,
  ISA_SEA_LEVEL_TEMP,
  ISA_TROPOPAUSE_ALT,
  ISA_TROPOPAUSE_TEMP,
  R_AIR,
} from './constants';
import type { Atmosphere } from './types';
import { feetToMeters } from './units';

/** Pressure at the tropopause (11 km) on the standard schedule [Pa]. */
const PRESSURE_AT_TROPOPAUSE =
  ISA_SEA_LEVEL_PRESSURE *
  Math.pow(
    ISA_TROPOPAUSE_TEMP / ISA_SEA_LEVEL_TEMP,
    GRAVITY / (ISA_LAPSE_RATE * R_AIR),
  );

/**
 * Compute the standard atmosphere at a given altitude.
 * @param altitudeFt  geometric altitude in feet
 * @param isaOffsetC  temperature deviation from standard, in °C (default 0)
 */
export function computeISA(altitudeFt: number, isaOffsetC = 0): Atmosphere {
  const h = feetToMeters(altitudeFt);

  let standardTemp: number;
  let pressure: number;

  if (h <= ISA_TROPOPAUSE_ALT) {
    // --- Troposphere: linear temperature lapse ---
    standardTemp = ISA_SEA_LEVEL_TEMP - ISA_LAPSE_RATE * h;
    pressure =
      ISA_SEA_LEVEL_PRESSURE *
      Math.pow(
        standardTemp / ISA_SEA_LEVEL_TEMP,
        GRAVITY / (ISA_LAPSE_RATE * R_AIR),
      );
  } else {
    // --- Lower stratosphere: isothermal, exponential pressure decay ---
    standardTemp = ISA_TROPOPAUSE_TEMP;
    pressure =
      PRESSURE_AT_TROPOPAUSE *
      Math.exp((-GRAVITY * (h - ISA_TROPOPAUSE_ALT)) / (R_AIR * ISA_TROPOPAUSE_TEMP));
  }

  // Apply the ISA temperature deviation to the actual (not standard) temperature.
  const temperature = standardTemp + isaOffsetC;

  // Density from the ideal gas law at the *actual* temperature.
  const density = pressure / (R_AIR * temperature);

  // Speed of sound depends on the actual temperature.
  const speedOfSound = Math.sqrt(GAMMA_AIR * R_AIR * temperature);

  return { altitudeM: h, temperature, pressure, density, speedOfSound };
}

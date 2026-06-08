/**
 * Shared color scales so every part of the UI agrees on what "hot" looks like.
 * Used by flow particles, station markers, and the exhaust plume.
 */
import * as THREE from 'three';

interface Stop {
  t: number; // temperature [K]
  color: string;
}

// Cool air → warm air → combustion → white-hot. Tuned for the model's ranges.
const TEMP_STOPS: Stop[] = [
  { t: 240, color: '#2e7dff' }, // very cold (high-altitude ambient)
  { t: 290, color: '#4fc3ff' }, // ambient
  { t: 360, color: '#7fe6d0' }, // mildly compressed
  { t: 500, color: '#9ff06b' }, // booster
  { t: 750, color: '#ffe14d' }, // HPC exit
  { t: 1100, color: '#ff9b3d' }, // turbine / hot
  { t: 1500, color: '#ff5a2b' }, // turbine inlet
  { t: 1900, color: '#fff1c2' }, // white-hot flame
];

const cache = TEMP_STOPS.map((s) => new THREE.Color(s.color));

/** Map an absolute temperature [K] to a THREE.Color along the heat scale. */
export function temperatureColor(tempK: number, out = new THREE.Color()): THREE.Color {
  if (tempK <= TEMP_STOPS[0].t) return out.copy(cache[0]);
  const last = TEMP_STOPS.length - 1;
  if (tempK >= TEMP_STOPS[last].t) return out.copy(cache[last]);
  for (let i = 0; i < last; i++) {
    const a = TEMP_STOPS[i];
    const b = TEMP_STOPS[i + 1];
    if (tempK >= a.t && tempK <= b.t) {
      const f = (tempK - a.t) / (b.t - a.t);
      return out.copy(cache[i]).lerp(cache[i + 1], f);
    }
  }
  return out.copy(cache[last]);
}

/** Normalized 0..1 "heat" for sizing/opacity, given a temperature [K]. */
export function heatFraction(tempK: number): number {
  return THREE.MathUtils.clamp((tempK - 240) / (1900 - 240), 0, 1);
}

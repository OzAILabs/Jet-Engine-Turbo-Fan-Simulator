/**
 * Compressor blade presets. Compressor blades are small, stiff and metallic,
 * and they get progressively shorter from front to rear as the annulus shrinks
 * and pressure rises. `bladeHeightFraction` (0 at the front of a section, 1 at
 * the rear) lets a row pick a realistically reduced span.
 */
import type * as THREE from 'three';
import { createBladeGeometry } from './bladeGeometry';

export interface CompressorRowParams {
  hubRadius: number;
  tipRadius: number;
  /** 0 = booster-ish (taller), 1 = late HPC (very short). */
  compactness: number;
}

export function createCompressorBladeGeometry(params: CompressorRowParams): THREE.BufferGeometry {
  const { hubRadius, tipRadius, compactness } = params;
  // Later stages have stubbier, higher-twist blades.
  return createBladeGeometry({
    radiusInner: hubRadius,
    radiusOuter: tipRadius,
    chordRoot: 0.05 + 0.03 * (1 - compactness),
    chordTip: 0.04 + 0.03 * (1 - compactness),
    sweep: 0.015,
    twistRootDeg: 38 + 8 * compactness,
    twistTipDeg: 12,
    thickness: 0.1,
    camber: 0.05,
    segmentsRadial: 6,
    segmentsChord: 6,
  });
}

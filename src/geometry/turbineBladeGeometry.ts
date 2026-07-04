/**
 * Turbine blade presets. Turbine blades are fewer, thicker and more curved than
 * compressor blades (they turn the hot gas hard), and they look heat-stressed.
 */
import type * as THREE from 'three';
import { createBladeGeometry } from './bladeGeometry';

export interface TurbineRowParams {
  hubRadius: number;
  tipRadius: number;
  /** 0 = HPT (smaller, hottest), 1 = late LPT (larger, cooler). */
  growth: number;
}

export function createTurbineBladeGeometry(params: TurbineRowParams): THREE.BufferGeometry {
  const { hubRadius, tipRadius, growth } = params;
  // NOTE the negated twist + camber: turbine blades are cambered OPPOSITE the
  // compressor/fan blades (mirrored in Z), so the expanding hot gas pushes the
  // rotor in the engine's actual rotation sense (SPOOL_SPIN_SIGN — clockwise
  // viewed from the rear, like the real GE90) instead of fighting it.
  return createBladeGeometry({
    radiusInner: hubRadius,
    radiusOuter: tipRadius,
    chordRoot: 0.07 + 0.04 * growth,
    chordTip: 0.06 + 0.04 * growth,
    sweep: 0.01,
    twistRootDeg: -42,
    twistTipDeg: -18,
    thickness: 0.18, // thick, blunt turbine blades
    camber: -0.11, // strongly cambered to turn the flow
    segmentsRadial: 7,
    segmentsChord: 7,
  });
}

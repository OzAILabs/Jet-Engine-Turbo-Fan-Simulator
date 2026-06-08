/**
 * Nacelle (cowl) geometry: a smooth surface of revolution with a rounded inlet
 * lip, a bulged mid-body and a tapered tail. Built as an X-axis lathe so the
 * cutaway can be applied by limiting the sweep angle.
 */
import * as THREE from 'three';
import { AXIS, RADII } from '../data/engineLayout';
import { createLatheAlongX } from './annularSection';

/**
 * Outer nacelle shell profile. Returns a lathe geometry. Pass a partial
 * thetaLength for the cutaway.
 */
export function createNacelleShell(
  opts: { thetaStart?: number; thetaLength?: number } = {},
): THREE.BufferGeometry {
  const { inletLip, fanPlane, bypassNozzleExit, nacelleBack } = AXIS;
  const { nacelleOuter, nacelleInner } = RADII;

  // A SINGLE continuous profile that traces the inner inlet wall forward, wraps
  // around a rounded leading-edge lip (the forward-most "highlight"), and runs
  // back along the outer cowl to the convergent bypass-nozzle trailing lip.
  // Because the curve doubles back at the nose, the revolved surface forms one
  // smooth rounded lip instead of a ring stuck on a stepped cowl.
  const profile: Array<[number, number]> = [
    // --- inner inlet wall (throat), just outside the fan, going FORWARD ---
    [fanPlane + 0.25, nacelleInner + 0.003],
    [-3.25, nacelleInner + 0.01],
    [inletLip + 0.22, nacelleInner + 0.02],
    [inletLip + 0.08, nacelleInner + 0.045],
    [inletLip + 0.0, nacelleInner + 0.07], // inner shoulder of the lip
    // --- FAT, rounded leading-edge lip (a big arc; nose is forward-most) ---
    [inletLip - 0.05, nacelleInner + 0.105],
    [inletLip - 0.075, nacelleInner + 0.155], // highlight / nose
    [inletLip - 0.06, nacelleInner + 0.185],
    [inletLip - 0.0, nacelleOuter], // outer shoulder out to max diameter
    [inletLip + 0.14, nacelleOuter],
    // --- cowl outer body: STEADY taper, largest at front → narrow at back ---
    [fanPlane + 0.4, nacelleOuter],
    [-1.5, nacelleOuter * 0.974],
    [-0.2, nacelleOuter * 0.919],
    [1.0, nacelleOuter * 0.838],
    [1.8, nacelleOuter * 0.757],
    [2.2, nacelleOuter * 0.703],
    [bypassNozzleExit, nacelleOuter * 0.638], // ~1.18: open bypass-nozzle lip
    [nacelleBack, nacelleOuter * 0.611], // ~1.13 trailing edge
  ];

  return createLatheAlongX(profile, { segments: 120, ...opts });
}

/**
 * Inner wall of the bypass duct (the cowl's inner surface). A simple taper that
 * forms the outer boundary of the bypass flow path.
 */
export function createBypassDuctInner(
  opts: { thetaStart?: number; thetaLength?: number } = {},
): THREE.BufferGeometry {
  const { fanPlane, bypassNozzleExit } = AXIS;
  // Inner wall of the cowl = outer boundary of the bypass flow path. It tapers
  // steadily (tracking the outer skin) to the bypass-nozzle exit, leaving a
  // LARGE annular gap to the core cowl through which the bypass air leaves —
  // not a tight little hole.
  const profile: Array<[number, number]> = [
    [fanPlane + 0.1, RADII.nacelleInner * 0.99],
    [0.0, 1.5],
    [1.0, 1.32],
    [1.8, 1.18],
    [2.2, 1.1],
    [bypassNozzleExit, 1.02], // bypass nozzle exit (wide annulus around the core)
  ];
  return createLatheAlongX(profile, { segments: 110, ...opts });
}

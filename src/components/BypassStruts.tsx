/**
 * BypassStruts.tsx — the FAN FRAME: a ring of heavy radial structural struts
 * that span the bypass duct and tie the core casing to the bypass-duct outer
 * wall. On a real GE90 these carry the engine loads (and route services) across
 * the cold stream, sitting just behind the fan Outlet Guide Vanes.
 *
 * They are STRUCTURE, not aero: stationary (spin = null), thick, and only
 * lightly faired. We reuse the same machinery as every other vane row so the
 * pattern (and the watertight geometry) stays consistent:
 *   - one lofted, capped airfoil solid from createBladeGeometry, shaped into a
 *     wide-chord / high-thickness / no-camber / no-twist slab,
 *   - placed by BladeRow, which centers the geometry on the axis, instances it
 *     ~10 times and pre-rotates each copy about +X into its angular slot.
 *
 * Placement (cross-checked against the layout + geometry files):
 *   - Axial: x = -2.0, clearly AFT of the OGVs at AXIS.fanPlane+0.82 = -2.38,
 *     sitting over the front of the LPC/booster.
 *   - Radial: root r=0.68 sits just outside the core casing (CutawayShell's
 *     profile is ~0.63 at x=-2.0); tip r=1.53 stops just inside the bypass-duct
 *     outer wall (createBypassDuctInner is ~1.58 at x=-2.0).
 *
 * View modes match the shells: rendered in full / transparent / cutaway, hidden
 * in exploded. Self-contained: one <BypassStruts /> line in EngineModel3D wires
 * it in, so deleting this file + that line fully reverts the feature.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { createBladeGeometry } from '../geometry/bladeGeometry';
import { BladeRow } from './BladeRow';

/** Number of structural struts evenly spaced around the bypass annulus. */
const STRUT_COUNT = 10;

/** Axial station of the strut row [m] — aft of the OGVs (-2.38), over the LPC. */
const STRUT_X = -2.0;

/** Radial span [m]: root just outside the core casing; tip just inside the
 *  bypass-duct outer wall (~1.58 at x=-2.0), with a little clearance. */
const STRUT_ROOT_RADIUS = 0.68;
const STRUT_TIP_RADIUS = 1.53;

export function BypassStruts() {
  const viewMode = useSimStore((s) => s.viewMode);

  // One heavy, slightly-faired radial slab: wide axial chord, thin tangentially,
  // no camber/twist/sweep, tapering a touch toward the tip.
  const strutGeo = useMemo(
    () =>
      createBladeGeometry({
        radiusInner: STRUT_ROOT_RADIUS,
        radiusOuter: STRUT_TIP_RADIUS,
        chordRoot: 0.22,
        chordTip: 0.18,
        sweep: 0,
        twistRootDeg: 0,
        twistTipDeg: 0,
        thickness: 0.23, // fraction of chord => ~0.05 m thick
        camber: 0,
        segmentsRadial: 6,
        segmentsChord: 10,
      }),
    [],
  );

  // Brushed structural metal — its OWN material (not the shared rotor material),
  // so the compressor surge glow never bleeds onto the frame.
  const strutMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#aeb6bf'),
        metalness: 0.8,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    [],
  );

  if (viewMode === 'exploded' || viewMode === 'internals') return null;

  return <BladeRow geometry={strutGeo} material={strutMat} count={STRUT_COUNT} x={STRUT_X} spin={null} />;
}

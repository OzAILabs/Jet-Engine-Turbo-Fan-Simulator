/**
 * CutawayShell
 *
 * The outer metal casing that wraps the engine CORE (compressor, combustor and
 * turbine). Without it the core internals would float in space; this gives the
 * engine a solid, machined-can appearance from the LP compressor inlet back to
 * the start of the core nozzle.
 *
 * The casing is a single surface-of-revolution (a "lathe") built from a profile
 * of [x, outerRadius] pairs that traces the core's silhouette. We pre-build two
 * versions once:
 *   - full     : the complete 360-degree casing
 *   - cutaway  : a partial ring (a wedge removed) so students can see inside
 *
 * The active geometry and the material appearance are chosen from the current
 * viewMode, matching the rest of the engine's shells:
 *   full        -> opaque brushed metal
 *   transparent -> faint ghost so internals show through
 *   cutaway      -> partial ring, opaque metal, double-sided
 *   exploded     -> nearly invisible ghost
 *
 * The internal rotating parts are always rendered elsewhere; only this shell's
 * geometry/opacity changes with the view.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { CUTAWAY, createLatheAlongX } from '../geometry/annularSection';
import { CutawayEdges } from './CutawayEdges';
import { RADII, AXIS } from '../data/engineLayout';

export function CutawayShell() {
  // Only the view mode changes how this shell looks, so subscribe to just that.
  const viewMode = useSimStore((s) => s.viewMode);

  // The outer radius profile of the core casing, traced front (-X) to back (+X).
  // Each pair is [axial x, outer radius] in meters.
  const profile = useMemo<Array<[number, number]>>(
    () => [
      [AXIS.lpcStart, RADII.coreLpcOuter],
      [AXIS.hpcStart, 0.56],
      [AXIS.hpcEnd, RADII.coreHpcOuter],
      [AXIS.combustorStart, RADII.combustorOuter + 0.02],
      [AXIS.combustorEnd, RADII.combustorOuter],
      [AXIS.hptStart, RADII.hptOuter],
      [AXIS.lptEnd, RADII.lptOuter],
      [AXIS.coreNozzleStart, RADII.coreNozzleOuter + 0.05],
    ],
    [],
  );

  // Full 360-degree casing, built once.
  const fullGeometry = useMemo(() => createLatheAlongX(profile), [profile]);

  // Partial casing for the museum-style cutaway, built once. The CUTAWAY angles
  // leave a wedge open toward the default camera so the core is visible.
  const cutawayGeometry = useMemo(
    () =>
      createLatheAlongX(profile, {
        thetaStart: CUTAWAY.thetaStart,
        thetaLength: CUTAWAY.thetaLength,
      }),
    [profile],
  );

  // One shared material; we only flip its appearance flags per view mode below.
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#aab3bf'),
        metalness: 0.85,
        roughness: 0.45,
      }),
    [],
  );
  // Pick geometry + appearance for the current view mode.
  const { geometry, opacity, transparent, side, depthWrite } = useMemo(() => {
    switch (viewMode) {
      case 'cutaway':
        // Solid partial ring: only the removed wedge exposes the core.
        return {
          geometry: cutawayGeometry,
          opacity: 1,
          transparent: false,
          side: THREE.DoubleSide,
          depthWrite: true,
        };
      case 'transparent':
        return {
          geometry: fullGeometry,
          opacity: 0.09,
          transparent: true,
          side: THREE.FrontSide,
          depthWrite: false,
        };
      case 'full':
      default:
        return {
          geometry: fullGeometry,
          opacity: 1,
          transparent: false,
          side: THREE.FrontSide,
          depthWrite: true,
        };
    }
  }, [viewMode, fullGeometry, cutawayGeometry]);

  // Hidden in exploded view — the separated modules are shown without the
  // casing — and in the Internals drive-train view (no shells at all).
  if (viewMode === 'exploded' || viewMode === 'internals') return null;

  return (
    <>
      <mesh geometry={geometry}>
        <primitive
          object={material}
          attach="material"
          transparent={transparent}
          opacity={opacity}
          side={side}
          depthWrite={depthWrite}
        />
      </mesh>
      {/* GE-style blue outline on the cut edges (cutaway mode only). */}
      {viewMode === 'cutaway' && <CutawayEdges geometry={cutawayGeometry} />}
    </>
  );
}

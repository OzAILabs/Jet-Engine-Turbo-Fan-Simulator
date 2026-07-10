/**
 * Nacelle.tsx
 *
 * The outer cowl (nacelle) of the engine plus the inner bypass-duct wall and a
 * rounded inlet lip. This is a STATIONARY shell: it never spins. Its job is to
 * react to the current view mode so students can "peel back" the casing and see
 * the rotating machinery inside.
 *
 * View modes (see the project's VIEW MODE BEHAVIOR notes):
 *   full        -> solid metal cowl, fully opaque.
 *   transparent -> ghosted, very faint so internals show through.
 *   cutaway     -> a partial ring (a wedge removed) so you can look straight in.
 *   exploded    -> faint AND lifted up on +Y so the parts separate vertically.
 *
 * All geometry is built centered at the local origin and oriented along +X by
 * the geometry helpers, so we can render the meshes without extra positioning.
 */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { createNacelleShell, createBypassDuctInner } from '../geometry/nacelleGeometry';
import { CUTAWAY } from '../geometry/annularSection';
import { createPaintedNacelleMaterial } from '../materials/coldSection';
import { createNacelleSkinMaterial } from '../materials/nacelleSkin';
import { CutawayEdges } from './CutawayEdges';
import { NacelleFurniture } from './NacelleFurniture';
import { useSimStore } from '../store/useSimStore';

export function Nacelle() {
  // Only the view mode changes how this shell is drawn, so subscribe to just
  // that slice reactively (cheap, re-renders only when the mode changes).
  const viewMode = useSimStore((s) => s.viewMode);

  const root = useRef<THREE.Group>(null!);

  // --- Geometries (created once) -------------------------------------------
  // We keep two variants of each shell: a full 360-degree surface and a partial
  // ("cutaway") surface that has a wedge removed. The full one is reused for the
  // full / transparent / exploded modes; the partial one is only for cutaway.
  const shellFull = useMemo(() => createNacelleShell(), []);
  const shellCut = useMemo(
    () => createNacelleShell({ thetaStart: CUTAWAY.thetaStart, thetaLength: CUTAWAY.thetaLength }),
    [],
  );
  const ductFull = useMemo(() => createBypassDuctInner(), []);
  const ductCut = useMemo(
    () => createBypassDuctInner({ thetaStart: CUTAWAY.thetaStart, thetaLength: CUTAWAY.thetaLength }),
    [],
  );

  // --- Materials (created once, tweaked per view mode) ---------------------
  // The outer cowl wears the full painted SKIN (panel seams, rivets, access
  // doors, markings, bare-metal lip, grime — see materials/nacelleSkin.ts);
  // the bypass-duct inner wall keeps the plain mottled paint so cowl markings
  // don't smear across it. Both stay single shared MeshStandardMaterials: the
  // view-mode switch below mutates transparency flags on BOTH in lockstep.
  const skinMat = useMemo(() => createNacelleSkinMaterial(), []);
  const ductMat = useMemo(() => createPaintedNacelleMaterial(), []);
  // Decide which geometry and material settings to use for the current mode.
  // We mutate the shared materials' transparency flags directly inside this
  // memo so they stay in sync with viewMode without creating new materials.
  const { shellGeo, ductGeo } = useMemo(() => {
    const apply = (transparent: boolean, opacity: number) => {
      for (const material of [skinMat, ductMat]) {
        material.transparent = transparent;
        material.opacity = opacity;
        material.depthWrite = !transparent;
        material.side = THREE.DoubleSide;
      }
    };
    switch (viewMode) {
      case 'transparent':
        // Very faint: the cowl (DoubleSide) and the bypass-duct inner wall
        // stack with the core casing — so keep each layer low or they
        // composite into a milky, near-opaque shell.
        apply(true, 0.07);
        return { shellGeo: shellFull, ductGeo: ductFull };

      case 'cutaway':
        // The remaining cowl is solid metal; only the removed wedge exposes
        // the internals. Show both faces so the cut edge/interior wall reads.
        apply(false, 1);
        return { shellGeo: shellCut, ductGeo: ductCut };

      case 'full':
      default:
        // Solid opaque metal.
        apply(false, 1);
        return { shellGeo: shellFull, ductGeo: ductFull };
    }
  }, [viewMode, skinMat, ductMat, shellFull, shellCut, ductFull, ductCut]);

  // In exploded view the cowl is hidden entirely so the separated internal
  // modules are fully visible (and there is no faint floating shell). Same in
  // the Internals drive-train view — no shells at all.
  if (viewMode === 'exploded' || viewMode === 'internals') return null;

  return (
    <group ref={root}>
      {/* Outer cowl shell */}
      <mesh geometry={shellGeo} material={skinMat} />

      {/* Inner bypass-duct wall */}
      <mesh geometry={ductGeo} material={ductMat} />

      {/* Cowl hardware: latch handles, T2 probe, crisp placard decals
          (hides itself outside full/cutaway). */}
      <NacelleFurniture />

      {/* GE-style blue outline on the cut edges (cutaway mode only). */}
      {viewMode === 'cutaway' && (
        <>
          <CutawayEdges geometry={shellCut} />
          <CutawayEdges geometry={ductCut} />
        </>
      )}
    </group>
  );
}

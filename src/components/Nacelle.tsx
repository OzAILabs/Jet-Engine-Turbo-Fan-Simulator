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

  // --- Material (created once, tweaked per view mode) ----------------------
  // A single shared standard "metal" material. We adjust its transparency to
  // match the active view mode each render rather than allocating new materials.
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#c9d2dc'),
        metalness: 0.65,
        roughness: 0.4,
        side: THREE.DoubleSide, // thin shell with a wrap-around lip: light both faces
      }),
    [],
  );

  // Decide which geometry and material settings to use for the current mode.
  // We mutate the shared material's transparency flags directly inside this
  // memo so they stay in sync with viewMode without creating new materials.
  const { shellGeo, ductGeo } = useMemo(() => {
    switch (viewMode) {
      case 'transparent':
        material.transparent = true;
        material.opacity = 0.16;
        material.depthWrite = false;
        material.side = THREE.DoubleSide;
        return { shellGeo: shellFull, ductGeo: ductFull };

      case 'cutaway':
        // Partial ring; show both faces since the cut exposes the inside.
        material.transparent = true;
        material.opacity = 0.35;
        material.depthWrite = false;
        material.side = THREE.DoubleSide;
        return { shellGeo: shellCut, ductGeo: ductCut };

      case 'full':
      default:
        // Solid opaque metal.
        material.transparent = false;
        material.opacity = 1;
        material.depthWrite = true;
        material.side = THREE.DoubleSide;
        return { shellGeo: shellFull, ductGeo: ductFull };
    }
  }, [viewMode, material, shellFull, shellCut, ductFull, ductCut]);

  // In exploded view the cowl is hidden entirely so the separated internal
  // modules are fully visible (and there is no faint floating shell).
  if (viewMode === 'exploded') return null;

  return (
    <group ref={root}>
      {/* Outer cowl shell */}
      <mesh geometry={shellGeo} material={material} />

      {/* Inner bypass-duct wall */}
      <mesh geometry={ductGeo} material={material} />
    </group>
  );
}

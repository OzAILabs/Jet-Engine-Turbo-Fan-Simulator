/**
 * Shafts.tsx
 *
 * The two concentric drive shafts that connect the rotating sections of the
 * engine, plus the three STATIC bearing-support frames that hold them. A
 * turbofan like the GE90 runs on TWO independent spools:
 *
 *   - LP (low-pressure) spool: the long, thin INNER shaft. It ties the fan and
 *     LP turbine together so the big fan up front is driven by the cool, slow
 *     turbine stages at the very back.
 *   - HP (high-pressure) spool: a short, fat HOLLOW shaft that wraps around the
 *     LP shaft. It ties the HP compressor to the HP turbine right around the
 *     combustor, spinning much faster.
 *
 * Shafts can't float in mid-air: the real engine carries them on bearings in
 * three structural frames — the FAN FRAME behind the fan (its struts continue
 * outward as the bypass fan-frame struts), a MID FRAME at the compressor rear
 * / combustor diffuser, and the TURBINE REAR FRAME behind the last LPT stage.
 * Each frame here is a spoked hub: 6 radial spokes + a steel hub ring. The
 * bearings themselves (spinning races, roller cages, oil jets) are live parts
 * drawn by Bearings.tsx at the BEARINGS stations from engineLayout.ts.
 *
 * Because one shaft literally runs THROUGH the other, you can only appreciate
 * them with the casing peeled away, so we only show the shafts when the view is
 * NOT the solid "full" mode. The support frames are case-to-shaft structure, so
 * they appear only in 'transparent' and 'cutaway' (in 'exploded' the cases they
 * tie into have pulled away, and they'd float meaninglessly).
 *
 * Performance pattern: we never subscribe to the live spool angle reactively.
 * Instead each shaft's parent <group> has its rotation.x assigned every frame
 * from useSimStore.getState() inside useFrame (one cheap matrix update). Only
 * the viewMode (which changes rarely) is read reactively to toggle visibility.
 * The frames cost 2 draw calls total: ONE InstancedMesh for all 18 spokes and
 * ONE merged mesh for the 3 hub rings.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimStore } from '../store/useSimStore';
import { AXIS, SPOOL_SPIN_SIGN } from '../data/engineLayout';
import { createTube } from '../geometry/annularSection';

/** The three bearing-support frames (axial station, spoke reach, ring sizes). */
interface FrameSpec {
  /** Axial station of the frame [m]. */
  x: number;
  /** Radial reach of the spokes [m]. */
  rOut: number;
  /** Radius of the steel hub ring the spokes radiate from [m]. */
  hubR: number;
}

const FRAMES: FrameSpec[] = [
  // Fan frame: inboard continuation of the bypass fan-frame struts (their
  // roots sit at r≈0.68 at this same x). Houses the LP-shaft thrust bearing.
  { x: -2.0, rOut: 0.65, hubR: 0.2 },
  // Mid frame at the HPC exit / diffuser: houses the HP-shaft rear bearing,
  // plus the LP bearing running through inside it (see BEARINGS in
  // engineLayout.ts — the live races/rollers are drawn by Bearings.tsx).
  { x: 0.05, rOut: 0.4, hubR: 0.3 },
  // Turbine rear frame, just aft of the last LPT stage: LP-shaft rear bearing.
  { x: 2.32, rOut: 0.85, hubR: 0.2 },
];

const SPOKES_PER_FRAME = 6;

const dummy = new THREE.Object3D();

export function Shafts() {
  // Only meaningful once the casing is see-through; rarely changes, so this is
  // the one value we read reactively.
  const viewMode = useSimStore((s) => s.viewMode);
  const visible = viewMode !== 'full';
  // Frames tie shaft to case: shown only while the case is in place but see-through.
  const showFrames = viewMode === 'transparent' || viewMode === 'cutaway';

  const lpGroup = useRef<THREE.Group>(null!);
  const hpGroup = useRef<THREE.Group>(null!);

  // --- LP shaft geometry: thin solid rod from the fan plane to the LP turbine.
  const lpGeo = useMemo(() => {
    const length = AXIS.lptEnd - AXIS.fanPlane;
    // Constant-radius tube (front radius == back radius) => a plain cylinder.
    return createTube(0.12, 0.12, length, { radialSegments: 32 });
  }, []);
  const lpCenterX = useMemo(() => (AXIS.fanPlane + AXIS.lptEnd) / 2, []);

  // Steel-like finish for the cool LP shaft.
  const lpMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#b8c0cc', metalness: 0.9, roughness: 0.25 }),
    [],
  );

  // --- HP shaft geometry: thicker hollow drum around the combustor span.
  const hpGeo = useMemo(() => {
    const length = AXIS.hptEnd - AXIS.hpcStart;
    // openEnded so it reads as a hollow tube the LP shaft passes through.
    return createTube(0.22, 0.22, length, { radialSegments: 40, openEnded: true });
  }, []);
  const hpCenterX = useMemo(() => (AXIS.hpcStart + AXIS.hptEnd) / 2, []);

  // Brass-ish finish for the hot, fast HP shaft so the two read distinctly.
  const hpMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#c9a96a',
        metalness: 0.9,
        roughness: 0.3,
        side: THREE.DoubleSide, // hollow tube: show the inner wall too
      }),
    [],
  );

  // --- Bearing-frame geometry ----------------------------------------------
  // Spoke master: a slightly tapered strut spanning y ∈ [0, 1] so a per-instance
  // Y-scale stretches it from the hub out to each frame's reach.
  const spokeGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.022, 0.034, 1, 8);
    g.translate(0, 0.5, 0);
    return g;
  }, []);

  // 3 steel hub rings, merged into one geometry (one draw call).
  const hubRingGeo = useMemo(() => {
    const parts = FRAMES.map((f) => {
      const t = new THREE.TorusGeometry(f.hubR, 0.028, 10, 48);
      t.rotateY(Math.PI / 2); // ring into the Y–Z plane (axis along +X)
      t.translate(f.x, 0, 0);
      return t;
    });
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  }, []);

  // Structural steel for the frames. (The static bright "bearing rings" that
  // used to merge here were replaced by the live races in Bearings.tsx.)
  const frameMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#8a9099', metalness: 0.75, roughness: 0.45 }),
    [],
  );

  // Lay out all 18 spokes once: 6 per frame, fanned about +X, each frame's set
  // staggered a little so the three frames don't read as one aligned grille.
  const spokesRef = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const mesh = spokesRef.current;
    if (!mesh) return; // not mounted in this view mode
    let i = 0;
    FRAMES.forEach((f, fi) => {
      for (let k = 0; k < SPOKES_PER_FRAME; k++) {
        dummy.position.set(f.x, 0, 0);
        dummy.rotation.set((k * Math.PI * 2) / SPOKES_PER_FRAME + fi * (Math.PI / 6), 0, 0);
        dummy.scale.set(1, f.rOut, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [showFrames]);

  // Drive both shafts from the live spool angles (non-reactive read).
  useFrame(() => {
    const { spool } = useSimStore.getState();
    lpGroup.current.rotation.x = SPOOL_SPIN_SIGN * spool.lpAngle;
    hpGroup.current.rotation.x = SPOOL_SPIN_SIGN * spool.hpAngle;
  });

  return (
    <group visible={visible}>
      {/* Inner LP shaft (fan <-> LP turbine). */}
      <group ref={lpGroup}>
        <mesh geometry={lpGeo} material={lpMat} position={[lpCenterX, 0, 0]} frustumCulled={false} />
      </group>

      {/* Outer HP shaft (HP compressor <-> HP turbine). */}
      <group ref={hpGroup}>
        <mesh geometry={hpGeo} material={hpMat} position={[hpCenterX, 0, 0]} frustumCulled={false} />
      </group>

      {/* Static bearing-support frames: spokes + hub rings. */}
      {showFrames && (
        <group>
          <instancedMesh
            ref={spokesRef}
            args={[spokeGeo, frameMat, FRAMES.length * SPOKES_PER_FRAME]}
            castShadow={false}
            frustumCulled={false}
          />
          <mesh geometry={hubRingGeo} material={frameMat} castShadow={false} frustumCulled={false} />
        </group>
      )}
    </group>
  );
}

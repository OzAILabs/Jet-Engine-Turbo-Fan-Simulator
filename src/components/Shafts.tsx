/**
 * Shafts.tsx
 *
 * The two concentric drive shafts that connect the rotating sections of the
 * engine. A turbofan like the GE90 runs on TWO independent spools:
 *
 *   - LP (low-pressure) spool: the long, thin INNER shaft. It ties the fan and
 *     LP turbine together so the big fan up front is driven by the cool, slow
 *     turbine stages at the very back.
 *   - HP (high-pressure) spool: a short, fat HOLLOW shaft that wraps around the
 *     LP shaft. It ties the HP compressor to the HP turbine right around the
 *     combustor, spinning much faster.
 *
 * Because one shaft literally runs THROUGH the other, you can only appreciate
 * them with the casing peeled away, so we only show the shafts when the view is
 * NOT the solid "full" mode.
 *
 * Performance pattern: we never subscribe to the live spool angle reactively.
 * Instead each shaft's parent <group> has its rotation.x assigned every frame
 * from useSimStore.getState() inside useFrame (one cheap matrix update). Only
 * the viewMode (which changes rarely) is read reactively to toggle visibility.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS } from '../data/engineLayout';
import { createTube } from '../geometry/annularSection';

export function Shafts() {
  // Only meaningful once the casing is see-through; rarely changes, so this is
  // the one value we read reactively.
  const viewMode = useSimStore((s) => s.viewMode);
  const visible = viewMode !== 'full';

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

  // Drive both shafts from the live spool angles (non-reactive read).
  useFrame(() => {
    const { spool } = useSimStore.getState();
    lpGroup.current.rotation.x = spool.lpAngle;
    hpGroup.current.rotation.x = spool.hpAngle;
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
    </group>
  );
}

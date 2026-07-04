/**
 * A single annular row of identical blades.
 *
 * Performance pattern used throughout the engine:
 *   - one InstancedMesh holds all blades in the row (one draw call),
 *   - each instance is pre-rotated about the X axis to its angular slot,
 *   - the whole row sits in a <group> whose rotation.x we drive every frame
 *     from the live spool angle (cheap — one matrix, not N).
 *
 * Stators pass spin={null} and simply don't rotate.
 */
import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { SPOOL_SPIN_SIGN } from '../data/engineLayout';

export type SpoolDriver = 'lp' | 'hp' | null;

export interface BladeRowProps {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  count: number;
  /** Axial position of the row [m]. */
  x: number;
  /** Which spool drives the rotation (null = stationary stator). */
  spin?: SpoolDriver;
  /** Base angular offset [rad] (e.g. to stagger stators against rotors). */
  phase?: number;
  /** Rotation sense. */
  direction?: 1 | -1;
}

const dummy = new THREE.Object3D();

export function BladeRow({
  geometry,
  material,
  count,
  x,
  spin = null,
  phase = 0,
  direction = 1,
}: BladeRowProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.InstancedMesh>(null!);

  // Lay the blades out evenly around the hub once (and whenever count changes).
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    const step = (Math.PI * 2) / count;
    for (let k = 0; k < count; k++) {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(phase + k * step, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count, phase]);

  // Drive the row's spin from the live spool angle (no React re-render).
  useFrame(() => {
    if (!spin) return;
    const { spool } = useSimStore.getState();
    const angle = spin === 'lp' ? spool.lpAngle : spool.hpAngle;
    groupRef.current.rotation.x = SPOOL_SPIN_SIGN * direction * angle;
  });

  return (
    <group ref={groupRef} position={[x, 0, 0]}>
      <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />
    </group>
  );
}

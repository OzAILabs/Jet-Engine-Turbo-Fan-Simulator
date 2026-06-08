/**
 * EngineScene — the R3F <Canvas> and everything inside it.
 *
 * Also home to the single physics "ticker": one useFrame call advances the
 * spool dynamics each frame (frame-rate independent, clamped dt), and every
 * rotating component reads the resulting angle from the store.
 */
import { Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { CameraRig } from './CameraRig';
import { Lighting } from './Lighting';
import { EngineModel3D } from './EngineModel3D';

/** Advances spool inertia once per frame. */
function PhysicsTicker() {
  const tick = useSimStore((s) => s.tick);
  useFrame((_, delta) => tick(delta));
  return null;
}

export function EngineScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      frameloop="always"
    >
      <color attach="background" args={['#0a0d12']} />
      <fog attach="fog" args={['#0a0d12', 22, 60]} />

      <CameraRig />
      <Lighting />

      {/* Subtle museum "floor" grid well below the engine. */}
      <gridHelper
        args={[60, 60, '#2a3340', '#161c24']}
        position={[0, -2.4, 0]}
      />

      <Suspense fallback={null}>
        <EngineModel3D />
      </Suspense>

      <PhysicsTicker />
    </Canvas>
  );
}

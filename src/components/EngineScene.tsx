/**
 * EngineScene — the R3F <Canvas> and everything inside it.
 *
 * Also home to the single physics "ticker": one useFrame call advances the
 * spool dynamics each frame (frame-rate independent, clamped dt), and every
 * rotating component reads the resulting angle from the store.
 */
import { Suspense, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { CameraRig } from './CameraRig';
import { Lighting } from './Lighting';
import { EngineModel3D } from './EngineModel3D';
import { RealisticEnvironment } from './RealisticEnvironment';
import { applyScenario, installSimBridge } from '../util/simBridge';

/** Advances spool inertia once per frame. */
function PhysicsTicker() {
  const tick = useSimStore((s) => s.tick);
  useFrame((_, delta) => tick(delta));
  return null;
}

/**
 * CaptureBridge — wires window.__sim.capture() to the live GL canvas.
 * One call = scenario + camera snap + a few settle frames + PNG data URL.
 * Requires preserveDrawingBuffer on the renderer (set in the Canvas gl props).
 */
function CaptureBridge() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const bridge = installSimBridge();
    bridge.capture = async (opts = {}) => {
      if (opts.scenario) applyScenario(opts.scenario);
      if (opts.preset) useSimStore.getState().snapCamera(opts.preset);
      // Let the render loop draw a few frames so physics/animations settle.
      await new Promise<void>((resolve) => {
        let frames = 0;
        const wait = () => (++frames >= 4 ? resolve() : requestAnimationFrame(wait));
        requestAnimationFrame(wait);
      });
      return gl.domElement.toDataURL('image/png');
    };
    return () => {
      if (window.__sim) window.__sim.capture = undefined;
    };
  }, [gl]);
  return null;
}

export function EngineScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows="soft"
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.96,
        // Keeps the back buffer readable so __sim.capture() can toDataURL().
        preserveDrawingBuffer: true,
      }}
      frameloop="always"
    >
      <color attach="background" args={['#0a0d12']} />
      <fog attach="fog" args={['#0a0d12', 22, 60]} />

      <CameraRig />
      <RealisticEnvironment />
      <Lighting />

      {/* Subtle museum "floor" grid well below the engine. */}
      <gridHelper
        args={[60, 60, '#2a3340', '#161c24']}
        position={[0, -2.4, 0]}
      />
      <mesh position={[0, -2.405, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <shadowMaterial transparent opacity={0.34} />
      </mesh>

      <Suspense fallback={null}>
        <EngineModel3D />
      </Suspense>

      <PhysicsTicker />
      <CaptureBridge />
    </Canvas>
  );
}

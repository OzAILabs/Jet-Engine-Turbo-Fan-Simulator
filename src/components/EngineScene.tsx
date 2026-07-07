/**
 * EngineScene — the R3F <Canvas> and everything inside it.
 *
 * Also home to the single physics "ticker": one useFrame call advances the
 * spool dynamics each frame (frame-rate independent, clamped dt), and every
 * rotating component reads the resulting angle from the store.
 */
import { Suspense, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
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

/** Module-level plane + normal LUT so the per-change update allocates nothing. */
const sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
const AXIS_NORMALS: Record<'x' | 'y' | 'z', THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/**
 * SectionCut — a single RENDERER-level clipping plane (gl.clippingPlanes),
 * so every material in the scene is cut without any per-material wiring.
 * Reads store.sectionCut reactively (user-driven, changes rarely per frame
 * except while a slider drags — one Plane mutation each, no allocation).
 */
function SectionCut() {
  const gl = useThree((s) => s.gl);
  const cut = useSimStore((s) => s.sectionCut);
  useEffect(() => {
    if (!cut.enabled) {
      gl.clippingPlanes = [];
      return;
    }
    const sign = cut.flip ? 1 : -1;
    sectionPlane.normal.copy(AXIS_NORMALS[cut.axis]).multiplyScalar(sign);
    // Plane through the point offset·axis with normal sign·axis: the visible
    // half-space is the one the normal points into (constant = −n·q).
    sectionPlane.constant = -sign * cut.offset;
    gl.clippingPlanes = [sectionPlane];
    return () => {
      gl.clippingPlanes = [];
    };
  }, [gl, cut]);
  return null;
}

/**
 * FloorGrid — the subtle museum "floor" grid. Hidden in presentation mode so
 * beauty shots read as a dark void; self-subscribing so toggling presentation
 * never re-renders the Canvas component itself. The soft shadow-catcher plane
 * (in EngineScene below) always stays.
 */
function FloorGrid() {
  const presentationMode = useSimStore((s) => s.presentationMode);
  if (presentationMode) return null;
  return <gridHelper args={[60, 60, '#2a3340', '#161c24']} position={[0, -2.4, 0]} />;
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

      {/* Subtle museum "floor" grid well below the engine (hidden while
          presenting); the soft shadow plane below it always stays. */}
      <FloorGrid />
      <mesh position={[0, -2.405, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <shadowMaterial transparent opacity={0.34} />
      </mesh>

      <Suspense fallback={null}>
        <EngineModel3D />
      </Suspense>

      {/* Post chain: bloom only lifts genuinely HDR pixels (threshold > 1 —
          igniter sparks, over-temp glow, the bright exhaust core); everything
          tone-mapped normal stays untouched. ACES tone mapping moves to the
          END of the chain (the composer takes over from the renderer). */}
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={0.85} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>

      <PhysicsTicker />
      <CaptureBridge />
      <SectionCut />
    </Canvas>
  );
}

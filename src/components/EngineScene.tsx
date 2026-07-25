/**
 * EngineScene — the R3F <Canvas> and everything inside it.
 *
 * Also home to the single physics "ticker": one useFrame call advances the
 * spool dynamics each frame (frame-rate independent, clamped dt), and every
 * rotating component reads the resulting angle from the store.
 */
import { Suspense, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, DepthOfField, EffectComposer, SSAO, ToneMapping } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect } from 'postprocessing';
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
 * PresentationDepthOfField — shallow focus, PRESENTATION MODE ONLY.
 *
 * A photographic depth falloff is the strongest single cue that separates "a
 * render" from "a photograph of hardware", but it actively destroys an
 * analysis view: a student comparing stage 4 to stage 9 needs both sharp.
 * So it lives exactly where the rest of the cinematic treatment lives — the
 * presentation mode that already hides the overlays, collapses the panels and
 * forces the perspective projection (DoF is meaningless under orthographic).
 *
 * Focus tracks whatever the user is actually looking at: the orbit target.
 * Zoom into the fan and the fan is sharp with the tail falling away; pull out
 * to the hero pose and the whole engine sits inside the focus range.
 */
function PresentationDepthOfField() {
  const presentationMode = useSimStore((s) => s.presentationMode);
  const effect = useRef<DepthOfFieldEffect>(null);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3 } | null;

  useFrame(() => {
    const e = effect.current;
    if (!e) return;
    const target = controls?.target;
    // Distance in METERS from the camera to the orbit pivot.
    e.worldFocusDistance = target
      ? camera.position.distanceTo(target)
      : camera.position.length();
  });

  if (!presentationMode) return null;
  return (
    <DepthOfField
      ref={effect}
      worldFocusDistance={9}
      // Depth kept sharp around the focus point [m]. The engine is ~8 m long,
      // so this holds a module crisp while the far end softens.
      focusRange={3.2}
      bokehScale={2.6}
      resolutionScale={0.75}
    />
  );
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

      {/* Soft shadow-catcher plane well below the engine — grounds it without
          any visible floor (the museum grid was removed). */}
      <mesh position={[0, -2.405, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <shadowMaterial transparent opacity={0.34} />
      </mesh>

      <Suspense fallback={null}>
        <EngineModel3D />
      </Suspense>

      {/* Post chain, in order: AO → bloom → tone map.
          • SSAO darkens contacts and crevices. This engine is entirely nested
            geometry (drums inside cases, blade roots in dovetails, bolt
            circles, hundreds of plumbing greebles) and without contact
            darkening those parts read as shells that happen to intersect
            rather than hardware seated inside hardware. Needs the composer's
            normal pass (one extra geometry pass — full-screen cost, no new
            draw calls against the scene budget).
            luminanceInfluence stays mid-high on purpose: it suppresses AO in
            bright regions, which keeps the additive exhaust plume, fire and
            spark sprites from picking up dark halos.
          • Bloom only lifts genuinely HDR pixels (threshold > 1 — igniter
            sparks, over-temp glow, the bright exhaust core); everything
            tone-mapped normal stays untouched.
          • ACES tone mapping sits at the END of the chain (the composer takes
            over from the renderer). */}
      <EffectComposer multisampling={4} enableNormalPass>
        <SSAO
          blendFunction={BlendFunction.MULTIPLY}
          samples={24}
          rings={5} // not a multiple of samples — avoids banding in the spiral
          radius={0.06} // screen-relative: tight, contact-scale occlusion
          intensity={1.7}
          bias={0.03}
          fade={0.02}
          luminanceInfluence={0.5}
          minRadiusScale={0.15}
          // World-space fade (scene units are meters; the engine spans ~8 m).
          worldDistanceThreshold={14}
          worldDistanceFalloff={6}
          worldProximityThreshold={0.4}
          worldProximityFalloff={0.12}
          resolutionScale={0.75}
          depthAwareUpsampling
        />
        {/* Shallow focus, presentation mode only (see the component). Sits
            after AO — occlusion is a shading term and belongs in the sharp
            image — and before bloom, so out-of-focus highlights bloom as the
            soft discs they've become. */}
        <PresentationDepthOfField />
        <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={0.85} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>

      <PhysicsTicker />
      <CaptureBridge />
      <SectionCut />
    </Canvas>
  );
}

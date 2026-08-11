/**
 * EngineScene — the R3F <Canvas> and everything inside it.
 *
 * Also home to the single physics "ticker": one useFrame call advances the
 * spool dynamics each frame (frame-rate independent, clamped dt), and every
 * rotating component reads the resulting angle from the store.
 */
import { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, SSAO, ToneMapping } from '@react-three/postprocessing';
import { BlendFunction, DepthOfFieldEffect, ToneMappingMode } from 'postprocessing';
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
 * PostChain — the whole post-processing stack, in order: AO → (DoF) → bloom →
 * tone map. It owns the EffectComposer so it can subscribe to presentationMode
 * itself; EngineScene stays a pure structural component that never re-renders
 * on a mode toggle.
 *
 * Order rationale:
 *  • SSAO darkens contacts and crevices. This engine is entirely nested
 *    geometry (drums inside cases, blade roots in dovetails, bolt circles,
 *    hundreds of plumbing greebles) and without contact darkening those parts
 *    read as shells that happen to intersect rather than hardware seated
 *    inside hardware. Needs the composer's normal pass (one extra geometry
 *    pass — full-screen cost, no new draw calls against the scene budget).
 *    luminanceInfluence stays mid-high on purpose: it suppresses AO in bright
 *    regions, keeping the additive plume, fire and sparks free of dark halos.
 *  • Depth of field, PRESENTATION MODE ONLY (see below) — after AO, because
 *    occlusion is a shading term that belongs in the sharp image; before
 *    bloom, so out-of-focus highlights bloom as the soft discs they've become.
 *  • Bloom only lifts genuinely HDR pixels (threshold > 1 — igniter sparks,
 *    over-temp glow, the bright exhaust core).
 *  • ACES tone mapping sits at the END (the composer takes over from the
 *    renderer).
 *
 * WHY DoF IS HAND-BUILT: @react-three/postprocessing's <DepthOfField> wrapper
 * sets a property on `effect.maskPass`, which postprocessing 6.39 no longer
 * exposes — a TypeError thrown during render that unmounts the entire Canvas
 * (a black screen, not a broken blur). Constructing DepthOfFieldEffect
 * directly and mounting it with <primitive> — exactly what the working
 * wrappers do internally — avoids that path completely. The construction is
 * additionally wrapped in try/catch so any future surprise degrades to "no
 * depth of field" instead of taking down the renderer.
 *
 * WHY PRESENTATION ONLY: a photographic depth falloff is the strongest single
 * cue separating "a render" from "a photograph of hardware", and it would
 * wreck an analysis view where a student comparing stage 4 to stage 9 needs
 * both sharp. Presentation mode is also the only mode that forces the
 * perspective projection DoF needs to mean anything.
 */
function PostChain() {
  const presentationMode = useSimStore((s) => s.presentationMode);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3 } | null;

  const dof = useMemo(() => {
    if (!presentationMode) return null;
    try {
      return new DepthOfFieldEffect(camera, {
        worldFocusDistance: 9, // replaced every frame by the tracker below
        // Tuned against the real subject: the engine is ~8 m long, so a tight
        // range plus a big bokeh turned the nose and tail to mush. This holds
        // the bulk of the engine readable and lets only the extremes go soft —
        // a photographic falloff rather than a tilt-shift toy effect.
        focusRange: 6.5, // metres held sharp around the focus point
        bokehScale: 1.3,
        resolutionScale: 0.75,
      });
    } catch (err) {
      console.warn('Depth of field unavailable; continuing without it.', err);
      return null;
    }
  }, [presentationMode, camera]);

  useEffect(() => () => dof?.dispose(), [dof]);

  // Focus follows the orbit pivot, so zooming into the fan keeps the fan crisp
  // with the tail falling away, while the hero pose sits the whole engine
  // inside the focus range.
  useFrame(() => {
    if (!dof) return;
    const target = controls?.target;
    // postprocessing 6.39 ships this setter but omits it from its .d.ts, so
    // the cast is a types gap, not a runtime one (constructor, setter and
    // dispose were all exercised against the real build before shipping).
    (dof as unknown as { worldFocusDistance: number }).worldFocusDistance = target
      ? camera.position.distanceTo(target)
      : camera.position.length();
  });

  // Built as an ARRAY rather than inline JSX: EffectComposer types its
  // children as Element | Element[], which a conditional `... : null` violates.
  const effects = [
    <SSAO
      key="ssao"
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
    />,
    ...(dof ? [<primitive key="dof" object={dof} />] : []),
    <Bloom
      key="bloom"
      mipmapBlur
      luminanceThreshold={1.0}
      luminanceSmoothing={0.2}
      intensity={0.85}
    />,
    <ToneMapping key="tonemap" mode={ToneMappingMode.ACES_FILMIC} />,
  ];

  return (
    // Keyed so the composer fully rebuilds its pass list when DoF comes and
    // goes: EffectComposer collects effects in a layout effect that would not
    // otherwise re-run for a conditional child.
    <EffectComposer key={dof ? 'dof' : 'plain'} multisampling={4} enableNormalPass>
      {effects}
    </EffectComposer>
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

      {/* AO → (DoF in presentation mode) → bloom → tone map. See PostChain. */}
      <PostChain />

      <PhysicsTicker />
      <CaptureBridge />
      <SectionCut />
    </Canvas>
  );
}

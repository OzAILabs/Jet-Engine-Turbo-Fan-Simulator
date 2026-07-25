/**
 * Lighting.tsx
 *
 * Scene lighting for the turbofan cutaway. This is fully offline-safe:
 * we use only built-in three.js lights and NEVER a drei <Environment> /
 * HDR map (those would fetch files from the network).
 *
 * The lighting recipe, from softest to most directional:
 *  - ambientLight        : flat base fill so nothing is pure black.
 *  - hemisphereLight      : sky/ground tint for a natural "outdoor" feel.
 *  - key directionalLight : the main shaping light (warm-neutral white).
 *  - fill directionalLight: a cool light from the opposite side to soften
 *                           shadows without washing the model out.
 *  - warm pointLight       : sits near the combustor / exhaust and glows
 *                           hotter as the engine heats up, so the hot
 *                           section visibly "lights up" during operation.
 *
 * Soft shadows and an offline studio environment give the metal components
 * weight while preserving the readable museum-cutaway presentation.
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { heatFraction } from '../util/colorScale';

export function Lighting() {
  // Ref to the warm combustor/exhaust light so we can drive its intensity
  // from the live engine state each frame.
  const warm = useRef<THREE.PointLight>(null!);

  useFrame(() => {
    // Read engine state non-reactively (this runs every frame; we must not
    // subscribe to it reactively). The hotter the turbine inlet, the more
    // the exhaust region glows.
    const tit = useSimStore.getState().engine.turbineInletTemp;
    warm.current.intensity = 0.5 + 3 * heatFraction(tit);
  });

  return (
    <>
      {/* Low base fill; direct lights and environment reflections do the shaping. */}
      <ambientLight intensity={0.1} />

      {/* Sky tint above, cool dark ground below: gentle outdoor ambience. */}
      <hemisphereLight color="#c5d7ef" groundColor="#15181d" intensity={0.28} />

      {/* Large soft key light: main shaping light from the upper front-right.
          Shadow frustum is fitted to the ENGINE rather than left generous: the
          model's bounding sphere is r ≈ 4.6 m (x −4.2…4.0, radius 1.85) and
          the light sits 16 m out, so ±5 m covers it at any orientation while
          ±7/±6 spent most of the map on empty space. Fitted extents plus a
          4096 map take the shadow texel from ~6.8 mm to ~2.4 mm — fine enough
          to resolve blade and vane shadows instead of smearing them — and the
          tighter near/far lets the depth bias come down accordingly (less
          peter-panning on thin parts). */}
      <directionalLight
        position={[8, 12, 7]}
        intensity={1.55}
        color="#fff8ed"
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-camera-near={9}
        shadow-camera-far={24}
        shadow-bias={-0.0001}
        shadow-normalBias={0.012}
        shadow-radius={4}
      />

      {/* Cool fill from the opposite side to lift the shadow side. */}
      <directionalLight position={[-7, 5, -8]} intensity={0.42} color="#8eaee0" />

      {/* Warm glow near the combustor / exhaust; intensity tracks heat. */}
      <pointLight ref={warm} position={[1.6, 0.4, 0]} color="#ff7a3c" intensity={0.5} />
    </>
  );
}

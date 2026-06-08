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
 * No shadows are enabled anywhere (cheaper, and the cutaway reads more
 * clearly without harsh self-shadowing).
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
      {/* Flat base fill so shadowed faces never go fully black. */}
      <ambientLight intensity={0.5} />

      {/* Sky tint above, cool dark ground below: gentle outdoor ambience. */}
      <hemisphereLight color="#bcd3ff" groundColor="#20242c" intensity={0.6} />

      {/* Key light: main shaping light from the upper front-right. */}
      <directionalLight position={[8, 12, 6]} intensity={1.2} color="#ffffff" />

      {/* Cool fill from the opposite side to lift the shadow side. */}
      <directionalLight position={[-7, 4, -7]} intensity={0.4} color="#88aaff" />

      {/* Warm glow near the combustor / exhaust; intensity tracks heat. */}
      <pointLight ref={warm} position={[1.6, 0.4, 0]} color="#ff7a3c" intensity={0.5} />
    </>
  );
}

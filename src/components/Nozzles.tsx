/**
 * Nozzles — the aft end of the engine where the gas paths finally exit.
 *
 * Three static pieces (no spinning parts here):
 *   1. Core nozzle: a converging metal duct that accelerates the hot core gas.
 *      Its inner surface glows with the exhaust gas temperature (EGT).
 *   2. Center plug (tail cone): the body that fairs out the turbine hub. It sits
 *      in the hottest stream, so it glows brighter than the nozzle wall.
 *   3. Bypass nozzle trailing lip: the ring at the very back of the fan duct
 *      where the cool bypass air leaves the nacelle.
 *
 * The geometry is fixed, but we animate the emissive color/intensity of the two
 * hot parts every frame from the live engine state (no React re-render).
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS, RADII } from '../data/engineLayout';
import { createTube, createCone } from '../geometry/annularSection';
import { temperatureColor } from '../util/colorScale';

export function Nozzles() {
  // Materials we mutate each frame need refs so we can write emissive props.
  const coreMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const plugMatRef = useRef<THREE.MeshStandardMaterial>(null!);

  // --- Core cowl + nozzle: a long convergent duct that is exposed aft of the
  //     fan cowl and tapers from the turbine casing radius to the nozzle exit.
  const coreLength = AXIS.coreNozzleExit - AXIS.coreNozzleStart;
  const coreCenterX = (AXIS.coreNozzleStart + AXIS.coreNozzleExit) / 2;
  const coreGeo = useMemo(
    // rFront (-X) wider, rBack (+X) narrower => convergent core nozzle.
    () => createTube(RADII.coreNozzleOuter, RADII.coreNozzleExit, coreLength, { radialSegments: 72 }),
    [coreLength],
  );

  // --- Center plug (tail cone): long, protrudes well aft of the nozzle exit,
  //     like the polished GE90 exhaust cone. Base matches the nozzle exit.
  const plugLength = AXIS.plugEnd - AXIS.coreNozzleExit;
  const plugCenterX = (AXIS.coreNozzleExit + AXIS.plugEnd) / 2;
  const plugGeo = useMemo(
    () => createCone(RADII.coreNozzleExit * 0.98, plugLength, { radialSegments: 64 }),
    [plugLength],
  );

  // Reused color object so we do not allocate a THREE.Color every frame.
  const tmpColor = useMemo(() => new THREE.Color(), []);

  // Drive the hot-part glow from the live exhaust gas temperature, scaled by
  // how hard the engine is running so it goes cold when shut down.
  useFrame(() => {
    const { engine, spool } = useSimStore.getState();
    temperatureColor(engine.exhaustGasTemp, tmpColor);
    const run = THREE.MathUtils.clamp(spool.n1, 0, 1);

    const coreMat = coreMatRef.current;
    coreMat.emissive.copy(tmpColor);
    coreMat.emissiveIntensity = 0.18 * run;

    const plugMat = plugMatRef.current;
    plugMat.emissive.copy(tmpColor);
    plugMat.emissiveIntensity = 0.4 * run;
  });

  return (
    <group>
      {/* Core nozzle wall (converging, glows with EGT). */}
      <mesh geometry={coreGeo} position={[coreCenterX, 0, 0]}>
        <meshStandardMaterial
          ref={coreMatRef}
          color="#9aa0a8"
          metalness={0.9}
          roughness={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Center plug / tail cone. Cone tip points -X by default, so spin it
          180 deg about Y to face +X (aft). */}
      <mesh geometry={plugGeo} position={[plugCenterX, 0, 0]} rotation={[0, Math.PI, 0]}>
        <meshStandardMaterial
          ref={plugMatRef}
          color="#6b5a48"
          metalness={0.8}
          roughness={0.45}
        />
      </mesh>
    </group>
  );
}

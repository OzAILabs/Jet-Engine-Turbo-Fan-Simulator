/**
 * Combustor — the annular "fire can" between the HP compressor and HP turbine.
 *
 * Geometry (all static — the combustor liner does not rotate):
 *   - an outer liner tube and an inner liner tube, both semi-transparent metal,
 *   - a glowing flame annulus at mid radius whose emissive color tracks the
 *     live turbine-inlet temperature (with a subtle flicker),
 *   - a ring of fuel nozzles poking in through the front (dome) face,
 *   - a ring of small emissive "dilution holes" dotting the outer liner.
 *
 * Live appearance is driven inside useFrame by reading the engine state
 * non-reactively (useSimStore.getState()); we never subscribe to engine numbers
 * here, so the component never re-renders from the simulation loop.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS, RADII } from '../data/engineLayout';
import { createTube } from '../geometry/annularSection';
import { temperatureColor, heatFraction } from '../util/colorScale';

// --- Tunable geometry constants ------------------------------------------
const INNER_LINER_RADIUS = 0.34; // inner liner wall radius [m]
const FLAME_RADIUS = 0.45; // mid-radius of the glowing flame annulus [m]
const NUM_FUEL_NOZZLES = 16;
const FUEL_NOZZLE_RADIUS = 0.5; // radial location of nozzle tips [m]
const NUM_DILUTION_HOLES = 24;

export function Combustor() {
  // Axial extent of the combustor and its center along X.
  const length = AXIS.combustorEnd - AXIS.combustorStart;
  const xCenter = (AXIS.combustorStart + AXIS.combustorEnd) / 2;

  // --- Liner geometries (created once) -----------------------------------
  const outerLinerGeo = useMemo(
    () => createTube(RADII.combustorOuter, RADII.combustorOuter, length),
    [length],
  );
  const innerLinerGeo = useMemo(
    () => createTube(INNER_LINER_RADIUS, INNER_LINER_RADIUS, length),
    [length],
  );
  // The flame annulus is a thin glowing cylinder sitting between the liners.
  const flameGeo = useMemo(
    () => createTube(FLAME_RADIUS, FLAME_RADIUS, length * 0.92),
    [length],
  );

  // --- Liner material (shared by both liners) ----------------------------
  const linerMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#9aa4b0',
        metalness: 0.6,
        roughness: 0.5,
        opacity: 0.5,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );

  // --- Flame material (emissive; updated live in useFrame) ---------------
  const flameMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a0d06',
        emissive: new THREE.Color('#ff5a2b'),
        emissiveIntensity: 1.5,
        metalness: 0,
        roughness: 1,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );

  // --- Fuel nozzle geometry + material (one geometry reused per nozzle) ---
  // Cylinder default axis is +Y; we point it downstream (+X) by rotating each
  // instance, so we keep the geometry centered at the local origin here.
  const nozzleGeo = useMemo(() => new THREE.CylinderGeometry(0.03, 0.03, 0.12, 12), []);
  const nozzleMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#5a6470', metalness: 0.8, roughness: 0.35 }),
    [],
  );

  // --- Dilution hole geometry + material ---------------------------------
  const holeGeo = useMemo(() => new THREE.SphereGeometry(0.025, 10, 8), []);
  const holeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2a1206',
        emissive: new THREE.Color('#ff7a3d'),
        emissiveIntensity: 0.9,
      }),
    [],
  );

  // Precompute fuel-nozzle transforms (position + orientation) around the dome.
  const nozzles = useMemo(() => {
    const out: Array<{ position: [number, number, number]; rotation: [number, number, number] }> = [];
    for (let k = 0; k < NUM_FUEL_NOZZLES; k++) {
      const theta = (k / NUM_FUEL_NOZZLES) * Math.PI * 2;
      const y = Math.cos(theta) * FUEL_NOZZLE_RADIUS;
      const z = Math.sin(theta) * FUEL_NOZZLE_RADIUS;
      // Sit the nozzle just at the front dome, body extending downstream (+X).
      out.push({
        position: [AXIS.combustorStart + 0.06, y, z],
        // Rotate cylinder's +Y axis onto +X so it points downstream.
        rotation: [0, 0, -Math.PI / 2],
      });
    }
    return out;
  }, []);

  // Precompute dilution-hole positions on the outer liner.
  const holes = useMemo(() => {
    const out: Array<[number, number, number]> = [];
    for (let k = 0; k < NUM_DILUTION_HOLES; k++) {
      const theta = (k / NUM_DILUTION_HOLES) * Math.PI * 2;
      // Stagger axially so the holes form a believable band, not a single ring.
      const x = AXIS.combustorStart + length * (0.35 + 0.3 * (k % 2));
      const y = Math.cos(theta) * RADII.combustorOuter;
      const z = Math.sin(theta) * RADII.combustorOuter;
      out.push([x, y, z]);
    }
    return out;
  }, [length]);

  // Reused scratch color so we don't allocate a THREE.Color every frame.
  const flameColor = useRef(new THREE.Color());

  // --- Live flame appearance from the engine's turbine-inlet temperature --
  useFrame((state) => {
    const { engine } = useSimStore.getState();
    const tit = engine.turbineInletTemp;
    temperatureColor(tit, flameColor.current);
    flameMat.emissive.copy(flameColor.current);
    const heat = heatFraction(tit);
    const flicker = 0.9 + 0.1 * Math.sin(state.clock.elapsedTime * 25);
    flameMat.emissiveIntensity = (0.8 + heat * 2) * flicker;
  });

  return (
    <group position={[xCenter, 0, 0]}>
      {/* Outer and inner liner walls (centered at the group origin). */}
      <mesh geometry={outerLinerGeo} material={linerMat} />
      <mesh geometry={innerLinerGeo} material={linerMat} />

      {/* Glowing flame annulus between the liners. */}
      <mesh geometry={flameGeo} material={flameMat} />

      {/* Fuel nozzles entering through the front dome. Positions are world-X
          relative; we subtract xCenter because this group is offset. */}
      {nozzles.map((n, i) => (
        <mesh
          key={`nozzle-${i}`}
          geometry={nozzleGeo}
          material={nozzleMat}
          position={[n.position[0] - xCenter, n.position[1], n.position[2]]}
          rotation={n.rotation}
        />
      ))}

      {/* Dilution holes dotted along the outer liner. */}
      {holes.map((p, i) => (
        <mesh
          key={`hole-${i}`}
          geometry={holeGeo}
          material={holeMat}
          position={[p[0] - xCenter, p[1], p[2]]}
        />
      ))}
    </group>
  );
}

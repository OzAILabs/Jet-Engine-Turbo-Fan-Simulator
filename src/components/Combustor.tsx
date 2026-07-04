/**
 * Combustor — the annular "fire can" between the HP compressor and HP turbine.
 *
 * Geometry (all static — the combustor liner does not rotate):
 *   - an outer liner tube and an inner liner tube in pale thermal-barrier
 *     ceramic (kept semi-transparent so the fire inside stays visible),
 *   - THE FIRE: CombustorFlame — a layered, turbulent, shader-driven flame
 *     volume with real light-off dynamics (ignition burst + light-around from
 *     the igniter positions, pre-light fuel haze, violence scaling with fuel
 *     flow). See CombustorFlame.tsx,
 *   - a ring of fuel nozzles poking in through the front (dome) face,
 *   - a ring of small emissive "dilution holes" dotting the outer liner.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS, RADII } from '../data/engineLayout';
import { CUTAWAY, createTube } from '../geometry/annularSection';
import { createCeramicLinerMaterial } from '../materials/hotSection';
import { CombustorFlame } from './CombustorFlame';

// --- Tunable geometry constants ------------------------------------------
const INNER_LINER_RADIUS = 0.34; // inner liner wall radius [m]
const NUM_FUEL_NOZZLES = 16;
const FUEL_NOZZLE_RADIUS = 0.5; // radial location of nozzle tips [m]
const NUM_DILUTION_HOLES = 24;

export function Combustor() {
  // Axial extent of the combustor and its center along X.
  const length = AXIS.combustorEnd - AXIS.combustorStart;
  const xCenter = (AXIS.combustorStart + AXIS.combustorEnd) / 2;

  // The museum cutaway wedge slices the combustor liners open too, so the
  // fire is seen DIRECTLY through the cut instead of through the shell.
  // (createTube and createLatheAlongX share the same theta convention, so
  // passing CUTAWAY straight in aligns this wedge with the casings'.)
  const cutaway = useSimStore((s) => s.viewMode === 'cutaway');

  // --- Liner geometries (rebuilt only when the cutaway toggles) ----------
  const wedge = cutaway
    ? { thetaStart: CUTAWAY.thetaStart, thetaLength: CUTAWAY.thetaLength }
    : undefined;
  const outerLinerGeo = useMemo(
    () => createTube(RADII.combustorOuter, RADII.combustorOuter, length, wedge),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [length, cutaway],
  );
  const innerLinerGeo = useMemo(
    () => createTube(INNER_LINER_RADIUS, INNER_LINER_RADIUS, length, wedge),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [length, cutaway],
  );
  // --- Liner material (shared by both liners) ----------------------------
  // Pale thermal-barrier-coating ceramic (procedural faint soot mottling);
  // stays semi-transparent so the fire inside remains visible.
  const linerMat = useMemo(() => createCeramicLinerMaterial(), []);

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

  return (
    <group position={[xCenter, 0, 0]}>
      {/* Outer and inner liner walls (centered at the group origin). */}
      <mesh geometry={outerLinerGeo} material={linerMat} />
      <mesh geometry={innerLinerGeo} material={linerMat} />

      {/* THE FIRE: layered turbulent shader flame with real light-off
          dynamics — burst, light-around, pre-light haze, throttle violence. */}
      <CombustorFlame length={length} />

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

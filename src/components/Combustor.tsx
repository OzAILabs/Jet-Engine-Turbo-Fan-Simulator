/**
 * Combustor — the annular "fire can" between the HP compressor and HP turbine.
 *
 * Geometry (all static — the combustor liner does not rotate):
 *   - an outer liner tube and an inner liner tube in pale thermal-barrier
 *     ceramic (kept semi-transparent so the fire inside stays visible),
 *   - a FAINT flame annulus at mid radius — base incandescence only — plus one
 *     InstancedMesh of flame POCKETS at the fuel-nozzle clock positions whose
 *     per-instance scale flickers with the live fuel flow: dark when unlit,
 *     igniting at light-off, roaring toward takeoff fuel flow,
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
import { temperatureColor } from '../util/colorScale';
import { createCeramicLinerMaterial, createFlamePocketMaterial } from '../materials/hotSection';

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
  // The flame annulus is a thin cylinder sitting between the liners — now only
  // a faint base incandescence beneath the discrete flame pockets.
  const flameGeo = useMemo(
    () => createTube(FLAME_RADIUS, FLAME_RADIUS, length * 0.92),
    [length],
  );

  // --- Liner material (shared by both liners) ----------------------------
  // Pale thermal-barrier-coating ceramic (procedural faint soot mottling);
  // stays semi-transparent so the fire inside remains visible.
  const linerMat = useMemo(() => createCeramicLinerMaterial(), []);

  // --- Flame material (emissive; updated live in useFrame) ---------------
  // KEPT from the old uniform flame tube, but demoted: 16 discrete pockets
  // alone read as beads at glancing angles, so a low-intensity fill sells a
  // continuous primary zone. Boots at 0 — the engine is cold and dark.
  const flameMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a0d06',
        emissive: new THREE.Color('#ff5a2b'),
        emissiveIntensity: 0,
        metalness: 0,
        roughness: 1,
        transparent: true,
        opacity: 0,
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

  // --- Flame pockets: one squashed ellipsoid instance per fuel nozzle ------
  // One InstancedMesh + one emissive-driven material; rewriting <=16 instance
  // matrices per frame is the accepted budget for the flicker.
  const pocketGeo = useMemo(() => {
    const g = new THREE.SphereGeometry(0.055, 12, 10);
    g.scale(2.3, 0.7, 0.7); // squashed along the radial/tangential axes → axial tongue of flame
    return g;
  }, []);
  const pocketMat = useMemo(() => createFlamePocketMaterial(), []);
  const pocketRef = useRef<THREE.InstancedMesh>(null!);
  const pocketDummy = useMemo(() => new THREE.Object3D(), []);
  // Static placement (primary zone, just downstream of the nozzle tips, at the
  // 16 nozzle clock positions) + a golden-angle phase so no two pockets ever
  // flicker in sync.
  const pockets = useMemo(() => {
    const out: Array<{ x: number; y: number; z: number; phase: number }> = [];
    for (let k = 0; k < NUM_FUEL_NOZZLES; k++) {
      const theta = (k / NUM_FUEL_NOZZLES) * Math.PI * 2;
      out.push({
        x: AXIS.combustorStart + 0.2 + 0.05 * Math.sin(k * 2.399) - xCenter,
        y: Math.cos(theta) * FLAME_RADIUS,
        z: Math.sin(theta) * FLAME_RADIUS,
        phase: k * 2.399,
      });
    }
    return out;
  }, [xCenter]);

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

  // --- Live flame appearance ----------------------------------------------
  // The fire is driven by the FUEL, not the metal temperature: dark when
  // unlit, dim kernels at light-off (startSeq.lit), roaring at takeoff fuel
  // flow. Gate on `lit` — the HMU meters ~0.14 kg/s BEFORE light-off, which
  // must not paint flames. Color still tracks Tt4 so the flame whitens as
  // turbine-inlet temperature climbs.
  useFrame((state) => {
    const { engine, instruments, startSeq, config } = useSimStore.getState();
    const tit = engine.turbineInletTemp;
    temperatureColor(tit, flameColor.current);
    const lit = startSeq.lit;
    const fuelFrac = lit ? Math.min(instruments.fuelFlowKgs / config.takeoffFuelFlow, 1) : 0;
    const t = state.clock.elapsedTime;

    // Faint base incandescence (the old uniform tube, demoted): fills the
    // annulus between the discrete pockets at glancing angles.
    flameMat.emissive.copy(flameColor.current);
    flameMat.emissiveIntensity = lit ? (0.15 + 0.55 * fuelFrac) * (0.92 + 0.08 * Math.sin(t * 25)) : 0;
    flameMat.opacity = lit ? 0.12 + 0.22 * fuelFrac : 0;

    // Flame pockets: whole-mesh emissive from fuel flow; per-instance scale
    // flicker from two incommensurate sines (13.7 / 8.31 rad/s) with
    // golden-angle phases — cheap, and the pattern never visibly repeats.
    pocketMat.emissive.copy(flameColor.current);
    pocketMat.emissiveIntensity = lit ? 1.1 + 2.6 * fuelFrac : 0;
    const mesh = pocketRef.current;
    if (mesh) {
      if (mesh.instanceMatrix.usage !== THREE.DynamicDrawUsage) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      }
      for (let i = 0; i < NUM_FUEL_NOZZLES; i++) {
        const p = pockets[i];
        const flick = 0.7 + 0.3 * Math.sin(t * 13.7 + p.phase) * Math.sin(t * 8.31 + p.phase * 1.7);
        const s = lit ? (0.4 + 0.85 * fuelFrac) * flick : 1e-4;
        pocketDummy.position.set(p.x, p.y, p.z);
        pocketDummy.scale.setScalar(s);
        pocketDummy.updateMatrix();
        mesh.setMatrixAt(i, pocketDummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group position={[xCenter, 0, 0]}>
      {/* Outer and inner liner walls (centered at the group origin). */}
      <mesh geometry={outerLinerGeo} material={linerMat} />
      <mesh geometry={innerLinerGeo} material={linerMat} />

      {/* Faint base flame annulus between the liners. */}
      <mesh geometry={flameGeo} material={flameMat} />

      {/* Irregular flame pockets at the fuel-nozzle clock positions. Culling is
          off: instance matrices are rewritten every frame and the geometry's
          static bounding sphere sits at the group origin. */}
      <instancedMesh
        ref={pocketRef}
        args={[pocketGeo, pocketMat, NUM_FUEL_NOZZLES]}
        frustumCulled={false}
      />

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

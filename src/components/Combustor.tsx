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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimStore } from '../store/useSimStore';
import { AXIS, RADII } from '../data/engineLayout';
import { CUTAWAY, createLatheAlongX, createTube } from '../geometry/annularSection';
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

  // --- Dome + fuel stems (what the nozzles/swirlers MOUNT to) -------------
  // The annular front wall of the fire can: nozzles and swirlers bolt through
  // it, and each nozzle's fuel stem runs radially out through the dome rim
  // toward the case (where the external manifold pigtails arrive). Without
  // this plate the swirler hardware read as floating in mid-air. The dome
  // respects the cutaway wedge exactly like the liners (same lathe
  // convention); the 16 stems stay full-annulus like the nozzles do.
  const domeGeo = useMemo(() => {
    const x0 = AXIS.combustorStart - xCenter;
    const parts: THREE.BufferGeometry[] = [
      // Washer with real thickness, revolved with the liners' theta wedge.
      createLatheAlongX(
        [
          [x0, INNER_LINER_RADIUS],
          [x0 + 0.025, INNER_LINER_RADIUS],
          [x0 + 0.025, RADII.combustorOuter],
          [x0, RADII.combustorOuter],
          [x0, INNER_LINER_RADIUS],
        ],
        wedge ? { segments: 64, ...wedge } : { segments: 64 },
      ),
    ];
    for (let k = 0; k < NUM_FUEL_NOZZLES; k++) {
      const theta = (k / NUM_FUEL_NOZZLES) * Math.PI * 2;
      const stemLen = RADII.combustorOuter - FUEL_NOZZLE_RADIUS + 0.02;
      const stem = new THREE.CylinderGeometry(0.014, 0.014, stemLen, 8);
      stem.translate(0, FUEL_NOZZLE_RADIUS + stemLen / 2 - 0.01, 0);
      stem.rotateX(theta);
      stem.translate(x0 + 0.045, 0, 0);
      parts.push(stem);
    }
    const merged = mergeGeometries(parts)!;
    parts.forEach((g) => g.dispose());
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutaway]);
  const domeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#5d6066',
        metalness: 0.8,
        roughness: 0.5,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // --- Swirlers + dual-orifice tips (ONE merged mesh for all 16) ----------
  // The flame isn't held by magic: each fuel nozzle exits through a SWIRLER —
  // a ring of pitched vanes that spins the incoming air into a recirculating
  // vortex anchoring combustion — around a dual-orifice atomizer tip. Collar
  // + 8 pitched vanes + tip cone per nozzle, merged: +1 draw call total.
  const swirlerGeo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const tipX = AXIS.combustorStart + 0.125 - xCenter;
    for (let k = 0; k < NUM_FUEL_NOZZLES; k++) {
      const theta = (k / NUM_FUEL_NOZZLES) * Math.PI * 2;
      const y = Math.cos(theta) * FUEL_NOZZLE_RADIUS;
      const z = Math.sin(theta) * FUEL_NOZZLE_RADIUS;
      const collar = new THREE.CylinderGeometry(0.065, 0.075, 0.035, 16, 1, true);
      collar.rotateZ(-Math.PI / 2); // axis → +X (downstream)
      collar.translate(tipX, y, z);
      parts.push(collar);
      for (let v = 0; v < 8; v++) {
        const a = (v / 8) * Math.PI * 2;
        // Vane: chord along X, span radial (+Y before ring placement), thin in
        // Z; pitched about its RADIAL axis for the swirl angle, then swung to
        // its ring slot about the nozzle axis and planted on the collar.
        const vane = new THREE.BoxGeometry(0.026, 0.032, 0.006);
        vane.rotateY(0.65); // the swirl pitch
        vane.translate(0, 0.048, 0);
        vane.rotateX(a);
        vane.translate(tipX, y, z);
        parts.push(vane);
      }
      const tip = new THREE.ConeGeometry(0.017, 0.034, 10);
      tip.rotateZ(-Math.PI / 2); // point downstream
      tip.translate(tipX + 0.025, y, z);
      parts.push(tip);
    }
    const merged = mergeGeometries(parts)!;
    parts.forEach((g) => g.dispose());
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const swirlerMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#4a4c50', metalness: 0.85, roughness: 0.45 }),
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

      {/* Dome (the front wall the burner hardware mounts to) + fuel stems. */}
      <mesh geometry={domeGeo} material={domeMat} castShadow={false} />

      {/* Swirler vanes + atomizer tips at every fuel-nozzle exit. */}
      <mesh geometry={swirlerGeo} material={swirlerMat} castShadow={false} />

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

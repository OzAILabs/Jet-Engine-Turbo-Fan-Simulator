/**
 * HarnessAndSensors.tsx — the engine's electronic nervous system: FADEC,
 * wiring harness trunks, and the sensors they feed.
 *
 *   - ECU: the dual-channel FADEC (channels A + B), a flat ribbed box mounted
 *     on four elastomer vibration-isolator studs standing off the right-hand
 *     fan case (ALF ~2:00), where bypass air keeps the electronics cool. Two
 *     rows of circular electrical connectors crowd its aft edge.
 *   - Harness trunks: convoluted-conduit bundles leaving the ECU shelf and
 *     running aft along both sides of the core (clock 2:30 and 9:30), hugging
 *     the case silhouette — dipping inward over the HPC, climbing again over
 *     the LPT flare — secured every ~0.7 m by half-ring P-clamps.
 *   - Branch drops: thinner conduits peeling off the right-hand trunk to the
 *     VSV actuator, fuel manifolds, starter air valve, ignition exciter lead
 *     and the EGT system.
 *   - EGT harness ring: a thermocouple ring main around the LPT case feeding
 *     eight radial probe bosses (station 4.5 gas-path thermocouples).
 *   - N1/N2 speed-probe fairings: two teardrop bumps on the fan frame.
 *
 * Performance: ≤10 draw calls — merged tube/box geometry wherever the parts
 * share a material, one InstancedMesh each for P-clamps and EGT bosses
 * (visible-first instance order so cutaway mode just lowers `count`).
 * Only the ECU box casts a shadow.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimStore } from '../../store/useSimStore';
import { CUTAWAY } from '../../geometry/annularSection';
import {
  EXTERNALS,
  TUBE_COLORS,
  clockToYZ,
  coreCaseRadiusAt,
  visibleInCutaway,
} from '../../data/engineLayout';

const ECU = EXTERNALS.ecu;
const EGT = EXTERNALS.egtHarnessRing;
const TRUNK_HOURS = EXTERNALS.harnessTrunks.map((t) => t.clock); // [2.5, 9.5]
const RIGHT_TRUNK = TRUNK_HOURS[0]; // 2.5 — the trunk that owns the branch drops

/** Conduit radii [m]: main trunks vs. thin branch drops. */
const TRUNK_R = 0.02;
const BRANCH_R = 0.01;
/** Trunk standoff above the core-case skin [m]. */
const TRUNK_STANDOFF = 0.06;

/** ALF clock hour → angle around +X [rad] (the clockToYZ convention). */
const phiOf = (hour: number) => (hour / 12) * Math.PI * 2;

/** Scene-space point at axial x, ALF clock hour, radius r. */
function v3At(x: number, hour: number, r: number): THREE.Vector3 {
  const { y, z } = clockToYZ(hour, r);
  return new THREE.Vector3(x, y, z);
}

// --- Path builders ---------------------------------------------------------

/**
 * One harness trunk: down the fan case from the ECU shelf, through the
 * fan-frame strut region, then aft riding coreCaseRadiusAt(x) + standoff —
 * the dip over the HPC and the climb over the LPT come straight from the
 * case profile.
 */
function buildTrunkGeometry(hour: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [
    v3At(-2.8, hour, 1.58), // leaves the ECU shelf on the fan case
    v3At(-2.55, hour, 1.42),
    v3At(-2.25, hour, 0.95), // drops through the fan-frame strut region
  ];
  for (let x = -2.0; x <= 2.01; x += 0.25) {
    // The trunk hops OVER rings it would otherwise skewer at its cruising
    // standoff: the two fuel-manifold tori (x 0.18 / 0.38, bands up to
    // case+0.10) and the EGT ring main (x 1.58, band to case+0.066) all live
    // in the trunk's 0.04–0.08 radial band — real conduits are clamped over
    // such obstructions, so we lift the affected spline samples.
    const overManifolds = x > -0.05 && x < 0.55 ? 0.06 : 0;
    const overEgtRing = Math.abs(x - 1.58) < 0.25 ? 0.05 : 0;
    pts.push(v3At(x, hour, coreCaseRadiusAt(x) + TRUNK_STANDOFF + Math.max(overManifolds, overEgtRing)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, TRUNK_R, 8, false);
}

/** Branch drops off the right-hand (2:30) trunk: where they tap in and land. */
interface BranchSpec {
  x0: number; // tap point on the trunk
  x1: number; // landing x
  h1: number; // landing clock hour
  rEnd: number; // landing standoff above the case skin
}
const BRANCHES: BranchSpec[] = [
  // VSV actuator (right-hand unit): lands INSIDE the raised barrel's radial
  // band (case+0.068…0.132) at its aft end — not floating beneath it.
  { x0: -1.02, x1: -0.86, h1: 4.0, rEnd: 0.115 },
  // Ignition exciter feed: wraps the belly all the way to the near exciter
  // box (clock 7.25, body band case+0.005…0.105) — it used to die at 5.3
  // with nothing within a meter of arc.
  { x0: -1.42, x1: -1.52, h1: 7.25, rEnd: 0.06 },
  // Fuel staging-valve solenoids: approaches from FORWARD of the pilot ring
  // and stays above the pigtail lattice, landing on the valve block's
  // forward-top face (x 0.23…0.33 band) — the old run began inside the
  // pilot manifold torus and ended in mid-air among the pigtails.
  { x0: -0.2, x1: 0.23, h1: 4.5, rEnd: 0.105 },
  // Starter air valve: into the canted SAV box (x 0.37…0.49, r ≈ 0.11…0.21)
  // instead of passing underneath it at case+0.05.
  { x0: 0.3, x1: 0.45, h1: 5.7, rEnd: 0.15 },
  { x0: 1.44, x1: EGT.x, h1: RIGHT_TRUNK, rEnd: EGT.rOffset }, // EGT ring junction
];

/** All five branch conduits merged into a single geometry (one draw call). */
function buildBranchGeometry(): THREE.BufferGeometry {
  const geos = BRANCHES.map(({ x0, x1, h1, rEnd }) => {
    const pts: THREE.Vector3[] = [];
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = THREE.MathUtils.lerp(x0, x1, t);
      const hour = THREE.MathUtils.lerp(RIGHT_TRUNK, h1, t);
      // A small mid-run lift keeps the wrap from clipping into the case.
      const lift = Math.sin(t * Math.PI) * 0.02;
      const r = coreCaseRadiusAt(x) + THREE.MathUtils.lerp(TRUNK_STANDOFF, rEnd, t) + lift;
      pts.push(v3At(x, hour, r));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, BRANCH_R, 6, false);
  });
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}

// --- ECU pieces (built in the ECU's local frame: +X aft, +Y radially out) ---

/** Flat FADEC chassis + its cooling ribs, merged (one dark-box draw call). */
function buildEcuBoxGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(ECU.w, ECU.d, ECU.h)];
  const ribCount = 7;
  for (let i = 0; i < ribCount; i++) {
    const z = -ECU.h / 2 + 0.05 + (i * (ECU.h - 0.1)) / (ribCount - 1);
    const rib = new THREE.BoxGeometry(ECU.w - 0.06, 0.018, 0.016);
    rib.translate(0, ECU.d / 2 + 0.008, z); // ribs run fore-aft on the outer face
    parts.push(rib);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

/** Four elastomer vibration-isolator studs under the chassis corners. */
function buildStudGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const stud = new THREE.CylinderGeometry(0.013, 0.018, 0.07, 8);
      stud.translate(sx * (ECU.w / 2 - 0.07), -ECU.d / 2 - 0.035, sz * (ECU.h / 2 - 0.07));
      parts.push(stud);
    }
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

/** Two connector rows (channel A / channel B decks) on the aft edge. */
function buildConnectorGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const y of [-0.026, 0.026]) {
    for (const z of [-0.135, -0.045, 0.045, 0.135]) {
      const conn = new THREE.CylinderGeometry(0.017, 0.017, 0.05, 10);
      conn.rotateZ(-Math.PI / 2); // cylinder axis → +X, plugs point aft
      conn.translate(ECU.w / 2 + 0.018, y, z);
      parts.push(conn);
    }
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

// --- Sensors ----------------------------------------------------------------

/** N1/N2 speed-probe fairings: teardrop bumps half-buried in the fan frame. */
function buildFairingGeometry(): THREE.BufferGeometry {
  const x = -2.1;
  const rCase = coreCaseRadiusAt(x);
  const parts = [5, 7].map((hour) => {
    const bump = new THREE.SphereGeometry(1, 14, 10);
    bump.scale(0.1, 0.032, 0.05); // long fore-aft, low — a faired probe housing
    bump.translate(0, rCase, 0);
    bump.rotateX(-phiOf(hour)); // swing the bump to its clock position
    bump.translate(x, 0, 0);
    return bump;
  });
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

/** P-clamp axial stations along each trunk's core-case run. */
const CLAMP_XS = [-1.8, -1.2, -0.5, 0.2, 0.9, 1.6];

/** EGT probe boss clock positions, visible-in-cutaway hours sorted first. */
const EGT_BOSS_HOURS = (() => {
  const hours = Array.from({ length: 8 }, (_, k) => 0.75 + k * 1.5);
  return [...hours.filter(visibleInCutaway), ...hours.filter((h) => !visibleInCutaway(h))];
})();
const EGT_BOSS_VISIBLE = EGT_BOSS_HOURS.filter(visibleInCutaway).length;

const dummy = new THREE.Object3D();

export function HarnessAndSensors() {
  // Only the view mode changes how this hardware is drawn.
  const viewMode = useSimStore((s) => s.viewMode);
  const cutaway = viewMode === 'cutaway';

  const clampRef = useRef<THREE.InstancedMesh>(null!);
  const bossRef = useRef<THREE.InstancedMesh>(null!);

  // --- Materials (created once) --------------------------------------------
  const conduitMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(TUBE_COLORS.wiringConduit),
        metalness: 0.35,
        roughness: 0.55,
      }),
    [],
  );
  const boxMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3f47'), metalness: 0.4, roughness: 0.6 }),
    [],
  );
  const bracketMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a9099'), metalness: 0.7, roughness: 0.45 }),
    [],
  );
  const brassMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a96a'), metalness: 0.8, roughness: 0.35 }),
    [],
  );

  // --- Geometries (created once) -------------------------------------------
  const ecuBoxGeo = useMemo(buildEcuBoxGeometry, []);
  const ecuStudGeo = useMemo(buildStudGeometry, []);
  const ecuConnGeo = useMemo(buildConnectorGeometry, []);
  const trunkGeos = useMemo(() => TRUNK_HOURS.map(buildTrunkGeometry), []);
  const branchGeo = useMemo(buildBranchGeometry, []);
  const fairingGeo = useMemo(buildFairingGeometry, []);

  // P-clamp: a half-ring saddle straddling the conduit, opening toward the case.
  const clampGeo = useMemo(() => {
    const geo = new THREE.TorusGeometry(0.03, 0.009, 6, 12, Math.PI);
    geo.rotateY(Math.PI / 2); // ring axis → +X; arc wraps over local +Y (outboard)
    return geo;
  }, []);

  // Thermocouple boss: a stubby cylinder penetrating the LPT case radially.
  const bossGeo = useMemo(() => new THREE.CylinderGeometry(0.014, 0.018, 0.1, 10), []);

  // EGT ring main: full torus, plus a partial arc matched to the case cutaway.
  const egtRingRadius = coreCaseRadiusAt(EGT.x) + EGT.rOffset;
  const egtRingFullGeo = useMemo(
    () => {
      const geo = new THREE.TorusGeometry(egtRingRadius, 0.016, 8, 64);
      geo.rotateY(Math.PI / 2); // ring encircles the +X axis
      return geo;
    },
    [egtRingRadius],
  );
  const egtRingCutGeo = useMemo(() => {
    const geo = new THREE.TorusGeometry(egtRingRadius, 0.016, 8, 48, CUTAWAY.thetaLength);
    // Torus angle α maps to lathe θ via α = θ + π, so offset the arc start to
    // make the retained sweep line up exactly with the cutaway case wedge.
    geo.rotateZ(CUTAWAY.thetaStart + Math.PI);
    geo.rotateY(Math.PI / 2);
    return geo;
  }, [egtRingRadius]);

  // --- Instance layout: P-clamps (right trunk first, so cutaway = lower count)
  useLayoutEffect(() => {
    const mesh = clampRef.current;
    if (!mesh) return;
    let i = 0;
    for (const hour of TRUNK_HOURS) {
      for (const x of CLAMP_XS) {
        dummy.position.copy(v3At(x, hour, coreCaseRadiusAt(x) + TRUNK_STANDOFF));
        dummy.rotation.set(-phiOf(hour), 0, 0); // local +Y → radially outboard
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.count = cutaway ? CLAMP_XS.length : i; // the 9:30 trunk hides in cutaway
    mesh.instanceMatrix.needsUpdate = true;
  }, [cutaway, viewMode]);

  // --- Instance layout: EGT probe bosses (visible-in-cutaway hours first) ---
  useLayoutEffect(() => {
    const mesh = bossRef.current;
    if (!mesh) return;
    const rCase = coreCaseRadiusAt(EGT.x);
    EGT_BOSS_HOURS.forEach((hour, i) => {
      dummy.position.copy(v3At(EGT.x, hour, rCase + 0.02));
      dummy.rotation.set(-phiOf(hour), 0, 0); // cylinder axis → radial
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = cutaway ? EGT_BOSS_VISIBLE : EGT_BOSS_HOURS.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [cutaway, viewMode]);

  // Hidden in exploded view, like the other external hardware.
  if (viewMode === 'exploded') return null;

  const ecuPos = clockToYZ(ECU.clock, ECU.r);
  const showEcu = !cutaway || visibleInCutaway(ECU.clock); // 2:00 survives the wedge

  return (
    <group>
      {/* FADEC ECU on its vibration isolators (the only shadow-caster here). */}
      {showEcu && (
        <group position={[ECU.x, ecuPos.y, ecuPos.z]} rotation={[-phiOf(ECU.clock), 0, 0]}>
          <mesh geometry={ecuBoxGeo} material={boxMat} castShadow />
          <mesh geometry={ecuStudGeo} material={bracketMat} castShadow={false} />
          <mesh geometry={ecuConnGeo} material={brassMat} castShadow={false} />
        </group>
      )}

      {/* Harness trunks — the 9:30 trunk falls inside the cutaway wedge. */}
      {TRUNK_HOURS.map((hour, i) =>
        cutaway && !visibleInCutaway(hour) ? null : (
          <mesh key={hour} geometry={trunkGeos[i]} material={conduitMat} castShadow={false} />
        ),
      )}

      {/* P-clamps pinning the trunks to the case (one InstancedMesh). */}
      <instancedMesh
        ref={clampRef}
        args={[clampGeo, bracketMat, TRUNK_HOURS.length * CLAMP_XS.length]}
        frustumCulled={false}
        castShadow={false}
      />

      {/* Branch conduits off the right-hand trunk (merged: one draw call). */}
      <mesh geometry={branchGeo} material={conduitMat} castShadow={false} />

      {/* EGT thermocouple ring main around the LPT case. */}
      <mesh
        geometry={cutaway ? egtRingCutGeo : egtRingFullGeo}
        material={conduitMat}
        position={[EGT.x, 0, 0]}
        castShadow={false}
      />

      {/* Eight radial thermocouple probe bosses (one InstancedMesh). */}
      <instancedMesh
        ref={bossRef}
        args={[bossGeo, bracketMat, EGT_BOSS_HOURS.length]}
        frustumCulled={false}
        castShadow={false}
      />

      {/* N1/N2 speed-probe fairings on the fan frame (both survive the cutaway). */}
      <mesh geometry={fairingGeo} material={bracketMat} castShadow={false} />
    </group>
  );
}

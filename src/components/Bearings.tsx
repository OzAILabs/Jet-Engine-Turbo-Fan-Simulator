/**
 * Bearings.tsx — LIVE main-shaft bearings: races, rolling elements, oil jets.
 *
 * Shafts.tsx draws the three static support frames; this component draws what
 * actually lives inside each frame's hub. Every bearing is three layers:
 *
 *   - OUTER race: pressed into the frame hub, so it is STATIC. In cutaway it
 *     is rebuilt as a partial arc matching the case wedge — which conveniently
 *     exposes the rolling elements underneath, museum-style.
 *   - INNER race: pressed onto its shaft, so it spins at shaft speed. The fan
 *     frame, mid-forward and turbine-rear bearings ride the LP shaft
 *     (spool.lpAngle); the mid-aft bearing rides the HP drum (spool.hpAngle).
 *     Spinning parts stay FULL rings even in cutaway — a world-fixed wedge
 *     can't be baked into a rotating part (the gap would spin with it).
 *   - ROLLING ELEMENTS in a cage orbiting at the true epicyclic rate,
 *     ω_cage = ω_inner · rᵢ/(rᵢ+rₒ) ≈ 0.46–0.48 of the inner race (outer race
 *     held) — the classic "cage runs at just under half shaft speed". The
 *     No. 1 fan-frame bearing is the BALL (thrust) bearing: point contact
 *     carries the fan's axial load, so it gets spheres. The other three are
 *     cylindrical ROLLERS aligned along X (line contact, radial load only).
 *     Simplification: the real No. 3 intershaft bearing's outer race turns
 *     with the HP drum; ours stays static for legibility.
 *
 * OIL: each bearing gets small jets (clock hours from engineLayout) spraying
 * from just outboard-forward into the race gap. Stream length + opacity, and
 * a faint amber emissive tint on the races, ramp with
 * instruments.oilPressurePsi — a dry engine shows nothing, full effect above
 * OIL_PRESSURE_FULL_PSI (30 psi; idle sits well above that).
 *
 * Visibility follows the frames in Shafts.tsx: bearings are shaft-to-case
 * guts, so only 'transparent' and 'cutaway' show them; null in 'full'
 * (buried inside opaque casings) and 'exploded' (their frames are hidden and
 * they'd float meaninglessly).
 *
 * Perf: 8 draw calls — merged outer races (1), merged LP inner races (1), HP
 * inner race (1), one InstancedMesh of rolling elements per bearing (4), one
 * InstancedMesh for every oil jet (1). Per frame we write two spin-group
 * angles, four cage angles and two material scalars; the jet matrices only
 * recompose while the oil pressure is actually changing.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimStore } from '../store/useSimStore';
import {
  BEARINGS,
  BEARING_OIL_JET_CLOCKS,
  BEARING_OIL_JET_OFFSET,
  OIL_PRESSURE_FULL_PSI,
  SPOOL_SPIN_SIGN,
  clockToYZ,
  visibleInCutaway,
  type BearingSpec,
} from '../data/engineLayout';
import { CUTAWAY } from '../geometry/annularSection';

// Module-level scratch objects — never allocated inside useFrame/layout loops.
const dummy = new THREE.Object3D();
const UP = new THREE.Vector3(0, 1, 0);

/** Radius of the inner race's rolling surface (race centerline + tube). */
const innerContactR = (b: BearingSpec): number => b.rInner + b.raceTube;
/** Radius of the outer race's rolling surface (race centerline − tube). */
const outerContactR = (b: BearingSpec): number => b.rOuter - b.raceTube;
/** Pitch radius — the circle the rolling-element centers ride. */
const pitchR = (b: BearingSpec): number => (innerContactR(b) + outerContactR(b)) / 2;

/**
 * Cage orbit rate as a fraction of inner-race rate, outer race fixed — real
 * epicyclic kinematics: ω_cage/ω_inner = rᵢ/(rᵢ+rₒ). ≈ 0.46–0.48 here.
 */
const CAGE_RATIOS: number[] = BEARINGS.map(
  (b) => innerContactR(b) / (innerContactR(b) + outerContactR(b)),
);

/** Upper bound for the jets InstancedMesh (cutaway may show fewer). */
const MAX_JETS = BEARINGS.length * BEARING_OIL_JET_CLOCKS.length;

/**
 * A race torus encircling +X at station x. Torus angle α maps to the lathe
 * cutaway θ via α = θ + π (same trick as the EGT ring in HarnessAndSensors),
 * so a partial arc lines up exactly with the CUTAWAY case wedge.
 */
function raceTorus(r: number, tube: number, x: number, cutawayArc: boolean): THREE.BufferGeometry {
  const geo = cutawayArc
    ? new THREE.TorusGeometry(r, tube, 10, 48, CUTAWAY.thetaLength)
    : new THREE.TorusGeometry(r, tube, 10, 48);
  if (cutawayArc) geo.rotateZ(Math.PI + CUTAWAY.thetaStart);
  geo.rotateY(Math.PI / 2); // ring into the Y–Z plane (axis along +X)
  geo.translate(x, 0, 0);
  return geo;
}

/** Per-jet placement, computed once per layout pass. */
interface JetSeed {
  /** Nozzle mouth (stream base). */
  pos: THREE.Vector3;
  /** Unit direction toward the race gap. */
  dir: THREE.Vector3;
  /** Full stream length at 100% oil pressure. */
  len: number;
}

export function Bearings() {
  // Same rule as the frames in Shafts.tsx: bearings are shaft-to-case guts,
  // shown only while the case is present but see-through. viewMode is the one
  // reactive subscription; everything live is read via getState() in useFrame.
  const viewMode = useSimStore((s) => s.viewMode);
  const show =
    viewMode === 'transparent' || viewMode === 'cutaway' || viewMode === 'internals';
  const cutaway = viewMode === 'cutaway';

  const lpSpinRef = useRef<THREE.Group>(null);
  const hpSpinRef = useRef<THREE.Group>(null);
  const cageRefs = useRef<Array<THREE.Group | null>>([]);
  const elementRefs = useRef<Array<THREE.InstancedMesh | null>>([]);
  const jetsRef = useRef<THREE.InstancedMesh>(null);
  const jetSeeds = useRef<JetSeed[]>([]);
  const lastOil = useRef(-1); // last applied oil fraction (forces first update)

  // --- STATIC outer races: one merged geometry. Partial arc in cutaway so the
  // wedge slices them like every other static case-side part.
  const outerGeo = useMemo(() => {
    const parts = BEARINGS.map((b) => raceTorus(b.rOuter, b.raceTube, b.x, cutaway));
    const merged = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    return merged;
  }, [cutaway]);
  // This is the one geometry that gets rebuilt at runtime (cutaway toggles) —
  // drop the old GPU buffers instead of leaking them.
  useEffect(() => () => outerGeo.dispose(), [outerGeo]);

  // --- SPINNING inner races, merged per owning spool: rotating the parent
  // group about X spins every torus in place (they're all centered on the
  // axis), so each spool costs ONE rotation write + ONE draw call.
  const lpInnerGeo = useMemo(() => {
    const parts = BEARINGS.filter((b) => b.spool === 'lp').map((b) =>
      raceTorus(b.rInner, b.raceTube, b.x, false),
    );
    const merged = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    return merged;
  }, []);
  const hpInnerGeo = useMemo(() => {
    const parts = BEARINGS.filter((b) => b.spool === 'hp').map((b) =>
      raceTorus(b.rInner, b.raceTube, b.x, false),
    );
    const merged = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    return merged;
  }, []);

  // --- Rolling elements: SPHERES for the No. 1 thrust BALL bearing,
  // X-aligned CYLINDERS for the roller bearings.
  const elementGeos = useMemo(
    () =>
      BEARINGS.map((b) => {
        if (b.kind === 'ball') return new THREE.SphereGeometry(b.elementR, 12, 10);
        const g = new THREE.CylinderGeometry(b.elementR, b.elementR, b.elementLen, 10);
        g.rotateZ(Math.PI / 2); // cylinder axis +Y → +X (axial rollers)
        return g;
      }),
    [],
  );

  // Unit-length spray cone: base (−Y end) at the nozzle, tip (+Y end) at the
  // impact point; a per-instance Y scale stretches it to the stream length.
  const jetGeo = useMemo(() => new THREE.ConeGeometry(0.006, 1, 6), []);

  // --- Materials -----------------------------------------------------------
  // One shared race material (outer + both inner meshes): polished steel with
  // a hot-oil amber emissive whose intensity ramps with oil pressure.
  const raceMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#c9d2dc',
        metalness: 0.95,
        roughness: 0.2,
        emissive: new THREE.Color('#e8981f'),
        emissiveIntensity: 0,
      }),
    [],
  );
  const elementMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#eef2f6', metalness: 1.0, roughness: 0.15 }),
    [],
  );
  const oilMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffb347',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  // --- Instance layout: rolling elements, laid out ONCE around each pitch
  // circle in cage-local space (the cage group provides position + spin).
  // Elements stay full-circle in cutaway for the same reason as the inner
  // races: they orbit, so a fixed wedge can't apply.
  useLayoutEffect(() => {
    BEARINGS.forEach((b, i) => {
      const mesh = elementRefs.current[i];
      if (!mesh) return; // not mounted in this view mode
      const rp = pitchR(b);
      for (let k = 0; k < b.count; k++) {
        const a = (k / b.count) * Math.PI * 2;
        dummy.position.set(0, rp * Math.cos(a), rp * Math.sin(a));
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, [show]);

  // --- Instance layout: oil jets. Nozzles sit just outboard-forward of each
  // bearing at fixed clock hours and aim at the race gap (pitch radius). In
  // cutaway, jets whose clock falls inside the removed wedge are skipped via
  // visibleInCutaway, like every other per-clock hardware item.
  useLayoutEffect(() => {
    const mesh = jetsRef.current;
    if (!mesh) return; // not mounted in this view mode
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // rescaled while oil ramps
    const seeds: JetSeed[] = [];
    for (const b of BEARINGS) {
      for (const hour of BEARING_OIL_JET_CLOCKS) {
        if (cutaway && !visibleInCutaway(hour)) continue; // wedge removed it
        const n = clockToYZ(hour, b.rOuter + BEARING_OIL_JET_OFFSET.radial);
        const t = clockToYZ(hour, pitchR(b));
        const pos = new THREE.Vector3(b.x - BEARING_OIL_JET_OFFSET.axial, n.y, n.z);
        const delta = new THREE.Vector3(b.x, t.y, t.z).sub(pos);
        const len = delta.length();
        seeds.push({ pos, dir: delta.multiplyScalar(1 / len), len });
      }
    }
    jetSeeds.current = seeds;
    mesh.count = seeds.length;
    lastOil.current = -1; // force a matrix refresh on the next frame
  }, [cutaway, show]);

  // --- Per-frame drive: spool spin, cage orbits, oil ramp (all getState()).
  useFrame(() => {
    const lp = lpSpinRef.current;
    if (!lp) return; // hidden in this view mode (component returned null)
    const { spool, instruments } = useSimStore.getState();

    // Inner races ride their shafts...
    lp.rotation.x = SPOOL_SPIN_SIGN * spool.lpAngle;
    const hp = hpSpinRef.current;
    if (hp) hp.rotation.x = SPOOL_SPIN_SIGN * spool.hpAngle;
    // ...and each cage orbits at its epicyclic fraction of the inner race.
    BEARINGS.forEach((b, i) => {
      const cage = cageRefs.current[i];
      if (!cage) return;
      const angle = b.spool === 'lp' ? spool.lpAngle : spool.hpAngle;
      cage.rotation.x = SPOOL_SPIN_SIGN * angle * CAGE_RATIOS[i];
    });

    // Oil: hidden dry, full at/above OIL_PRESSURE_FULL_PSI.
    const oil = Math.min(Math.max(instruments.oilPressurePsi / OIL_PRESSURE_FULL_PSI, 0), 1);
    raceMat.emissiveIntensity = 0.35 * oil; // faint hot-oil sheen on the races
    oilMat.opacity = 0.85 * oil;
    const jets = jetsRef.current;
    if (!jets) return;
    jets.visible = oil > 0.02;
    if (jets.visible && oil !== lastOil.current) {
      lastOil.current = oil;
      const grow = 0.25 + 0.75 * oil; // streams lengthen as pressure builds
      jetSeeds.current.forEach((seed, k) => {
        const len = seed.len * grow;
        dummy.quaternion.setFromUnitVectors(UP, seed.dir); // cone +Y → spray dir
        dummy.position.copy(seed.dir).multiplyScalar(len / 2).add(seed.pos);
        dummy.scale.set(1, len, 1); // unit cone stretched to the stream length
        dummy.updateMatrix();
        jets.setMatrixAt(k, dummy.matrix);
      });
      jets.instanceMatrix.needsUpdate = true;
    }
  });

  if (!show) return null;

  return (
    <group>
      {/* STATIC outer races, seated in the Shafts.tsx frame hubs (partial arc
          in cutaway — peek through the gap at the rollers). */}
      <mesh geometry={outerGeo} material={raceMat} castShadow={false} frustumCulled={false} />

      {/* SPINNING inner races — one group per spool, one rotation write each. */}
      <group ref={lpSpinRef}>
        <mesh geometry={lpInnerGeo} material={raceMat} castShadow={false} frustumCulled={false} />
      </group>
      <group ref={hpSpinRef}>
        <mesh geometry={hpInnerGeo} material={raceMat} castShadow={false} frustumCulled={false} />
      </group>

      {/* Rolling-element cages: one InstancedMesh per bearing inside a group
          whose rotation.x is the cage (orbit) angle. No. 1 gets balls (thrust);
          the rest get axial cylinders (rollers). */}
      {BEARINGS.map((b, i) => (
        <group
          key={b.id}
          position={[b.x, 0, 0]}
          ref={(g) => {
            cageRefs.current[i] = g;
          }}
        >
          <instancedMesh
            args={[elementGeos[i], elementMat, b.count]}
            ref={(m) => {
              elementRefs.current[i] = m;
            }}
            castShadow={false}
            frustumCulled={false}
          />
        </group>
      ))}

      {/* Oil jets — every stream in one InstancedMesh; opacity + length ramp
          with oil pressure in useFrame (starts hidden: engine boots dry). */}
      <instancedMesh
        ref={jetsRef}
        args={[jetGeo, oilMat, MAX_JETS]}
        visible={false}
        castShadow={false}
        frustumCulled={false}
      />
    </group>
  );
}

/**
 * Turbine module: HP turbine (HPT) followed by LP turbine (LPT), plus the
 * tapering core drum that the rotor disks ride on.
 *
 * Physics-for-students notes:
 *   - The HPT is driven by the very hot gas leaving the combustor; it extracts
 *     work to spin the HP spool (which drives the HPC). It runs hottest, so we
 *     tint its emissive glow with the turbine-inlet temperature (Tt4).
 *   - The LPT sits downstream, where the gas is cooler and lower-pressure. Its
 *     blades grow taller stage-by-stage to keep doing work on the expanding gas;
 *     it drives the LP spool (fan + booster). We tint it with the exhaust-gas
 *     temperature (EGT, Tt5), and keep its glow dimmer than the HPT.
 *   - The drum REALLY rotates: it is split at AXIS.hptEnd into an HP-driven
 *     front section and an LP-driven rear section (the LPT drives the fan
 *     shaft), each in a group whose rotation.x is written every frame from the
 *     live spool angles (same non-reactive pattern as BladeRow). Instanced
 *     disk rims at each rotor station make the spin readable in the cutaway.
 *
 * Each turbine "stage" is a rotor row preceded by a stationary nozzle-guide-vane
 * (NGV) stator row that re-aims the flow into the next rotor. Rotors spin with
 * their spool ('hp' or 'lp'); stators pass spin={null}.
 *
 * Performance: every blade row of a given module reuses ONE geometry + ONE
 * material, and the heat glow is animated by mutating the (single) HPT and LPT
 * materials inside useFrame -- never via React re-renders.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { BladeRow } from './BladeRow';
import { AXIS, RADII } from '../data/engineLayout';
import { createTube } from '../geometry/annularSection';
import { createTurbineBladeGeometry } from '../geometry/turbineBladeGeometry';
import { temperatureColor, heatFraction } from '../util/colorScale';
import { lerp } from '../sim/units';

/** Blade counts per row (NGV stators are typically a bit denser than rotors). */
const HPT_ROTOR_COUNT = 54;
const HPT_STATOR_COUNT = 60;
const LPT_ROTOR_COUNT = 70;
const LPT_STATOR_COUNT = 76;

/** Drum surface radius at axial x — the flaring profile 0.40 → 0.50. */
const drumRadiusAt = (x: number): number =>
  lerp(0.4, 0.5, (x - AXIS.hptStart) / (AXIS.lptEnd - AXIS.hptStart));

/** How far the disk rims stand proud of the drum surface [m]. */
const RIM_LIP = 0.012;

/** Sub-idle rotor rumble amplitude [m] (~1.5 mm — visible jiggle, not a bounce). */
const RUMBLE_AMP = 0.0015;

/**
 * Irregular sub-idle rumble: a sum of incommensurate sines, active ONLY while
 * the HP spool is between barely-turning and ~50% — i.e. during start and
 * shutdown — and exactly zero at rest and at/above idle (idle N2 = 0.66).
 */
function subIdleJitter(t: number, n2: number): number {
  if (n2 <= 0.001 || n2 >= 0.5) return 0;
  return (
    RUMBLE_AMP *
    (0.5 * Math.sin(37.0 * t) + 0.3 * Math.sin(61.3 * t + 1.7) + 0.2 * Math.sin(23.7 * t + 4.1))
  );
}

const dummy = new THREE.Object3D();

/**
 * One InstancedMesh of thin disk rims (tori) — one rim per rotor stage, sitting
 * proud of the drum so the drum's rotation is readable. The base torus has
 * radius 1 and is scaled per instance to each stage's rim radius. Parent the
 * whole mesh inside the spinning drum group; it costs ONE draw call.
 */
function DiskRims({
  xs,
  radii,
  material,
}: {
  xs: number[];
  radii: number[];
  material: THREE.Material;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  // Unit-radius ring in the Y–Z plane (axis along +X); tube ≈ 0.018 m once scaled.
  const geo = useMemo(() => {
    const g = new THREE.TorusGeometry(1, 0.04, 8, 48);
    g.rotateY(Math.PI / 2);
    return g;
  }, []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    for (let i = 0; i < xs.length; i++) {
      dummy.position.set(xs[i], 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(radii[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [xs, radii]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geo, material, xs.length]}
      castShadow={false}
      frustumCulled={false}
    />
  );
}

/** One stage description so we can build the geometry once and place rows. */
interface StageGeo {
  /** Centered turbine-blade geometry for this stage's rotor + stator. */
  geometry: THREE.BufferGeometry;
  /** Axial center of the stage [m]. */
  x: number;
}

export function Turbine() {
  const { hptStages, lptStages } = useSimStore.getState().config;

  // --- Core drum (rotating disk stack) --------------------------------------
  // One gently flaring profile (0.40 at hptStart → 0.50 at lptEnd, matching the
  // disk growth), but built as TWO tubes split at hptEnd because the halves
  // belong to DIFFERENT spools: HPT drum = HP, LPT drum = LP (drives the fan).
  const hptDrumGeometry = useMemo(
    () => createTube(drumRadiusAt(AXIS.hptStart), drumRadiusAt(AXIS.hptEnd), AXIS.hptEnd - AXIS.hptStart),
    [],
  );
  const lptDrumGeometry = useMemo(
    () => createTube(drumRadiusAt(AXIS.hptEnd), drumRadiusAt(AXIS.lptEnd), AXIS.lptEnd - AXIS.hptEnd),
    [],
  );
  const hptDrumCenterX = (AXIS.hptStart + AXIS.hptEnd) / 2;
  const lptDrumCenterX = (AXIS.hptEnd + AXIS.lptEnd) / 2;

  // The two spinning drum groups, driven non-reactively in useFrame below.
  const hptDrumGroup = useRef<THREE.Group>(null!);
  const lptDrumGroup = useRef<THREE.Group>(null!);

  // --- Materials ------------------------------------------------------------
  // Two heat-stressed metal materials -- one per turbine module so we can tint
  // each independently. We keep refs to them and mutate emissive in useFrame.
  const hptMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#6b4a3a',
        metalness: 0.6,
        roughness: 0.55,
        emissive: new THREE.Color('#ff5a2b'),
        emissiveIntensity: 1.0,
      }),
    [],
  );
  const lptMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#6b4a3a',
        metalness: 0.6,
        roughness: 0.55,
        emissive: new THREE.Color('#ff7847'),
        emissiveIntensity: 0.5,
      }),
    [],
  );
  // The drum (and its rims) share the HPT-side glow but stay metallic/dim.
  const drumMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#5a4536',
        metalness: 0.7,
        roughness: 0.5,
        emissive: new THREE.Color('#ff5a2b'),
        emissiveIntensity: 0.25,
      }),
    [],
  );

  // Scratch colors so useFrame allocates nothing per frame.
  const hptColor = useRef(new THREE.Color());
  const lptColor = useRef(new THREE.Color());

  // --- HPT stage geometries -------------------------------------------------
  // Small, hottest blades. growth 0.0 -> 0.2 across the (2) stages.
  const hptStageGeos = useMemo<StageGeo[]>(() => {
    const stages: StageGeo[] = [];
    const span = AXIS.hptEnd - AXIS.hptStart;
    const slot = span / hptStages; // axial width per stage
    for (let i = 0; i < hptStages; i++) {
      const t = hptStages > 1 ? i / (hptStages - 1) : 0;
      const growth = lerp(0.0, 0.2, t);
      const geometry = createTurbineBladeGeometry({
        hubRadius: 0.4,
        tipRadius: RADII.hptOuter, // 0.6
        growth,
      });
      // Center of stage i within [hptStart, hptEnd].
      const x = AXIS.hptStart + slot * (i + 0.5);
      stages.push({ geometry, x });
    }
    return stages;
  }, [hptStages]);

  // --- LPT stage geometries -------------------------------------------------
  // Larger, growing blades. growth 0.3 -> 1.0; hub 0.45 -> 0.50; tip up to 0.78.
  const lptStageGeos = useMemo<StageGeo[]>(() => {
    const stages: StageGeo[] = [];
    const span = AXIS.lptEnd - AXIS.lptStart;
    const slot = span / lptStages;
    for (let i = 0; i < lptStages; i++) {
      const t = lptStages > 1 ? i / (lptStages - 1) : 0;
      const growth = lerp(0.3, 1.0, t);
      const hubRadius = lerp(0.45, 0.5, t);
      // Flares from the HPT-exit radius (~0.60) out to the big last-stage tip,
      // giving the LPT its distinctive growing rear cone.
      const tipRadius = lerp(0.6, RADII.lptOuter, t); // 0.60 -> 0.88
      const geometry = createTurbineBladeGeometry({ hubRadius, tipRadius, growth });
      const x = AXIS.lptStart + slot * (i + 0.5);
      stages.push({ geometry, x });
    }
    return stages;
  }, [lptStages]);

  // --- Disk-rim stations ------------------------------------------------------
  // One rim per rotor row (2 HPT + 6 LPT), just proud of the drum surface.
  const hptRims = useMemo(() => {
    const xs = hptStageGeos.map((s) => s.x);
    return { xs, radii: xs.map((x) => drumRadiusAt(x) + RIM_LIP) };
  }, [hptStageGeos]);
  const lptRims = useMemo(() => {
    const xs = lptStageGeos.map((s) => s.x);
    return { xs, radii: xs.map((x) => drumRadiusAt(x) + RIM_LIP) };
  }, [lptStageGeos]);

  // --- Heat glow + drum spin animation ---------------------------------------
  useFrame(({ clock }) => {
    const { engine, spool } = useSimStore.getState();

    // HPT glows with the turbine-inlet temperature (hottest in the engine).
    const tit = engine.turbineInletTemp;
    temperatureColor(tit, hptColor.current);
    hptMaterial.emissive.copy(hptColor.current);
    hptMaterial.emissiveIntensity = 1.0 + heatFraction(tit);
    // Drum follows the same hot color but stays subdued.
    drumMaterial.emissive.copy(hptColor.current);
    drumMaterial.emissiveIntensity = 0.2 + 0.4 * heatFraction(tit);

    // LPT glows with the exhaust-gas temperature; kept dimmer than the HPT.
    const egt = engine.exhaustGasTemp;
    temperatureColor(egt, lptColor.current);
    lptMaterial.emissive.copy(lptColor.current);
    lptMaterial.emissiveIntensity = 0.5 + 0.6 * heatFraction(egt);

    // HPT drum rides the HP spool; LPT drum rides the LP spool. Plus a tiny
    // start/shutdown rumble on both (zero at rest and at/above idle).
    hptDrumGroup.current.rotation.x = spool.hpAngle;
    lptDrumGroup.current.rotation.x = spool.lpAngle;
    const jitter = subIdleJitter(clock.elapsedTime, spool.n2);
    hptDrumGroup.current.position.y = jitter;
    lptDrumGroup.current.position.y = jitter;
  });

  return (
    <group>
      {/* HPT drum + disk rims — spins with the HP spool. */}
      <group ref={hptDrumGroup}>
        <mesh geometry={hptDrumGeometry} material={drumMaterial} position={[hptDrumCenterX, 0, 0]} />
        <DiskRims xs={hptRims.xs} radii={hptRims.radii} material={drumMaterial} />
      </group>

      {/* LPT drum + disk rims — spins with the LP spool (drives the fan shaft). */}
      <group ref={lptDrumGroup}>
        <mesh geometry={lptDrumGeometry} material={drumMaterial} position={[lptDrumCenterX, 0, 0]} />
        <DiskRims xs={lptRims.xs} radii={lptRims.radii} material={drumMaterial} />
      </group>

      {/* HP turbine: per stage, an NGV stator immediately ahead of the rotor. */}
      {hptStageGeos.map((stage, i) => {
        const span = AXIS.hptEnd - AXIS.hptStart;
        const slot = span / hptStages;
        const statorX = stage.x - slot * 0.3; // NGV sits just upstream of rotor
        return (
          <group key={`hpt-${i}`}>
            <BladeRow
              geometry={stage.geometry}
              material={hptMaterial}
              count={HPT_STATOR_COUNT}
              x={statorX}
              spin={null}
              phase={Math.PI / HPT_STATOR_COUNT}
            />
            <BladeRow
              geometry={stage.geometry}
              material={hptMaterial}
              count={HPT_ROTOR_COUNT}
              x={stage.x}
              spin="hp"
            />
          </group>
        );
      })}

      {/* LP turbine: same stator-then-rotor layout, growing blades. */}
      {lptStageGeos.map((stage, i) => {
        const span = AXIS.lptEnd - AXIS.lptStart;
        const slot = span / lptStages;
        const statorX = stage.x - slot * 0.3;
        return (
          <group key={`lpt-${i}`}>
            <BladeRow
              geometry={stage.geometry}
              material={lptMaterial}
              count={LPT_STATOR_COUNT}
              x={statorX}
              spin={null}
              phase={Math.PI / LPT_STATOR_COUNT}
            />
            <BladeRow
              geometry={stage.geometry}
              material={lptMaterial}
              count={LPT_ROTOR_COUNT}
              x={stage.x}
              spin="lp"
            />
          </group>
        );
      })}
    </group>
  );
}

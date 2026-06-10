/**
 * Compressor.tsx — the booster (low-pressure compressor / LPC) and the
 * high-pressure compressor (HPC) of the core.
 *
 * Teaching points wired into the visuals:
 *   - The booster spins with the LP spool (same shaft as the fan), the HPC
 *     spins with the much faster HP spool. Each blade row is a BladeRow that
 *     drives its own spin from the live spool angle, so we never re-render.
 *   - The rotor DRUM under the blades really rotates too. It is split at the
 *     booster/HPC boundary: the front piece is LP-driven, the rear piece is
 *     HP-driven, each wrapped in a group whose rotation.x is written every
 *     frame from the live spool angle (same non-reactive pattern as BladeRow).
 *     Instanced disk rims ride on each drum at the rotor-row stations so the
 *     spin actually reads through the cutaway.
 *   - Air is squeezed into an ever-smaller annulus as it moves rearward, so
 *     the blades get progressively shorter and stubbier (rising "compactness").
 *   - A surge is when the compressor stalls and airflow breaks down. We fake a
 *     warning glow: when the live surge margin drops low, the rotor blades
 *     flush red. We share ONE rotor material across every rotor row, so a
 *     single emissive tweak per frame lights them all up at once.
 *
 * Coordinate system: engine axis is +X (inlet at -X). Blade geometries are
 * centered at the local origin and span radially along +Y; BladeRow places a
 * row at an axial X and instances + spins the blades for us.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS } from '../data/engineLayout';
import { createCompressorBladeGeometry } from '../geometry/compressorBladeGeometry';
import { createTube } from '../geometry/annularSection';
import { BladeRow } from './BladeRow';
import { lerp } from '../sim/units';

/** Blade counts per row (kept constant within a section for one shared geo). */
const BOOSTER_BLADE_COUNT = 38;
const HPC_BLADE_COUNT = 46;

/** Tiny axial gap so an interleaved stator sits just behind its rotor. */
const STATOR_OFFSET = 0.06;

/**
 * The booster (LPC) rotor rows are packed into the AFT part of the LPC casing,
 * not the whole [lpcStart, lpcEnd] span. This frees ~0.36 m at the front of the
 * core — just behind the fan — to mount the large fan Outlet Guide Vanes (OGVs,
 * built in Fan.tsx) in FRONT of the first booster rotor, without lengthening the
 * engine. The rotating core drum and the static casing still begin at
 * AXIS.lpcStart, so the OGVs have a surface to sit over.
 */
const BOOSTER_ROTOR_FRONT = AXIS.lpcStart + 0.36; // ≈ -2.09

/** Where the LP-driven booster drum hands over to the HP-driven HPC drum. */
const DRUM_SPLIT_X = (AXIS.lpcEnd + AXIS.hpcStart) / 2; // ≈ -1.30

/** Drum surface radius at axial x — the shared frustum profile 0.50 → 0.34. */
const drumRadiusAt = (x: number): number =>
  lerp(0.5, 0.34, (x - AXIS.lpcStart) / (AXIS.hpcEnd - AXIS.lpcStart));

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
  // Unit-radius ring in the Y–Z plane (axis along +X); tube ≈ 0.016 m once scaled.
  const geo = useMemo(() => {
    const g = new THREE.TorusGeometry(1, 0.04, 8, 48);
    g.rotateY(Math.PI / 2);
    return g;
  }, []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
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

export function Compressor() {
  // --- Core drum under the blades ----------------------------------------
  // One frustum profile (r=0.50 at lpcStart down to r=0.34 at hpcEnd), but
  // built as TWO tubes split at the booster/HPC boundary because the two
  // halves belong to DIFFERENT spools: booster drum = LP, HPC drum = HP.
  const boosterDrumGeo = useMemo(
    () => createTube(drumRadiusAt(AXIS.lpcStart), drumRadiusAt(DRUM_SPLIT_X), DRUM_SPLIT_X - AXIS.lpcStart),
    [],
  );
  const hpcDrumGeo = useMemo(
    () => createTube(drumRadiusAt(DRUM_SPLIT_X), drumRadiusAt(AXIS.hpcEnd), AXIS.hpcEnd - DRUM_SPLIT_X),
    [],
  );
  const boosterDrumCenterX = (AXIS.lpcStart + DRUM_SPLIT_X) / 2;
  const hpcDrumCenterX = (DRUM_SPLIT_X + AXIS.hpcEnd) / 2;
  const drumMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#8893a3', metalness: 0.9, roughness: 0.35 }),
    [],
  );

  // The two spinning drum groups, driven non-reactively in useFrame below.
  const boosterDrumGroup = useRef<THREE.Group>(null!);
  const hpcDrumGroup = useRef<THREE.Group>(null!);

  // --- Shared materials ---------------------------------------------------
  // Rotors share ONE material so a single emissive write drives the surge
  // glow on every rotor row across both the booster and the HPC.
  const rotorMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#95a0b0', metalness: 0.85, roughness: 0.3 }),
    [],
  );
  const statorMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#6f7785', metalness: 0.7, roughness: 0.45 }),
    [],
  );

  // --- Booster (LPC) blade geometries ------------------------------------
  // 4 rotor rows packed into the aft LPC span (see BOOSTER_ROTOR_FRONT). The tip
  // radius TAPERS 0.61 -> 0.54 front-to-rear so the blades ride ~0.03 m inside
  // the tapering core casing (coreLpcOuter 0.67 -> 0.56) instead of poking
  // through it — and so the core annulus visibly narrows as the air compresses.
  // compactness also ramps 0.0 -> 0.4 to stubbify the airfoils. One geometry per
  // stage index, reused by that stage's rotor and its interleaved stator.
  const boosterStages = useSimStore.getState().config.boosterStages; // 4
  const boosterGeos = useMemo(() => {
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < boosterStages; i++) {
      const t = boosterStages > 1 ? i / (boosterStages - 1) : 0;
      geos.push(
        createCompressorBladeGeometry({
          hubRadius: 0.42,
          tipRadius: lerp(0.61, 0.54, t),
          compactness: lerp(0.0, 0.4, t),
        }),
      );
    }
    return geos;
  }, [boosterStages]);

  // --- HPC blade geometries ----------------------------------------------
  // 9 rotor rows over [hpcStart, hpcEnd]; compactness ramps 0.45 -> 1.0 (very
  // stubby late stages), hub grows 0.36 -> 0.40, tip shrinks 0.50 -> 0.42 as
  // the annulus closes down.
  const hpcStages = useSimStore.getState().config.hpcStages; // 9
  const hpcGeos = useMemo(() => {
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < hpcStages; i++) {
      const t = hpcStages > 1 ? i / (hpcStages - 1) : 0;
      geos.push(
        createCompressorBladeGeometry({
          hubRadius: lerp(0.36, 0.4, t),
          tipRadius: lerp(0.5, 0.42, t),
          compactness: lerp(0.45, 1.0, t),
        }),
      );
    }
    return geos;
  }, [hpcStages]);

  // Even axial spacing helpers for the rotor rows of each section.
  const boosterX = (i: number) =>
    boosterStages > 1
      ? lerp(BOOSTER_ROTOR_FRONT, AXIS.lpcEnd, i / (boosterStages - 1))
      : (BOOSTER_ROTOR_FRONT + AXIS.lpcEnd) / 2;
  const hpcX = (i: number) =>
    hpcStages > 1
      ? lerp(AXIS.hpcStart, AXIS.hpcEnd, i / (hpcStages - 1))
      : (AXIS.hpcStart + AXIS.hpcEnd) / 2;

  // --- Disk-rim stations ----------------------------------------------------
  // One rim per rotor row, just proud of the drum surface at that station.
  const boosterRims = useMemo(() => {
    const xs: number[] = [];
    const radii: number[] = [];
    for (let i = 0; i < boosterStages; i++) {
      const x = boosterX(i);
      xs.push(x);
      radii.push(drumRadiusAt(x) + RIM_LIP);
    }
    return { xs, radii };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boosterStages]);
  const hpcRims = useMemo(() => {
    const xs: number[] = [];
    const radii: number[] = [];
    for (let i = 0; i < hpcStages; i++) {
      const x = hpcX(i);
      xs.push(x);
      radii.push(drumRadiusAt(x) + RIM_LIP);
    }
    return { xs, radii };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hpcStages]);

  // --- Per-frame animation --------------------------------------------------
  // Surge glow: read the live surge margin (0-100) each frame and push the
  // rotor material toward red as it falls below ~25. Drum spin: write the live
  // spool angles straight onto the drum groups (no React re-render). Sub-idle
  // start/shutdown rumble: a ~1.5 mm vertical jiggle on the spinning drums.
  const glowColor = useRef(new THREE.Color());
  useFrame(({ clock }) => {
    const { surgeMargin, spool } = useSimStore.getState();
    const intensity = Math.max(0, (25 - surgeMargin) / 25) * 0.6;
    glowColor.current.setRGB(intensity, 0, 0);
    rotorMat.emissive.copy(glowColor.current);
    rotorMat.emissiveIntensity = intensity;

    // Booster drum rides the LP spool; HPC drum rides the (faster) HP spool.
    boosterDrumGroup.current.rotation.x = spool.lpAngle;
    hpcDrumGroup.current.rotation.x = spool.hpAngle;
    const jitter = subIdleJitter(clock.elapsedTime, spool.n2);
    boosterDrumGroup.current.position.y = jitter;
    hpcDrumGroup.current.position.y = jitter;
  });

  return (
    <group>
      {/* Booster drum + disk rims — spins with the LP spool. */}
      <group ref={boosterDrumGroup}>
        <mesh geometry={boosterDrumGeo} material={drumMat} position={[boosterDrumCenterX, 0, 0]} />
        <DiskRims xs={boosterRims.xs} radii={boosterRims.radii} material={drumMat} />
      </group>

      {/* HPC drum + disk rims — spins with the HP spool. */}
      <group ref={hpcDrumGroup}>
        <mesh geometry={hpcDrumGeo} material={drumMat} position={[hpcDrumCenterX, 0, 0]} />
        <DiskRims xs={hpcRims.xs} radii={hpcRims.radii} material={drumMat} />
      </group>

      {/* Booster (LPC): LP-driven rotor rows + interleaved stators. */}
      {boosterGeos.map((geo, i) => {
        const x = boosterX(i);
        return (
          <group key={`booster-${i}`}>
            <BladeRow
              geometry={geo}
              material={rotorMat}
              count={BOOSTER_BLADE_COUNT}
              x={x}
              spin="lp"
            />
            {/* Stator sits just behind the rotor, staggered angularly. */}
            <BladeRow
              geometry={geo}
              material={statorMat}
              count={BOOSTER_BLADE_COUNT}
              x={x + STATOR_OFFSET}
              spin={null}
              phase={Math.PI / BOOSTER_BLADE_COUNT}
            />
          </group>
        );
      })}

      {/* HPC: HP-driven rotor rows + interleaved stators. */}
      {hpcGeos.map((geo, i) => {
        const x = hpcX(i);
        return (
          <group key={`hpc-${i}`}>
            <BladeRow
              geometry={geo}
              material={rotorMat}
              count={HPC_BLADE_COUNT}
              x={x}
              spin="hp"
            />
            <BladeRow
              geometry={geo}
              material={statorMat}
              count={HPC_BLADE_COUNT}
              x={x + STATOR_OFFSET}
              spin={null}
              phase={Math.PI / HPC_BLADE_COUNT}
            />
          </group>
        );
      })}
    </group>
  );
}

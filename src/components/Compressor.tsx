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
 *     Machined rotor disks (bore/web/rim — shared RotorDisks component) ride
 *     inside each drum at the rotor-row stations, with a drive cone tying the
 *     drum to its shaft, so the spin reads as one connected rotor.
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
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS, ROTOR, SPOOL_SPIN_SIGN } from '../data/engineLayout';
import { createCompressorBladeGeometry } from '../geometry/compressorBladeGeometry';
import { createTube } from '../geometry/annularSection';
import { createBrushedTitaniumMaterial } from '../materials/coldSection';
import { BladeRow } from './BladeRow';
import { RotorDisks } from './RotorDisks';
import { subIdleJitter } from './rotorShared';
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

export function Compressor() {
  // Internals drive-train view: blade rows hide, drums/disks/cones stay.
  const internals = useSimStore((s) => s.viewMode === 'internals');

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
  // Brushed-titanium drum skin (procedural streak roughnessMap; shared with
  // RotorDisks so the disk stack reads as the same machined metal).
  const drumMat = useMemo(() => createBrushedTitaniumMaterial({ color: '#8893a3', roughness: 0.35 }), []);

  // The two spinning drum groups, driven non-reactively in useFrame below.
  const boosterDrumGroup = useRef<THREE.Group>(null!);
  const hpcDrumGroup = useRef<THREE.Group>(null!);

  // --- Shared materials ---------------------------------------------------
  // Rotors share ONE material so a single emissive write drives the surge
  // glow on every rotor row across both the booster and the HPC.
  // Brushed titanium (factory emissive starts BLACK — the per-frame surge
  // write below keeps mutating rotorMat.emissive / emissiveIntensity as-is).
  const rotorMat = useMemo(
    () => createBrushedTitaniumMaterial({ color: '#b9c2cc', roughness: 0.32, metalness: 0.9 }),
    [],
  );
  const statorMat = useMemo(
    () => createBrushedTitaniumMaterial({ color: '#6f7785', roughness: 0.45, metalness: 0.7 }),
    [],
  );

  // Even axial spacing helpers for the rotor rows of each section. Declared
  // BEFORE the blade-geometry memos: each stage now roots its blades at the
  // LOCAL drum surface, so the geometry builders need boosterX/hpcX.
  const boosterStages = useSimStore.getState().config.boosterStages; // 4
  const hpcStages = useSimStore.getState().config.hpcStages; // 9
  const boosterX = (i: number) =>
    boosterStages > 1
      ? lerp(BOOSTER_ROTOR_FRONT, AXIS.lpcEnd, i / (boosterStages - 1))
      : (BOOSTER_ROTOR_FRONT + AXIS.lpcEnd) / 2;
  const hpcX = (i: number) =>
    hpcStages > 1
      ? lerp(AXIS.hpcStart, AXIS.hpcEnd, i / (hpcStages - 1))
      : (AXIS.hpcStart + AXIS.hpcEnd) / 2;

  // Blade roots sink a hair BELOW the local drum skin so no root ever floats
  // above the tapering drum (the old fixed hub radii left the late-HPC roots
  // hovering ~0.06 m clear of it). Tip radii are untouched — clearance-tuned.
  const HUB_EMBED = 0.015;

  // --- Booster (LPC) blade geometries ------------------------------------
  // 4 rotor rows packed into the aft LPC span (see BOOSTER_ROTOR_FRONT). The tip
  // radius TAPERS 0.61 -> 0.54 front-to-rear so the blades ride ~0.03 m inside
  // the tapering core casing (coreLpcOuter 0.67 -> 0.56) instead of poking
  // through it — and so the core annulus visibly narrows as the air compresses.
  // compactness also ramps 0.0 -> 0.4 to stubbify the airfoils. One geometry per
  // stage index, reused by that stage's rotor and its interleaved stator.
  const boosterGeos = useMemo(() => {
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < boosterStages; i++) {
      const t = boosterStages > 1 ? i / (boosterStages - 1) : 0;
      geos.push(
        createCompressorBladeGeometry({
          hubRadius: drumRadiusAt(boosterX(i)) - HUB_EMBED,
          tipRadius: lerp(0.61, 0.54, t),
          compactness: lerp(0.0, 0.4, t),
        }),
      );
    }
    return geos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boosterStages]);

  // --- HPC blade geometries ----------------------------------------------
  // 9 rotor rows over [hpcStart, hpcEnd]; compactness ramps 0.45 -> 1.0 (very
  // stubby late stages), tip shrinks 0.50 -> 0.42 as the annulus closes down.
  // Hub radius now follows the drum skin at each stage station.
  const hpcGeos = useMemo(() => {
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < hpcStages; i++) {
      const t = hpcStages > 1 ? i / (hpcStages - 1) : 0;
      geos.push(
        createCompressorBladeGeometry({
          hubRadius: drumRadiusAt(hpcX(i)) - HUB_EMBED,
          tipRadius: lerp(0.5, 0.42, t),
          compactness: lerp(0.45, 1.0, t),
        }),
      );
    }
    return geos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hpcStages]);

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

  // Drive cones tying each drum to its shaft so drum + disks + shaft read as
  // ONE rotating structure: the booster's FRONT disk reaches forward down to
  // the LP shaft (toward the fan-frame bearing); the HPC's REAR disk reaches
  // aft down to the HP shaft (under the combustor, toward the mid bearing).
  // Both render inside their spinning drum groups below.
  const boosterCones = useMemo(
    () => [{ diskX: boosterRims.xs[0], shaftX: ROTOR.coneLandingX.booster, shaftR: ROTOR.shaftR.lp }],
    [boosterRims],
  );
  const hpcCones = useMemo(
    () => [{ diskX: hpcRims.xs[hpcRims.xs.length - 1], shaftX: ROTOR.coneLandingX.hpc, shaftR: ROTOR.shaftR.hp }],
    [hpcRims],
  );

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
    boosterDrumGroup.current.rotation.x = SPOOL_SPIN_SIGN * spool.lpAngle;
    hpcDrumGroup.current.rotation.x = SPOOL_SPIN_SIGN * spool.hpAngle;
    const jitter = subIdleJitter(clock.elapsedTime, spool.n2);
    boosterDrumGroup.current.position.y = jitter;
    hpcDrumGroup.current.position.y = jitter;
  });

  return (
    <group>
      {/* Booster drum + machined disks + forward drive cone — LP spool. */}
      <group ref={boosterDrumGroup}>
        <mesh geometry={boosterDrumGeo} material={drumMat} position={[boosterDrumCenterX, 0, 0]} />
        <RotorDisks
          xs={boosterRims.xs}
          rimRadii={boosterRims.radii}
          boreInner={ROTOR.boreInner.lp}
          coneArms={boosterCones}
          material={drumMat}
        />
      </group>

      {/* HPC drum + machined disks + aft drive cone — HP spool. */}
      <group ref={hpcDrumGroup}>
        <mesh geometry={hpcDrumGeo} material={drumMat} position={[hpcDrumCenterX, 0, 0]} />
        <RotorDisks
          xs={hpcRims.xs}
          rimRadii={hpcRims.radii}
          boreInner={ROTOR.boreInner.hp}
          coneArms={hpcCones}
          material={drumMat}
        />
      </group>

      {/* Booster (LPC): LP-driven rotor rows + interleaved stators. Hidden in
          the Internals drive-train view (drums/disks/cones above stay). */}
      {!internals && boosterGeos.map((geo, i) => {
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

      {/* HPC: HP-driven rotor rows + interleaved stators (hidden in Internals). */}
      {!internals && hpcGeos.map((geo, i) => {
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

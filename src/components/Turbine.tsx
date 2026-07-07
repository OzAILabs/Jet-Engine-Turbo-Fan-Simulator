/**
 * Turbine module: HP turbine (HPT) followed by LP turbine (LPT), plus the
 * tapering core drum that the rotor disks ride on.
 *
 * Physics-for-students notes:
 *   - The HPT is driven by the very hot gas leaving the combustor; it extracts
 *     work to spin the HP spool (which drives the HPC). It runs hottest — but
 *     hot metal at NORMAL power does not glow: it wears permanent HEAT
 *     STAINING (straw/bronze/violet tempering bands, baked into a procedural
 *     texture). The emissive only wakes up when Tt4 exceeds the certified
 *     redline — a visible glow through the gas path IS an over-temp event.
 *   - The LPT sits downstream, where the gas is cooler and lower-pressure. Its
 *     blades grow taller stage-by-stage to keep doing work on the expanding gas;
 *     it drives the LP spool (fan + booster). Its staining is subtler, and its
 *     over-temp glow is judged against the certified EGT takeoff limit.
 *   - The drum REALLY rotates: it is split at AXIS.hptEnd into an HP-driven
 *     front section and an LP-driven rear section (the LPT drives the fan
 *     shaft), each in a group whose rotation.x is written every frame from the
 *     live spool angles (same non-reactive pattern as BladeRow). Machined
 *     rotor disks + drive cones (shared RotorDisks) make the spin readable.
 *
 * Each turbine "stage" is a rotor row preceded by a stationary nozzle-guide-vane
 * (NGV) stator row that re-aims the flow into the next rotor. Rotors spin with
 * their spool ('hp' or 'lp'); stators pass spin={null}.
 *
 * Performance: every blade row of a given module reuses ONE geometry + ONE
 * material, and the over-temp glow is animated by mutating the (single) HPT and
 * LPT materials inside useFrame -- never via React re-renders.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { BladeRow } from './BladeRow';
import { RotorDisks } from './RotorDisks';
import { subIdleJitter } from './rotorShared';
import { AXIS, RADII, ROTOR, SPOOL_SPIN_SIGN, coreCaseRadiusAt } from '../data/engineLayout';
import { createTube } from '../geometry/annularSection';
import { createTurbineBladeGeometry } from '../geometry/turbineBladeGeometry';
import { temperatureColor } from '../util/colorScale';
import {
  createHeatStainedDrumMaterial,
  createHeatStainedTurbineMaterial,
  ensureSpanChordUVs,
  overTempGlow,
} from '../materials/hotSection';
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

/** Radial gap between an LPT blade tip and the flaring core casing above it. */
const LPT_TIP_CLEARANCE = 0.025;

/** One stage description so we can build the geometry once and place rows. */
interface StageGeo {
  /** Centered turbine-blade geometry for this stage's rotor + stator. */
  geometry: THREE.BufferGeometry;
  /** Axial center of the stage [m]. */
  x: number;
}

export function Turbine() {
  const { hptStages, lptStages } = useSimStore.getState().config;
  // Internals drive-train view: blade rows hide, drums/disks/cones stay.
  const internals = useSimStore((s) => s.viewMode === 'internals');

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
  // Heat-stained nickel alloy (procedural CanvasTexture tempering bands) — one
  // per turbine module so we can drive each independently. NO glow at normal
  // power: we keep refs and mutate emissive in useFrame, but the intensity
  // stays 0 until the gas path exceeds its certified limit (over-temp event).
  const hptMaterial = useMemo(() => createHeatStainedTurbineMaterial('hpt'), []);
  const lptMaterial = useMemo(() => createHeatStainedTurbineMaterial('lpt'), []);
  // The drum (and its rims) share the HPT staining but multiplied darker; it
  // follows the HPT's over-temp event at reduced intensity.
  const drumMaterial = useMemo(() => createHeatStainedDrumMaterial(), []);

  // Scratch colors so useFrame allocates nothing per frame.
  const hptColor = useRef(new THREE.Color());
  const lptColor = useRef(new THREE.Color());

  // --- HPT stage geometries -------------------------------------------------
  // Small, hottest blades. growth 0.0 -> 0.2 across the (2) stages.
  // ensureSpanChordUVs: the blade loft has no UVs — without them the staining
  // map would collapse to a single texel on every blade.
  const hptStageGeos = useMemo<StageGeo[]>(() => {
    const stages: StageGeo[] = [];
    const span = AXIS.hptEnd - AXIS.hptStart;
    const slot = span / hptStages; // axial width per stage
    for (let i = 0; i < hptStages; i++) {
      const t = hptStages > 1 ? i / (hptStages - 1) : 0;
      const growth = lerp(0.0, 0.2, t);
      const geometry = ensureSpanChordUVs(
        createTurbineBladeGeometry({
          hubRadius: 0.4,
          tipRadius: RADII.hptOuter, // 0.6
          growth,
        }),
      );
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
      // Flares from the HPT-exit radius (~0.60) out toward the big last-stage
      // tip (lptOuter) — the LPT's distinctive growing rear cone. BUT each
      // stage's geometry is shared by its rotor AND the NGV stator 0.3·slot
      // FORWARD of it, where the flaring casing is smaller — so cap the tip
      // against the local casing radius at the stator station (minus tip
      // clearance) or the late-stage blades poke through the case.
      const statorX = AXIS.lptStart + slot * (i + 0.5) - slot * 0.3;
      const tipRadius = Math.min(
        lerp(0.6, RADII.lptOuter, t),
        coreCaseRadiusAt(statorX) - LPT_TIP_CLEARANCE,
      );
      const geometry = ensureSpanChordUVs(createTurbineBladeGeometry({ hubRadius, tipRadius, growth }));
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

  // Drive cones tying the turbine drums to their shafts: the HPT's FRONT disk
  // reaches forward down to the HP shaft (under the combustor, mirroring the
  // HPC's aft cone), and the LPT's REAR disk drops steeply aft to the LP
  // shaft right at the turbine-rear-frame bearing — the classic LPT rear hub.
  const hptCones = useMemo(
    () => [{ diskX: hptRims.xs[0], shaftX: ROTOR.coneLandingX.hpt, shaftR: ROTOR.shaftR.hp }],
    [hptRims],
  );
  const lptCones = useMemo(
    () => [{ diskX: lptRims.xs[lptRims.xs.length - 1], shaftX: ROTOR.coneLandingX.lpt, shaftR: ROTOR.shaftR.lp }],
    [lptRims],
  );

  // --- Over-temp glow + drum spin animation ---------------------------------
  useFrame(({ clock }) => {
    const { engine, spool, config: cfg } = useSimStore.getState();

    // HOT-SECTION HONESTY: at normal power the metal shows NO glow — the heat
    // history is the permanent tempering bands baked into the materials. The
    // emissive only wakes in an OVER-TEMP event: once the gas temperature
    // crosses its certified limit it ramps in hard (smoothstep over ~80 K).
    const tit = engine.turbineInletTemp;
    temperatureColor(tit, hptColor.current);
    const hptOver = overTempGlow(tit, cfg.turbineInletTempRedline);
    hptMaterial.emissive.copy(hptColor.current);
    hptMaterial.emissiveIntensity = 1.6 * hptOver;
    // Drum follows the HPT over-temp event but stays subdued.
    drumMaterial.emissive.copy(hptColor.current);
    drumMaterial.emissiveIntensity = 0.6 * hptOver;

    // LPT: tinted by Tt5, but the over-temp judgment happens on the certified
    // EGT plane (T49, °C) against the takeoff limit from the TCDS.
    const egt = engine.exhaustGasTemp;
    temperatureColor(egt, lptColor.current);
    const lptOver = overTempGlow(engine.egtC, cfg.egtTakeoffLimitC);
    lptMaterial.emissive.copy(lptColor.current);
    lptMaterial.emissiveIntensity = 1.2 * lptOver;

    // HPT drum rides the HP spool; LPT drum rides the LP spool. Plus a tiny
    // start/shutdown rumble on both (zero at rest and at/above idle).
    hptDrumGroup.current.rotation.x = SPOOL_SPIN_SIGN * spool.hpAngle;
    lptDrumGroup.current.rotation.x = SPOOL_SPIN_SIGN * spool.lpAngle;
    const jitter = subIdleJitter(clock.elapsedTime, spool.n2);
    hptDrumGroup.current.position.y = jitter;
    lptDrumGroup.current.position.y = jitter;
  });

  return (
    <group>
      {/* HPT drum + machined disks + forward drive cone — HP spool. */}
      <group ref={hptDrumGroup}>
        <mesh geometry={hptDrumGeometry} material={drumMaterial} position={[hptDrumCenterX, 0, 0]} />
        <RotorDisks
          xs={hptRims.xs}
          rimRadii={hptRims.radii}
          boreInner={ROTOR.boreInner.hp}
          coneArms={hptCones}
          material={drumMaterial}
          thermalGrowth={0.015}
        />
      </group>

      {/* LPT drum + machined disks + aft drive cone — LP spool (drives the fan shaft). */}
      <group ref={lptDrumGroup}>
        <mesh geometry={lptDrumGeometry} material={drumMaterial} position={[lptDrumCenterX, 0, 0]} />
        <RotorDisks
          xs={lptRims.xs}
          rimRadii={lptRims.radii}
          boreInner={ROTOR.boreInner.lp}
          coneArms={lptCones}
          material={drumMaterial}
          thermalGrowth={0.01}
        />
      </group>

      {/* HP turbine: per stage, an NGV stator immediately ahead of the rotor.
          Hidden in the Internals drive-train view (drums/disks/cones stay). */}
      {!internals && hptStageGeos.map((stage, i) => {
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

      {/* LP turbine: same stator-then-rotor layout (hidden in Internals). */}
      {!internals && lptStageGeos.map((stage, i) => {
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

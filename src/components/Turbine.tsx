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
 *
 * Each turbine "stage" is a rotor row preceded by a stationary nozzle-guide-vane
 * (NGV) stator row that re-aims the flow into the next rotor. Rotors spin with
 * their spool ('hp' or 'lp'); stators pass spin={null}.
 *
 * Performance: every blade row of a given module reuses ONE geometry + ONE
 * material, and the heat glow is animated by mutating the (single) HPT and LPT
 * materials inside useFrame -- never via React re-renders.
 */
import { useMemo, useRef } from 'react';
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
  // A gently flaring tube from the HPT inlet radius (0.40) at hptStart to a
  // larger radius (0.50) at lptEnd, matching the disk growth of the spools.
  const drumGeometry = useMemo(() => {
    const length = AXIS.lptEnd - AXIS.hptStart;
    return createTube(0.4, 0.5, length);
  }, []);
  const drumCenterX = (AXIS.hptStart + AXIS.lptEnd) / 2;

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
  // The drum shares the HPT-side glow but stays metallic/dim.
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
      const tipRadius = lerp(0.66, RADII.lptOuter, t); // up to 0.78
      const geometry = createTurbineBladeGeometry({ hubRadius, tipRadius, growth });
      const x = AXIS.lptStart + slot * (i + 0.5);
      stages.push({ geometry, x });
    }
    return stages;
  }, [lptStages]);

  // --- Heat glow animation --------------------------------------------------
  useFrame(() => {
    const { engine } = useSimStore.getState();

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
  });

  return (
    <group>
      {/* Rotating core drum the turbine disks ride on. */}
      <mesh geometry={drumGeometry} material={drumMaterial} position={[drumCenterX, 0, 0]} />

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

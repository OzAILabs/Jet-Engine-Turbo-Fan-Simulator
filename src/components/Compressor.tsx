/**
 * Compressor.tsx — the booster (low-pressure compressor / LPC) and the
 * high-pressure compressor (HPC) of the core.
 *
 * Teaching points wired into the visuals:
 *   - The booster spins with the LP spool (same shaft as the fan), the HPC
 *     spins with the much faster HP spool. Each blade row is a BladeRow that
 *     drives its own spin from the live spool angle, so we never re-render.
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
 * engine. The static core drum and casing still begin at AXIS.lpcStart, so the
 * OGVs have a surface to sit over; only the blade rows move.
 */
const BOOSTER_ROTOR_FRONT = AXIS.lpcStart + 0.36; // ≈ -2.09

export function Compressor() {
  // --- Core drum under the blades ----------------------------------------
  // A single static frustum from r=0.5 at lpcStart down to r=0.34 at hpcEnd.
  // Both compressor sections share this one rotating-looking-but-static hub.
  const drumLength = AXIS.hpcEnd - AXIS.lpcStart;
  const drumCenterX = (AXIS.lpcStart + AXIS.hpcEnd) / 2;
  const drumGeo = useMemo(
    // createTube(radiusFront [-X end], radiusBack [+X end], length)
    () => createTube(0.5, 0.34, drumLength),
    [drumLength],
  );
  const drumMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#8893a3', metalness: 0.9, roughness: 0.35 }),
    [],
  );

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

  // --- Surge glow ---------------------------------------------------------
  // Read the live surge margin (0-100) each frame and push the rotor material
  // toward red as it falls below ~25. We keep a reusable Color to avoid
  // allocating every frame.
  const glowColor = useRef(new THREE.Color());
  useFrame(() => {
    const { surgeMargin } = useSimStore.getState();
    const intensity = Math.max(0, (25 - surgeMargin) / 25) * 0.6;
    glowColor.current.setRGB(intensity, 0, 0);
    rotorMat.emissive.copy(glowColor.current);
    rotorMat.emissiveIntensity = intensity;
  });

  // Even axial spacing helpers for the rotor rows of each section.
  const boosterX = (i: number) =>
    boosterStages > 1
      ? lerp(BOOSTER_ROTOR_FRONT, AXIS.lpcEnd, i / (boosterStages - 1))
      : (BOOSTER_ROTOR_FRONT + AXIS.lpcEnd) / 2;
  const hpcX = (i: number) =>
    hpcStages > 1
      ? lerp(AXIS.hpcStart, AXIS.hpcEnd, i / (hpcStages - 1))
      : (AXIS.hpcStart + AXIS.hpcEnd) / 2;

  return (
    <group>
      {/* Static core drum that the compressor blades ride on. */}
      <mesh geometry={drumGeo} material={drumMat} position={[drumCenterX, 0, 0]} />

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

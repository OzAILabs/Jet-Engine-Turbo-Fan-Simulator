/**
 * Fan section — the giant front rotor of the turbofan.
 *
 * What students see here:
 *   - A pointed SPINNER nose cone that splits the incoming air.
 *   - A short FAN HUB (drum) the blades are rooted into.
 *   - 22 wide-chord composite FAN BLADES (the big "propeller-like" row).
 *   - A stationary ring of OUTLET GUIDE VANES (OGVs) just behind the fan that
 *     straighten the swirling bypass air before it enters the duct.
 *
 * Rotation / performance notes:
 *   - The fan is on the LOW-PRESSURE (LP) spool, so the spinner + hub group and
 *     the fan blade row all spin with `spool.lpAngle`.
 *   - We read that angle imperatively inside useFrame (NON-reactive) and assign
 *     it to a single group's rotation.x — one matrix update per frame, no React
 *     re-render. The BladeRow helper does the same internally for the blades.
 *   - The OGV row is a stator (spin = null) and never turns.
 *
 * Geometry from the helpers is centered at the local origin and oriented along
 * X, so each mesh is positioned with its axial CENTER on the engine axis.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS, RADII } from '../data/engineLayout';
import { createTube, createRing } from '../geometry/annularSection';
import { createFanBladeGeometry } from '../geometry/bladeGeometry';
import { createCompressorBladeGeometry } from '../geometry/compressorBladeGeometry';
import { BladeRow } from './BladeRow';
import { Spinner } from './Spinner';

/** Number of outlet guide vanes behind the fan (stationary stator row). */
const OGV_COUNT = 44;

export function Fan() {
  const config = useSimStore((s) => s.config);

  // The spinner + hub spin with the LP spool; one group drives both.
  const spoolGroup = useRef<THREE.Group>(null!);
  // Material of the motion-blur disc; its opacity tracks fan RPM.
  const blurMatRef = useRef<THREE.MeshStandardMaterial>(null!);

  // --- Geometry (built once, reused) --------------------------------------
  // Short fan hub drum the blades root into (slight aft taper for looks).
  const hubGeo = useMemo(
    () => createTube(RADII.fanHub, RADII.fanHub * 0.95, AXIS.fanBladeWidth),
    [],
  );

  // The 22 big composite fan blades (one geometry, instanced by BladeRow).
  const fanBladeGeo = useMemo(
    () => createFanBladeGeometry(RADII.fanHub, RADII.fanTip),
    [],
  );

  // A translucent "motion-blur" disc that fades in as the fan spins fast, so a
  // spinning fan reads as a blurred disc (like a real one) instead of strobing
  // discrete blades.
  const blurDiscGeo = useMemo(() => createRing(RADII.fanHub * 1.05, RADII.fanTip * 0.99, { segments: 96 }), []);

  // Outlet guide vanes spanning ONLY the bypass annulus. The root sits just
  // outside the core casing (coreLpcOuter ≈ 0.62 m) so the vanes never reach
  // down into the core/booster drum; the tip stops just inside the bypass-duct
  // outer wall (nacelle inner).
  const ogvGeo = useMemo(
    () =>
      createCompressorBladeGeometry({
        hubRadius: RADII.coreLpcOuter + 0.04,
        tipRadius: RADII.nacelleInner * 0.95,
        compactness: 0.2,
      }),
    [],
  );

  // --- Materials (built once, reused) -------------------------------------
  // Dark composite look for the big fan blades.
  const bladeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2b2f36',
        metalness: 0.55,
        roughness: 0.5,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // Spinner + hub share a slightly lighter, more metallic hub material.
  const hubMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3a3f47',
        metalness: 0.6,
        roughness: 0.45,
      }),
    [],
  );

  // OGVs are metallic stationary vanes.
  const ogvMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#8a9099',
        metalness: 0.7,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // Drive the spinner + hub spin from the live LP spool angle (no re-render),
  // and fade the motion-blur disc in with fan speed.
  useFrame(() => {
    const { spool } = useSimStore.getState();
    spoolGroup.current.rotation.x = spool.lpAngle;
    if (blurMatRef.current) {
      blurMatRef.current.opacity = THREE.MathUtils.clamp((spool.n1 - 0.25) * 0.7, 0, 0.5);
    }
  });

  return (
    <group>
      {/* Spinner nose cone + fan hub: these turn with the LP spool. */}
      <group ref={spoolGroup}>
        {/* Ogive nose cone + white safety spiral (spins with the LP spool). */}
        <Spinner />
        {/* Hub drum centered on the fan plane. */}
        <mesh geometry={hubGeo} material={hubMat} position={[AXIS.fanPlane, 0, 0]} />
      </group>

      {/* 22 composite fan blades — spin with the LP spool. */}
      <BladeRow
        geometry={fanBladeGeo}
        material={bladeMat}
        count={config.numFanBlades}
        x={AXIS.fanPlane}
        spin="lp"
      />

      {/* Motion-blur disc: fades in at high RPM so the fan reads as a blur. */}
      <mesh geometry={blurDiscGeo} position={[AXIS.fanPlane + 0.06, 0, 0]}>
        <meshStandardMaterial
          ref={blurMatRef}
          color="#15181d"
          metalness={0.3}
          roughness={0.7}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Stationary outlet guide vanes: the FIRST stator after the fan. Placed
          just aft of the fan's swept tip TE (~x=-2.50 at the duct radius) and
          FORWARD of the first booster rotor (the booster rows are packed aft to
          leave room — see Compressor.tsx). Sits in the bypass annulus, below
          the fan tips. */}
      <BladeRow
        geometry={ogvGeo}
        material={ogvMat}
        count={OGV_COUNT}
        x={AXIS.fanPlane + 0.82}
        spin={null}
      />
    </group>
  );
}

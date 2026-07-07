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
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS, FAN_DISK, RADII, SPOOL_SPIN_SIGN } from '../data/engineLayout';
import { createTube, createRing } from '../geometry/annularSection';
import { createFanBladeGeometry } from '../geometry/bladeGeometry';
import { createCompressorBladeGeometry } from '../geometry/compressorBladeGeometry';
import { createFanBladeMaterial } from '../materials/coldSection';
import { BladeRow } from './BladeRow';
import { createDiskGeometry } from './RotorDisks';
import { Spinner } from './Spinner';

/** Number of outlet guide vanes behind the fan (stationary stator row). */
const OGV_COUNT = 44;

/** Module-level scratch for the dovetail InstancedMesh layout (never per-frame). */
const dummy = new THREE.Object3D();

export function Fan() {
  const config = useSimStore((s) => s.config);
  // Internals drive-train view: blades/OGVs/blur hide, spool group stays.
  const internals = useSimStore((s) => s.viewMode === 'internals');

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

  // FAN DISK: the heavy machined LP disk just aft of the spinner base that
  // the blade roots dovetail into — same bore/web/rim lathe profile family as
  // the core disks (RotorDisks), beefed up. Its bore hugs the LP shaft; its
  // rim stands a few mm proud of the tapering hub skin so it reads in every
  // view mode.
  const fanDiskGeo = useMemo(
    () => createDiskGeometry(FAN_DISK.x, FAN_DISK.rimOuter, FAN_DISK.boreInner, FAN_DISK),
    [],
  );

  // Dovetail blade-root blocks around the disk rim, one per fan blade, in the
  // SAME angular slots as the BladeRow blades (phase 0). The radial offset is
  // baked into the box geometry (like BladeRow's blades) so each instance
  // only needs an X-rotation.
  const dovetailGeo = useMemo(() => {
    const g = new THREE.BoxGeometry(
      FAN_DISK.dovetail.length, // axial
      FAN_DISK.dovetail.depth, // radial
      FAN_DISK.dovetail.width, // tangential
    );
    g.translate(0, FAN_DISK.dovetail.r, 0);
    return g;
  }, []);

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
  // Carbon-twill composite + titanium leading-edge sheath for the big fan
  // blades — procedural CanvasTextures, see src/materials/coldSection.ts.
  //
  // Flutter: near max N1 the blades shimmer with a 2-nodal-diameter traveling
  // flap wave (how real bladed-disk flutter presents). Vertex-shader only:
  // displacement is tip-weighted (uv.y = span fraction from the loft), phased
  // by each blade's angular slot recovered from its instanceMatrix X-rotation.
  // Frequency is slowed ~10x from a real 1st-flap mode so the eye can see it.
  const flutterUniforms = useMemo(
    () => ({ uTime: { value: 0 }, uFlutter: { value: 0 } }),
    [],
  );
  const bladeMat = useMemo(() => {
    const m = createFanBladeMaterial();
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = flutterUniforms.uTime;
      shader.uniforms.uFlutter = flutterUniforms.uFlutter;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uTime;\nuniform float uFlutter;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  float slot = atan(instanceMatrix[1][2], instanceMatrix[1][1]);
  float tipWeight = uv.y * uv.y;
  transformed.z += uFlutter * tipWeight * 0.028 * sin(uTime * 44.0 + slot * 2.0);
}
#endif`,
        );
    };
    return m;
  }, [flutterUniforms]);

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

  // Lay the dovetail blocks out once around the rim (ONE InstancedMesh — one
  // draw call). Guard the ref: meshes can be unmounted on view-mode swaps.
  const dovetailRef = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const mesh = dovetailRef.current;
    if (!mesh) return;
    const step = (Math.PI * 2) / config.numFanBlades;
    for (let k = 0; k < config.numFanBlades; k++) {
      dummy.position.set(FAN_DISK.x, 0, 0);
      dummy.rotation.set(k * step, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [config.numFanBlades]);

  // Drive the spinner + hub spin from the live LP spool angle (no re-render),
  // and fade the motion-blur disc in with fan speed.
  useFrame((state) => {
    const { spool } = useSimStore.getState();
    spoolGroup.current.rotation.x = SPOOL_SPIN_SIGN * spool.lpAngle;
    if (blurMatRef.current) {
      blurMatRef.current.opacity = THREE.MathUtils.clamp((spool.n1 - 0.25) * 0.7, 0, 0.5);
    }
    // Flutter onset above ~85% N1, full amplitude past the redline region.
    flutterUniforms.uTime.value = state.clock.elapsedTime;
    flutterUniforms.uFlutter.value = THREE.MathUtils.smoothstep(spool.n1, 0.85, 1.05);
  });

  return (
    <group>
      {/* Spinner nose cone + fan hub: these turn with the LP spool. */}
      <group ref={spoolGroup}>
        {/* Ogive nose cone + white safety spiral (spins with the LP spool). */}
        <Spinner />
        {/* Hub drum centered on the fan plane. */}
        <mesh geometry={hubGeo} material={hubMat} position={[AXIS.fanPlane, 0, 0]} />
        {/* Fan disk + dovetail blade-root blocks — they ride this same LP
            group, so they spin with N1 without any extra useFrame loop. */}
        <mesh geometry={fanDiskGeo} material={hubMat} castShadow={false} />
        <instancedMesh
          ref={dovetailRef}
          args={[dovetailGeo, hubMat, config.numFanBlades]}
          castShadow={false}
          frustumCulled={false}
        />
      </group>

      {/* Blade rows + blur disc hide in the Internals drive-train view — the
          spinner, hub, fan disk and dovetails above keep spinning there. */}
      {!internals && (
        <>
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

          {/* Stationary outlet guide vanes: the FIRST stator after the fan.
              Placed just aft of the fan's swept tip TE (~x=-2.50 at the duct
              radius) and FORWARD of the first booster rotor (the booster rows
              are packed aft to leave room — see Compressor.tsx). Sits in the
              bypass annulus, below the fan tips. */}
          <BladeRow
            geometry={ogvGeo}
            material={ogvMat}
            count={OGV_COUNT}
            x={AXIS.fanPlane + 0.82}
            spin={null}
          />
        </>
      )}
    </group>
  );
}

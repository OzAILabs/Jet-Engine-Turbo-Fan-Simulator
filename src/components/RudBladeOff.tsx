/**
 * RudBladeOff — the VISIBLE first seconds of a fan-blade-off event:
 *
 *   • the released blade as a free body: it swings out of its slot, digs its
 *     tip into the containment case, tumbles violently and shreds (fades)
 *     within half a second — exactly the certification high-speed footage,
 *   • an impact spark burst at the strike point (additive orange Points),
 *   • a persistent scorch mark on the inner barrel where it hit.
 *
 * Everything is a deterministic function of rud.t (no per-frame physics
 * state, no Math.random), so pausing, stepping and captures all reproduce.
 * The component mounts only while a RUD event exists — zero cost otherwise —
 * and reads the store non-reactively inside useFrame.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS, RADII, clockToYZ } from '../data/engineLayout';
import { createFanBladeGeometry } from '../geometry/bladeGeometry';
import { createFanBladeMaterial } from '../materials/coldSection';
import { nacelleSkin } from '../geometry/nacelleGeometry';

const N_SPARKS = 56;
/** The free blade lives (visibly) for this long after release [s]. */
const BLADE_LIFE_S = 0.55;
const SPARKS_LIFE_S = 1.1;

/** Deterministic per-index hash in [-0.5, 0.5). */
const h = (i: number, k: number) => (((i * 73 + k * 31) % 19) / 19 + ((i * 37) % 7) / 7) / 2 - 0.5;

export function RudBladeOff() {
  const rud = useSimStore((s) => s.rud);

  const bladeRef = useRef<THREE.Group>(null);
  const sparksRef = useRef<THREE.Points>(null);

  // Fresh geometry/material, built lazily ONLY when an event mounts us. The
  // instanced row's material carries the flutter shader patch (it reads
  // instanceMatrix), so the free blade gets a plain composite material.
  const bladeGeo = useMemo(() => createFanBladeGeometry(RADII.fanHub, RADII.fanTip), []);
  const bladeMat = useMemo(() => createFanBladeMaterial(), []);
  const sparkPositions = useMemo(() => new Float32Array(N_SPARKS * 3), []);

  const impactClock = rud?.impactClock ?? 4.3;
  const phi = (impactClock / 12) * Math.PI * 2;
  const impact = useMemo(() => {
    const { y, z } = clockToYZ(impactClock, nacelleSkin.innerRadiusAt(AXIS.fanPlane) - 0.01);
    return new THREE.Vector3(AXIS.fanPlane, y, z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impactClock]);

  useFrame(() => {
    const live = useSimStore.getState().rud;
    if (!live) return;
    const t = live.t;

    // --- The free blade: swing out (0–80 ms), grind on the case, shred. ----
    if (bladeRef.current) {
      const g = bladeRef.current;
      if (t < BLADE_LIFE_S) {
        const out = Math.min(1, t / 0.08); // radial excursion
        const grind = Math.max(0, t - 0.08);
        g.visible = true;
        g.position.set(
          AXIS.fanPlane + 0.05 * grind,
          0.16 * out * Math.cos(phi),
          -0.16 * out * Math.sin(phi),
        );
        // Own-axis tumble + a residual swing around the engine axis.
        g.rotation.set(-phi + 3.5 * grind, 0, 2.2 * Math.min(t, 0.3) + 9 * grind);
        // "Shredding": collapse over the last 40% of its life.
        const s = THREE.MathUtils.clamp((BLADE_LIFE_S - t) / (BLADE_LIFE_S * 0.4), 0, 1);
        g.scale.setScalar(Math.max(0.001, s));
      } else {
        g.visible = false;
      }
    }

    // --- Spark burst at the strike point ------------------------------------
    if (sparksRef.current) {
      const mat = sparksRef.current.material as THREE.PointsMaterial;
      if (t < SPARKS_LIFE_S) {
        const geo = sparksRef.current.geometry as THREE.BufferGeometry;
        for (let i = 0; i < N_SPARKS; i++) {
          const life = 0.25 + 0.75 * (h(i, 5) + 0.5); // 0.25–1 of SPARKS_LIFE
          const tt = Math.min(t / (life * SPARKS_LIFE_S), 1);
          // Tangential-aft spray with gravity, deterministic per index.
          const vx = 1.5 + 4 * (h(i, 1) + 0.5);
          const vTan = 6 * h(i, 2);
          const vRad = 2 * h(i, 3) - 0.5;
          const dirY = Math.cos(phi);
          const dirZ = -Math.sin(phi);
          const tanY = -dirZ;
          const tanZ = dirY;
          const tSec = tt * life * SPARKS_LIFE_S;
          sparkPositions[i * 3] = impact.x + vx * tSec;
          sparkPositions[i * 3 + 1] =
            impact.y + (vTan * tanY + vRad * dirY) * tSec - 4.9 * tSec * tSec;
          sparkPositions[i * 3 + 2] = impact.z + (vTan * tanZ + vRad * dirZ) * tSec;
        }
        geo.attributes.position.needsUpdate = true;
        mat.opacity = THREE.MathUtils.clamp(1.2 - t / SPARKS_LIFE_S, 0, 1);
      } else {
        mat.opacity = 0;
      }
    }
  });

  if (!rud) return null;

  return (
    <group>
      {/* The released blade (fbo only — a burst destroys the core, not the fan). */}
      {rud.variant === 'fbo' && (
        <group ref={bladeRef} position={[AXIS.fanPlane, 0, 0]}>
          <mesh geometry={bladeGeo} material={bladeMat} castShadow={false} />
        </group>
      )}

      {/* Impact sparks. */}
      <points ref={sparksRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[sparkPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.05}
          color="#ffb057"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>

      {/* Scorch on the containment barrel where the blade struck — permanent
          until a scenario reset (the aftermath is part of the lesson). */}
      <mesh
        position={impact.toArray()}
        // Circle faces +Z; Rx(π/2 − φ) turns that normal onto the inward
        // radial at the impact clock (DoubleSide covers the sign).
        rotation={[Math.PI / 2 - phi, 0, 0]}
        castShadow={false}
        userData={{ noShadow: true }}
      >
        <circleGeometry args={[0.34, 24]} />
        <meshStandardMaterial
          color="#221f1c"
          roughness={0.95}
          metalness={0.05}
          transparent
          opacity={0.82}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </mesh>
    </group>
  );
}

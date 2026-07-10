/**
 * RudAftermath — the EXTERNAL drama of a catastrophic failure, visible from
 * any angle (the wobble and sparks live inside the inlet; this is what makes
 * the event read from a normal side view):
 *
 *   • BLACK SMOKE pouring from the core nozzle (both variants) and boiling
 *     straight off the core cowl at the burst site (burst),
 *   • FIRE at the burst site: crossed flame planes (procedural canvas
 *     gradient, additive) flickering against a real orange point light —
 *     fuel-fed, so it burns until the fire handle + bottle kill it,
 *   • a one-shot DEBRIS spray at release: dark fragments flung aft through
 *     the bypass (fbo) or radially through the cowl line (burst).
 *
 * Deterministic (pure functions of rud.t + per-index hashes) and mounted
 * only while an event exists. Store read non-reactively in useFrame.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS, clockToYZ } from '../data/engineLayout';
import { toTexture, tryMakeCanvas } from '../materials/coldSection';

const N_SMOKE = 200;
const N_DEBRIS = 44;
const SMOKE_LIFE_S = 2.4; // per-particle loop period
const DEBRIS_LIFE_S = 1.8;

/** Burst-site anchor AT THE TORN COWL SKIN (see BURST_BAY in
 *  nacelleGeometry): the fragments opened a hole here, so the fire and the
 *  smoke column pour OUT of it — buried at core radius they were just a
 *  glow leaking through the paint. */
const BURST_X = 1.15;
const BURST_CLOCK = 7.7; // keep in lockstep with BURST_BAY.clock
const BURST_R = 1.5;

const h = (i: number, k: number) => (((i * 73 + k * 31) % 19) / 19 + ((i * 37) % 7) / 7) / 2 - 0.5;

/** Soft radial flame gradient, painted once (shared by all flame planes). */
let flameTex: THREE.CanvasTexture | null | undefined;
function getFlameTexture(): THREE.CanvasTexture | null {
  if (flameTex !== undefined) return flameTex;
  const surf = tryMakeCanvas(128);
  if (!surf) {
    flameTex = null;
    return flameTex;
  }
  const { canvas, ctx } = surf;
  const g = ctx.createRadialGradient(64, 88, 4, 64, 88, 80);
  g.addColorStop(0, 'rgba(255,240,190,0.95)');
  g.addColorStop(0.25, 'rgba(255,160,60,0.8)');
  g.addColorStop(0.6, 'rgba(230,80,25,0.35)');
  g.addColorStop(1, 'rgba(120,30,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  flameTex = toTexture(canvas, { srgb: true });
  return flameTex;
}

/** Soft round puff sprite so the smoke Points render as puffs, not squares. */
let puffTex: THREE.CanvasTexture | null | undefined;
function getPuffTexture(): THREE.CanvasTexture | null {
  if (puffTex !== undefined) return puffTex;
  const surf = tryMakeCanvas(64);
  if (!surf) {
    puffTex = null;
    return puffTex;
  }
  const { canvas, ctx } = surf;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  puffTex = toTexture(canvas);
  return puffTex;
}

export function RudAftermath() {
  const rud = useSimStore((s) => s.rud);

  const smokeRef = useRef<THREE.Points>(null);
  const debrisRef = useRef<THREE.Points>(null);
  const fireRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  const smokePos = useMemo(() => new Float32Array(N_SMOKE * 3), []);
  const debrisPos = useMemo(() => new Float32Array(N_DEBRIS * 3), []);
  const tex = useMemo(getFlameTexture, []);
  const puff = useMemo(getPuffTexture, []);

  const burstSite = useMemo(() => {
    const { y, z } = clockToYZ(BURST_CLOCK, BURST_R);
    return new THREE.Vector3(BURST_X, y, z);
  }, []);

  useFrame((state) => {
    const live = useSimStore.getState().rud;
    if (!live) return;
    const t = live.t;
    const burst = live.variant === 'burst';

    // --- Smoke: continuous looping emitters while rud.smoke > 0 -----------
    if (smokeRef.current) {
      const mat = smokeRef.current.material as THREE.PointsMaterial;
      mat.opacity = 0.42 * live.smoke;
      if (live.smoke > 0.01) {
        const geo = smokeRef.current.geometry as THREE.BufferGeometry;
        for (let i = 0; i < N_SMOKE; i++) {
          // Each particle loops its own phase; young = at the emitter.
          const phase = ((t / SMOKE_LIFE_S + ((i * 29) % 97) / 97) % 1 + 1) % 1;
          const a = phase * SMOKE_LIFE_S;
          const fromBurst = burst && i % 2 === 0;
          if (fromBurst) {
            // Boiling column off the burst site: outward + buoyant rise.
            smokePos[i * 3] = burstSite.x + (1.2 + 2 * h(i, 1)) * a * 0.4 + a * a * 0.3;
            smokePos[i * 3 + 1] = burstSite.y + (0.6 + h(i, 2)) * a + 1.4 * a * a * 0.5;
            smokePos[i * 3 + 2] = burstSite.z + (0.9 + 0.8 * h(i, 3)) * a;
          } else {
            // Trailing from the core nozzle, drifting aft and up.
            smokePos[i * 3] = AXIS.coreNozzleExit + (3.2 + 2.5 * h(i, 4)) * a;
            smokePos[i * 3 + 1] = 0.1 + 1.4 * h(i, 5) * a + 0.5 * a * a * 0.4;
            smokePos[i * 3 + 2] = 1.6 * h(i, 6) * a;
          }
        }
        geo.attributes.position.needsUpdate = true;
      }
    }

    // --- Debris: one-shot ballistic spray at release ------------------------
    if (debrisRef.current) {
      const mat = debrisRef.current.material as THREE.PointsMaterial;
      if (t < DEBRIS_LIFE_S) {
        const geo = debrisRef.current.geometry as THREE.BufferGeometry;
        for (let i = 0; i < N_DEBRIS; i++) {
          const tt = Math.min(t, DEBRIS_LIFE_S);
          if (burst) {
            // Radial shrapnel fan from the burst site — through everything.
            const ang = (i / N_DEBRIS) * Math.PI * 2 + h(i, 7) * 0.5;
            const vr = 9 + 10 * (h(i, 8) + 0.5);
            debrisPos[i * 3] = burstSite.x + (2 + 6 * (h(i, 9) + 0.5)) * tt;
            debrisPos[i * 3 + 1] = burstSite.y + Math.cos(ang) * vr * tt - 4.9 * tt * tt;
            debrisPos[i * 3 + 2] = burstSite.z + Math.sin(ang) * vr * tt;
          } else {
            // Shredded blade fragments blown AFT through the bypass duct.
            const ang = h(i, 7) * Math.PI * 2;
            const r0 = 1.1 + 0.45 * (h(i, 8) + 0.5);
            debrisPos[i * 3] = AXIS.fanPlane + (16 + 14 * (h(i, 9) + 0.5)) * tt;
            debrisPos[i * 3 + 1] = Math.cos(ang) * r0 - 3 * tt * tt;
            debrisPos[i * 3 + 2] = Math.sin(ang) * r0;
          }
        }
        geo.attributes.position.needsUpdate = true;
        mat.opacity = THREE.MathUtils.clamp(1.4 * (1 - t / DEBRIS_LIFE_S), 0, 0.95);
      } else {
        mat.opacity = 0;
      }
    }

    // --- Fire: flicker the crossed planes + the light ------------------------
    if (fireRef.current) {
      const flick =
        1 + 0.22 * Math.sin(47 * state.clock.elapsedTime) + 0.12 * Math.sin(13 * state.clock.elapsedTime + 1.7);
      const s = live.fire * flick;
      fireRef.current.visible = live.fire > 0.02;
      fireRef.current.scale.set(s, s * (1 + 0.15 * Math.sin(29 * state.clock.elapsedTime)), s);
      fireRef.current.children.forEach((c, k) => {
        (c as THREE.Mesh).rotation.y = k * 1.05 + 0.4 * Math.sin(9 * state.clock.elapsedTime + k);
      });
    }
    if (lightRef.current) {
      lightRef.current.intensity =
        6 * live.fire * (1 + 0.3 * Math.sin(31 * state.clock.elapsedTime));
    }
  });

  if (!rud) return null;

  return (
    <group>
      {/* Black smoke. */}
      <points ref={smokeRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[smokePos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.42}
          color="#17181a"
          map={puff ?? undefined}
          transparent
          opacity={0}
          depthWrite={false}
          sizeAttenuation
        />
      </points>

      {/* Debris spray. */}
      <points ref={debrisRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[debrisPos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.055}
          color="#2c2d30"
          transparent
          opacity={0}
          depthWrite={false}
          sizeAttenuation
        />
      </points>

      {/* Fuel-fed fire pouring OUT of the torn bay (burst only — the fbo's
          brief flash is carried by the sparks). */}
      {tex && rud.variant === 'burst' && (
        <group ref={fireRef} position={burstSite.toArray()} visible={false}>
          {[0, 1, 2].map((k) => (
            <mesh key={k} rotation={[0, k * 1.05, 0]} userData={{ noShadow: true }}>
              <planeGeometry args={[1.5, 2.4]} />
              <meshBasicMaterial
                map={tex}
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}
        </group>
      )}
      <pointLight
        ref={lightRef}
        position={[burstSite.x, burstSite.y * 1.25, burstSite.z * 1.25]}
        color="#ff8438"
        intensity={0}
        distance={11}
        decay={1.7}
      />
    </group>
  );
}

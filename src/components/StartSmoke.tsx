/**
 * StartSmoke — the light-off puff. When the flame takes, the first seconds of
 * combustion are rich and cold-walled: a cloud of unburnt/half-burnt fuel
 * blows down the core and out the nozzle as a grey-brown puff, thinning to a
 * haze through the acceleration and gone by idle (clean burn).
 *
 * Independent of the exhaust style (the volumetric plume has its own subtle
 * version, but the Dramatic style had NONE) — this is one Points system at
 * the core nozzle, driven by the start-sequence state, so the puff shows in
 * every rendering mode. One draw call, zero allocation per frame.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS } from '../data/engineLayout';

const N = 160;
/** Puff lifetime bounds [s] — recycled continuously while smoke is driven. */
const LIFE_MIN = 1.6;
const LIFE_SPAN = 2.2;
/** Aft drift [m/s] at birth (sub-idle core jet is slow). */
const SPEED_MIN = 1.4;
const SPEED_SPAN = 2.4;

/** Deterministic per-particle hash (no Math.random — capture-safe). */
const h = (i: number, k: number) => (((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;

export function StartSmoke() {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const burst = useRef(0);
  const prevLit = useRef(false);

  const { positions, seeds } = useMemo(() => {
    const pos = new Float32Array(N * 3);
    const sd = new Float32Array(N * 4); // birth phase, angle, radius, life
    for (let i = 0; i < N; i++) {
      sd[i * 4] = h(i, 1); // phase offset 0..1
      sd[i * 4 + 1] = h(i, 2) * Math.PI * 2; // angle around the axis
      sd[i * 4 + 2] = 0.06 + h(i, 3) * 0.2; // birth radius inside the nozzle
      sd[i * 4 + 3] = LIFE_MIN + h(i, 4) * LIFE_SPAN; // lifetime
      pos[i * 3] = AXIS.coreNozzleExit;
      pos[i * 3 + 1] = -100; // parked off-screen until driven
      pos[i * 3 + 2] = 0;
    }
    return { positions: pos, seeds: sd };
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const { startSeq, spool } = useSimStore.getState();

    // Drive: a big burst on the light-off edge (τ ≈ 3 s), plus a sustained
    // haze through lightoff/accel that dies as the core approaches idle.
    if (startSeq.lit && !prevLit.current) burst.current = 1;
    prevLit.current = startSeq.lit;
    burst.current *= Math.exp(-dt / 3.0);
    const accelHaze =
      startSeq.runState === 'lightoff' || startSeq.runState === 'accel'
        ? 0.4 * Math.max(0, 1 - spool.n2 / 0.62)
        : 0;
    const drive = Math.min(1, burst.current + accelHaze);

    const pts = pointsRef.current;
    const mat = matRef.current;
    if (!pts || !mat) return;
    mat.opacity = 0.5 * drive;
    if (drive < 0.02) return; // parked — skip the position writes

    const t = state.clock.elapsedTime;
    const posAttr = pts.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < N; i++) {
      const life = seeds[i * 4 + 3];
      const age = ((t / life + seeds[i * 4]) % 1) * life; // 0..life, recycling
      const speed = SPEED_MIN + seeds[i * 4] * SPEED_SPAN;
      const spread = seeds[i * 4 + 2] + age * 0.22; // cloud billows outward
      const ang = seeds[i * 4 + 1] + age * 0.7; // lazy roll
      arr[i * 3] = AXIS.coreNozzleExit + 0.1 + age * speed;
      arr[i * 3 + 1] = Math.cos(ang) * spread + age * age * 0.05; // slight buoyant rise
      arr[i * 3 + 2] = Math.sin(ang) * spread;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        color="#6f6a60"
        size={0.34}
        transparent
        opacity={0}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

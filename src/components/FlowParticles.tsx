/**
 * Animated flow visualization.
 *
 * Four independent THREE.Points systems show air/gas streaming through the
 * engine: the bypass duct, the hot core path, the combustor flame zone, and
 * the merged exhaust plume. Each particle rides a precomputed path (sampled by
 * a 0..1 "phase"); every frame we advance the phase by a speed tied to the
 * live spool / exhaust velocity, wrap it, and rewrite that point's position.
 *
 * Performance notes for students:
 *   - One BufferGeometry + one PointsMaterial per system => four draw calls.
 *   - Paths and base colors are precomputed once with useMemo. Per frame we
 *     only touch the position attribute (and flip needsUpdate); colors are set
 *     once and only refreshed when the "temperature colors" toggle flips.
 *   - We never subscribe reactively to spool/engine here; we read them with
 *     getState() inside useFrame so the slider/HUD never re-renders the scene.
 */
import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS } from '../data/engineLayout';
import { temperatureColor } from '../util/colorScale';

// --- Tunables -------------------------------------------------------------
const N_BYPASS = 320;
const N_CORE = 220;
const N_COMBUSTOR = 120;
const N_EXHAUST = 260;

const POINT_SIZE = 0.07;

// Path sampling resolution for curved streams.
const PATH_SAMPLES = 96;

/**
 * A single particle system: a fixed-size pool of particles, each with its own
 * phase (0..1) along a function that maps phase -> world position. We keep the
 * raw typed arrays so useFrame can mutate them with zero allocation.
 */
interface ParticleSystem {
  count: number;
  positions: Float32Array; // length count*3 (mutated each frame)
  colors: Float32Array; // length count*3 (set once / on toggle)
  phases: Float32Array; // length count, 0..1
  /** Per-particle random angle around the X axis [rad]. */
  angles: Float32Array;
  /** Maps (phase, particleIndex) -> [x, y, z]. Writes into out and returns it. */
  sample: (phase: number, index: number, out: THREE.Vector3) => THREE.Vector3;
}

/** Linear interpolation helper kept local to avoid extra imports. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Build a cheap polyline-resampler from a CatmullRom curve so that, given a
 * phase 0..1, we can fetch an axis point (x and the swirl radius) quickly
 * without re-evaluating the spline every frame.
 */
function buildCurveLUT(points: THREE.Vector3[]): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  return curve.getSpacedPoints(PATH_SAMPLES);
}

/** Sample a precomputed point LUT at phase 0..1 (linear between samples). */
function sampleLUT(lut: THREE.Vector3[], phase: number, out: THREE.Vector3): THREE.Vector3 {
  const last = lut.length - 1;
  const f = THREE.MathUtils.clamp(phase, 0, 1) * last;
  const i = Math.min(Math.floor(f), last - 1);
  const t = f - i;
  return out.copy(lut[i]).lerp(lut[i + 1], t);
}

/**
 * Rough core-gas temperature [K] as a function of axial position. Air enters
 * near ambient, climbs through compression, spikes in the combustor, then
 * cools as it does work across the turbines and expands out the nozzle.
 */
function coreTempAtX(x: number): number {
  if (x <= AXIS.fanPlane) return 300;
  if (x <= AXIS.combustorStart) {
    // Compression heating: 300K -> ~750K by the burner inlet.
    return lerp(300, 750, (x - AXIS.fanPlane) / (AXIS.combustorStart - AXIS.fanPlane));
  }
  if (x <= AXIS.combustorEnd) {
    // Combustion spike up to ~1800K.
    return lerp(750, 1800, (x - AXIS.combustorStart) / (AXIS.combustorEnd - AXIS.combustorStart));
  }
  if (x <= AXIS.coreNozzleExit) {
    // Expansion / work extraction: ~1800K -> ~900K at the nozzle exit.
    return lerp(1800, 900, (x - AXIS.combustorEnd) / (AXIS.coreNozzleExit - AXIS.combustorEnd));
  }
  return 900;
}

export function FlowParticles() {
  // Reactive toggles: presence of the whole effect and the color scheme.
  const showFlowParticles = useSimStore((s) => s.showFlowParticles);
  const showTempColors = useSimStore((s) => s.showTempColors);

  // Refs to the four geometries so we can flip needsUpdate per frame.
  const bypassRef = useRef<THREE.BufferGeometry>(null!);
  const coreRef = useRef<THREE.BufferGeometry>(null!);
  const combustorRef = useRef<THREE.BufferGeometry>(null!);
  const exhaustRef = useRef<THREE.BufferGeometry>(null!);

  // Material refs so we can fade particles in/out with engine running state.
  const bypassMatRef = useRef<THREE.PointsMaterial>(null!);
  const coreMatRef = useRef<THREE.PointsMaterial>(null!);
  const combustorMatRef = useRef<THREE.PointsMaterial>(null!);
  const exhaustMatRef = useRef<THREE.PointsMaterial>(null!);

  // Scratch objects reused every frame (no per-frame allocations).
  const scratchVec = useMemo(() => new THREE.Vector3(), []);
  const scratchColor = useMemo(() => new THREE.Color(), []);

  // ---- Build the four particle systems once -----------------------------
  const systems = useMemo(() => {
    // (a) BYPASS: a straight annular stream down the fan duct. Radius eases
    //     from ~1.25 near the fan to ~0.95 at the nozzle as the duct narrows.
    const bypass = makeSystem(N_BYPASS, (phase, index, out) => {
      const x = lerp(AXIS.fanPlane, AXIS.bypassNozzleExit, phase);
      const r = lerp(1.25, 0.95, phase);
      const a = bypassAngles[index];
      out.set(x, Math.sin(a) * r, Math.cos(a) * r);
      return out;
    });
    const bypassAngles = bypass.angles;

    // (b) CORE: a swirling stream that hugs the axis through the core. Radius
    //     follows the gas path; the curve is resampled into a LUT for speed.
    const coreLUT = buildCurveLUT([
      new THREE.Vector3(AXIS.fanPlane, 0, 0.25),
      new THREE.Vector3(AXIS.lpcEnd, 0, 0.3),
      new THREE.Vector3(AXIS.hpcEnd, 0, 0.28),
      new THREE.Vector3(AXIS.combustorEnd, 0, 0.3),
      new THREE.Vector3(AXIS.hptEnd, 0, 0.34),
      new THREE.Vector3(AXIS.lptEnd, 0, 0.42),
      new THREE.Vector3(AXIS.coreNozzleExit, 0, 0.18),
    ]);
    const core = makeSystem(N_CORE, (phase, index, out) => {
      sampleLUT(coreLUT, phase, out);
      // The LUT stores the swirl radius in its z component; spin it around X.
      const r = out.z;
      const a = coreAngles[index] + phase * 6.0; // gentle swirl down the path
      out.set(out.x, Math.sin(a) * r, Math.cos(a) * r);
      return out;
    });
    const coreAngles = core.angles;

    // (c) COMBUSTOR: a hot cloud living inside the burner can.
    const combustor = makeSystem(N_COMBUSTOR, (phase, index, out) => {
      const x = lerp(AXIS.combustorStart, AXIS.combustorEnd, phase);
      const r = 0.45 * (0.6 + 0.4 * combustorRadii[index]);
      const a = combustorAngles[index] + phase * 4.0;
      out.set(x, Math.sin(a) * r, Math.cos(a) * r);
      return out;
    });
    const combustorAngles = combustor.angles;
    // Per-particle radial jitter so the cloud has thickness.
    const combustorRadii = new Float32Array(N_COMBUSTOR);
    for (let i = 0; i < N_COMBUSTOR; i++) combustorRadii[i] = Math.random();

    // (d) EXHAUST: two merged plumes trailing aft of the core nozzle. The
    //     first half of the pool is the narrow hot core jet (r~0.25); the
    //     rest is the wider, cooler bypass plume (r~1.0). Both stretch from
    //     the core nozzle exit to x = +2.8 and fade out as they go.
    const exhaustSplit = Math.floor(N_EXHAUST * 0.45);
    const xExhaustEnd = 5.4;
    const exhaust = makeSystem(N_EXHAUST, (phase, index, out) => {
      const isCore = index < exhaustSplit;
      // Core jet leaves the core nozzle; bypass jet leaves the (forward) bypass
      // nozzle annulus. Both trail aft and spread as they go.
      const startX = isCore ? AXIS.coreNozzleExit : AXIS.bypassNozzleExit;
      const x = lerp(startX, xExhaustEnd, phase);
      const baseR = isCore ? 0.28 : 0.85;
      const r = baseR * (1 + phase * 0.5) * (0.5 + 0.5 * exhaustRadii[index]);
      const a = exhaustAngles[index];
      out.set(x, Math.sin(a) * r, Math.cos(a) * r);
      return out;
    });
    const exhaustAngles = exhaust.angles;
    const exhaustRadii = new Float32Array(N_EXHAUST);
    for (let i = 0; i < N_EXHAUST; i++) exhaustRadii[i] = Math.random();

    // Stagger initial phases so streams don't pulse in lockstep.
    for (const sys of [bypass, core, combustor, exhaust]) {
      for (let i = 0; i < sys.count; i++) sys.phases[i] = Math.random();
      // Initialize positions from the starting phases.
      for (let i = 0; i < sys.count; i++) {
        sys.sample(sys.phases[i], i, scratchVec);
        sys.positions[i * 3] = scratchVec.x;
        sys.positions[i * 3 + 1] = scratchVec.y;
        sys.positions[i * 3 + 2] = scratchVec.z;
      }
    }

    return { bypass, core, combustor, exhaust };
    // scratchVec is a stable ref; safe to use in this one-time builder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- (Re)assign colors once and whenever the color toggle changes -----
  useEffect(() => {
    const { bypass, core, combustor, exhaust } = systems;
    const c = scratchColor;

    // (a) Bypass: cool air. Heat scale ~310K, or flat blue when off.
    const bypassFlat = new THREE.Color('#6fd0ff');
    for (let i = 0; i < bypass.count; i++) {
      if (showTempColors) temperatureColor(310, c);
      else c.copy(bypassFlat);
      writeColor(bypass.colors, i, c);
    }

    // (b) Core: temperature mapped along the axial path, or flat orange.
    const coreFlat = new THREE.Color('#ff8a3c');
    for (let i = 0; i < core.count; i++) {
      if (showTempColors) {
        // Sample the axial temperature at this particle's current phase x.
        core.sample(core.phases[i], i, scratchVec);
        temperatureColor(coreTempAtX(scratchVec.x), c);
      } else {
        c.copy(coreFlat);
      }
      writeColor(core.colors, i, c);
    }

    // (c) Combustor: white/orange hot. Heat scale ~1700K either way (it's the
    //     flame zone), with a flat orange fallback tint when colors are off.
    const combustorFlat = new THREE.Color('#ffae5a');
    for (let i = 0; i < combustor.count; i++) {
      if (showTempColors) temperatureColor(1700, c);
      else c.copy(combustorFlat);
      writeColor(combustor.colors, i, c);
    }

    // (d) Exhaust: fade orange -> red along the plume as it cools.
    const exhaustHot = new THREE.Color('#ff8a3c');
    const exhaustCold = new THREE.Color('#ff3b2b');
    for (let i = 0; i < exhaust.count; i++) {
      const fade = exhaust.phases[i]; // farther downstream = cooler/redder
      if (showTempColors) {
        // ~1100K near the exit cooling toward ~600K downstream.
        temperatureColor(lerp(1100, 600, fade), c);
      } else {
        c.copy(exhaustHot).lerp(exhaustCold, fade);
      }
      writeColor(exhaust.colors, i, c);
    }

    // Push the refreshed colors to the GPU.
    bypassRef.current.attributes.color.needsUpdate = true;
    coreRef.current.attributes.color.needsUpdate = true;
    combustorRef.current.attributes.color.needsUpdate = true;
    exhaustRef.current.attributes.color.needsUpdate = true;
  }, [systems, showTempColors, scratchVec, scratchColor]);

  // ---- Per-frame advance -------------------------------------------------
  useFrame((_state, delta) => {
    // Clamp delta so a tab-out / hitch doesn't teleport every particle.
    const dt = Math.min(delta, 0.05);
    const { spool, engine } = useSimStore.getState();

    // Flow tracks the ACTUAL spool speed, so when the engine is shut down
    // (throttle 0 -> spools wind to a stop) the particles stop and fade out.
    const n1 = spool.n1;
    const ductedSpeed = n1 * 0.8; // no floor: stationary when the fan stops
    const exhaustSpeed =
      n1 > 0.02 ? THREE.MathUtils.clamp(engine.coreExhaustVelocity / 600, 0.05, 2.5) : 0;

    advance(systems.bypass, bypassRef.current, ductedSpeed, dt, scratchVec);
    advance(systems.core, coreRef.current, ductedSpeed, dt, scratchVec);
    advance(systems.combustor, combustorRef.current, ductedSpeed, dt, scratchVec);
    advance(systems.exhaust, exhaustRef.current, exhaustSpeed, dt, scratchVec);

    // Fade particle opacity with running state so a stopped engine shows still air.
    const ductedVis = THREE.MathUtils.clamp(n1 * 1.7, 0, 0.92);
    const exhaustVis = THREE.MathUtils.clamp(engine.netThrust / 120000, 0, 0.92) * (n1 > 0.02 ? 1 : 0);
    if (bypassMatRef.current) bypassMatRef.current.opacity = ductedVis;
    if (coreMatRef.current) coreMatRef.current.opacity = ductedVis;
    if (combustorMatRef.current) combustorMatRef.current.opacity = ductedVis;
    if (exhaustMatRef.current) exhaustMatRef.current.opacity = exhaustVis;
  });

  // Bail out cheaply when the effect is disabled. (Hooks above always run, so
  // the rules of hooks are respected regardless of this early return.)
  if (!showFlowParticles) return null;

  return (
    <group>
      <points frustumCulled={false}>
        <bufferGeometry ref={bypassRef}>
          <bufferAttribute attach="attributes-position" args={[systems.bypass.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[systems.bypass.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={bypassMatRef}
          size={POINT_SIZE}
          vertexColors
          transparent
          opacity={0.9}
          sizeAttenuation
          depthWrite={false}
        />
      </points>

      <points frustumCulled={false}>
        <bufferGeometry ref={coreRef}>
          <bufferAttribute attach="attributes-position" args={[systems.core.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[systems.core.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={coreMatRef}
          size={POINT_SIZE}
          vertexColors
          transparent
          opacity={0.9}
          sizeAttenuation
          depthWrite={false}
        />
      </points>

      <points frustumCulled={false}>
        <bufferGeometry ref={combustorRef}>
          <bufferAttribute attach="attributes-position" args={[systems.combustor.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[systems.combustor.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={combustorMatRef}
          size={POINT_SIZE}
          vertexColors
          transparent
          opacity={0.9}
          sizeAttenuation
          depthWrite={false}
        />
      </points>

      <points frustumCulled={false}>
        <bufferGeometry ref={exhaustRef}>
          <bufferAttribute attach="attributes-position" args={[systems.exhaust.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[systems.exhaust.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={exhaustMatRef}
          size={POINT_SIZE}
          vertexColors
          transparent
          opacity={0.9}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
    </group>
  );
}

// --- Module-scope helpers (no per-instance closures needed) ---------------

/** Allocate a particle system's typed arrays and random per-particle angles. */
function makeSystem(
  count: number,
  sample: (phase: number, index: number, out: THREE.Vector3) => THREE.Vector3,
): ParticleSystem {
  const angles = new Float32Array(count);
  for (let i = 0; i < count; i++) angles[i] = Math.random() * Math.PI * 2;
  return {
    count,
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    phases: new Float32Array(count),
    angles,
    sample,
  };
}

/** Write a color into a packed Float32 RGB attribute array. */
function writeColor(arr: Float32Array, index: number, color: THREE.Color): void {
  arr[index * 3] = color.r;
  arr[index * 3 + 1] = color.g;
  arr[index * 3 + 2] = color.b;
}

/**
 * Advance every particle's phase, wrap at 1, recompute its position from the
 * system's path, and flag the geometry's position attribute for upload.
 */
function advance(
  sys: ParticleSystem,
  geo: THREE.BufferGeometry,
  speed: number,
  dt: number,
  out: THREE.Vector3,
): void {
  const pos = sys.positions;
  const step = speed * dt;
  for (let i = 0; i < sys.count; i++) {
    let p = sys.phases[i] + step;
    // Wrap into [0,1). Use a loop-free fract since step is small and bounded.
    p -= Math.floor(p);
    sys.phases[i] = p;
    sys.sample(p, i, out);
    // Guard against any non-finite path output before it reaches the GPU.
    pos[i * 3] = Number.isFinite(out.x) ? out.x : 0;
    pos[i * 3 + 1] = Number.isFinite(out.y) ? out.y : 0;
    pos[i * 3 + 2] = Number.isFinite(out.z) ? out.z : 0;
  }
  geo.attributes.position.needsUpdate = true;
}

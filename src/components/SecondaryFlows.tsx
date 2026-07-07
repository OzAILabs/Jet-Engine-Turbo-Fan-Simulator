/**
 * SecondaryFlows — the flows that keep the engine ALIVE, as animated particle
 * runs (the main gas path already has FlowParticles):
 *
 *   • OIL SUPPLY (yellow): tank → lube & scavenge unit, riding the exact
 *     spline of the existing yellow oil line on the fan case.
 *   • OIL SCAVENGE (darker yellow): lube unit → tank return along its own
 *     thin line (drawn here), closing the loop — oil is a CIRCUIT, not a
 *     one-way feed. Both gated on oil pressure actually existing.
 *   • VBV DUMP (pale air): booster air visibly dumping from the VBV ring
 *     aft-outward into the bypass duct, intensity riding the LIVE door
 *     position from store.actuation — during a start the dump is on, at
 *     climb power it vanishes as the doors shut.
 *   • HPT COOLING (cyan → orange): the ~8% bleed tapped at HPC discharge,
 *     routed around the combustor liner annulus into the HPT roots, heating
 *     up along the way (per-particle color lerp) — why blades survive gas
 *     hotter than their metal.
 *
 * Perf: one merged tube mesh (the scavenge return) + four Points systems =
 * 5 draw calls. Zero per-frame allocation; store read non-reactively in
 * useFrame. Whole component gates on the showSecondaryFlows overlay toggle;
 * oil runs additionally respect layers.accessoryDrive, air runs
 * layers.airBleed. Hidden in exploded view (paths no longer line up).
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS, EXTERNALS, TUBE_COLORS, clockToYZ } from '../data/engineLayout';
import { PADS, padCenterY } from './externals/AccessoryGearbox';

const N_OIL = 46;
const N_SCAV = 46;
const N_VBV = 90;
const N_COOL = 70;
const LUT_SAMPLES = 64;

const pt = (x: number, clock: number, r: number): THREE.Vector3 => {
  const { y, z } = clockToYZ(clock, r);
  return new THREE.Vector3(x, y, z);
};

/** Spaced-point LUT from a default CatmullRom spline (matches TubeGeometry). */
const lutOf = (points: THREE.Vector3[]): THREE.Vector3[] =>
  new THREE.CatmullRomCurve3(points).getSpacedPoints(LUT_SAMPLES);

const sampleLUT = (lut: THREE.Vector3[], phase: number, out: THREE.Vector3): THREE.Vector3 => {
  const f = THREE.MathUtils.clamp(phase, 0, 1) * (lut.length - 1);
  const i = Math.min(Math.floor(f), lut.length - 2);
  return out.copy(lut[i]).lerp(lut[i + 1], f - i);
};

interface FlowSystem {
  count: number;
  positions: Float32Array;
  phases: Float32Array;
  /** Per-particle random lane offsets so runs read as flow, not beads. */
  jitter: Float32Array; // count*3
}

const makeSystem = (count: number): FlowSystem => {
  const s: FlowSystem = {
    count,
    positions: new Float32Array(count * 3),
    phases: new Float32Array(count),
    jitter: new Float32Array(count * 3),
  };
  for (let i = 0; i < count; i++) {
    s.phases[i] = (i / count + 0.61803 * (i % 7)) % 1; // spread, deterministic
    s.jitter[i * 3] = ((i * 37) % 11) / 11 - 0.5;
    s.jitter[i * 3 + 1] = ((i * 53) % 13) / 13 - 0.5;
    s.jitter[i * 3 + 2] = ((i * 71) % 17) / 17 - 0.5;
  }
  return s;
};

const scratch = new THREE.Vector3();

export function SecondaryFlows() {
  const show = useSimStore((s) => s.showSecondaryFlows);
  const exploded = useSimStore((s) => s.viewMode === 'exploded');
  const showOil = useSimStore((s) => s.layers.accessoryDrive);
  const showAir = useSimStore((s) => s.layers.airBleed);

  // --- Paths (anchors straight from engineLayout / the AGB pads) -----------
  const paths = useMemo(() => {
    const ot = EXTERNALS.oilTank;
    const lube = PADS[2];
    const lubeTop = new THREE.Vector3(
      lube.x - 0.05,
      padCenterY(lube.len) + 0.04,
      lube.z + lube.r + 0.03,
    );
    // Supply: the EXACT control points of AccessoryGearbox's oil line.
    const supply = lutOf([
      pt(ot.x + ot.length / 2 - 0.05, ot.clock, ot.r - 0.02),
      pt(-2.1, 8.0, 1.25),
      pt(-1.85, 7.3, 0.85),
      pt(-1.45, 6.8, 0.72),
      lubeTop,
    ]);
    // Scavenge return: lube → tank on its own slightly-offset run.
    const scavengePts = [
      new THREE.Vector3(lube.x + 0.08, padCenterY(lube.len) - lube.len / 2 - 0.02, lube.z + 0.06),
      pt(-1.5, 7.1, 0.8),
      pt(-1.9, 7.65, 1.0),
      pt(-2.2, 8.3, 1.38),
      pt(ot.x - ot.length / 2 + 0.06, ot.clock + 0.15, ot.r - 0.02),
    ];
    const scavenge = lutOf(scavengePts);
    const scavengeTube = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(scavengePts),
      40,
      0.016,
      6,
    );
    // HPT cooling: HPC discharge → around the combustor liner → HPT roots.
    const cooling = lutOf([
      new THREE.Vector3(AXIS.hpcEnd + 0.03, 0.40, 0),
      new THREE.Vector3(AXIS.combustorStart + 0.1, 0.47, 0),
      new THREE.Vector3(AXIS.combustorEnd - 0.15, 0.46, 0),
      new THREE.Vector3(AXIS.hptStart + 0.02, 0.38, 0),
    ]);
    return { supply, scavenge, scavengeTube, cooling };
  }, []);

  const sys = useMemo(
    () => ({
      oil: makeSystem(N_OIL),
      scav: makeSystem(N_SCAV),
      vbv: makeSystem(N_VBV),
      cool: makeSystem(N_COOL),
    }),
    [],
  );

  // Cooling colors: cyan at the tap → orange at the turbine (set once; the
  // particles keep their phase-slot, so a static gradient along phase works).
  const coolColors = useMemo(() => {
    const cold = new THREE.Color('#7fd4ff');
    const hot = new THREE.Color('#ff9a3d');
    const arr = new Float32Array(N_COOL * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N_COOL; i++) {
      c.copy(cold).lerp(hot, sys.cool.phases[i]);
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    return arr;
  }, [sys]);

  const refs = {
    oil: useRef<THREE.Points>(null),
    scav: useRef<THREE.Points>(null),
    vbv: useRef<THREE.Points>(null),
    cool: useRef<THREE.Points>(null),
  };

  useFrame((_, delta) => {
    if (!show || exploded) return;
    const dt = Math.min(delta, 0.1);
    const { instruments, actuation, spool } = useSimStore.getState();

    const writeAlongLUT = (
      ref: THREE.Points | null,
      s: FlowSystem,
      lut: THREE.Vector3[],
      rate: number,
      spread: number,
    ) => {
      if (!ref) return;
      const geo = ref.geometry as THREE.BufferGeometry;
      for (let i = 0; i < s.count; i++) {
        s.phases[i] = (s.phases[i] + rate * dt) % 1;
        sampleLUT(lut, s.phases[i], scratch);
        s.positions[i * 3] = scratch.x + s.jitter[i * 3] * spread;
        s.positions[i * 3 + 1] = scratch.y + s.jitter[i * 3 + 1] * spread;
        s.positions[i * 3 + 2] = scratch.z + s.jitter[i * 3 + 2] * spread;
      }
      geo.attributes.position.needsUpdate = true;
    };

    // Oil circulates once the pump makes pressure (≈ N2 turning).
    const oilRate = Math.min(1, instruments.oilPressurePsi / 30) * 0.22;
    if (showOil) {
      writeAlongLUT(refs.oil.current, sys.oil, paths.supply, oilRate, 0.02);
      writeAlongLUT(refs.scav.current, sys.scav, paths.scavenge, oilRate, 0.02);
      if (refs.oil.current) (refs.oil.current.material as THREE.PointsMaterial).opacity = oilRate > 0.01 ? 0.85 : 0;
      if (refs.scav.current) (refs.scav.current.material as THREE.PointsMaterial).opacity = oilRate > 0.01 ? 0.6 : 0;
    }

    // VBV dump: from the door ring aft-outward into the bypass duct — the
    // particles ride door position (open = dumping) times core flow existing.
    if (showAir) {
      const dump = actuation.vbvOpenFrac * Math.min(1, spool.n2 / 0.3);
      const vbvRef = refs.vbv.current;
      if (vbvRef) {
        const s = sys.vbv;
        const geo = vbvRef.geometry as THREE.BufferGeometry;
        for (let i = 0; i < s.count; i++) {
          s.phases[i] = (s.phases[i] + (0.3 + 0.9 * dump) * dt) % 1;
          const ph = s.phases[i];
          const ang = s.jitter[i * 3] * Math.PI * 2 + s.jitter[i * 3 + 2] * 0.4;
          const r = EXTERNALS.vbv.rOuter + 0.05 + ph * 0.55; // outward…
          s.positions[i * 3] = EXTERNALS.vbv.x + ph * 0.9 + s.jitter[i * 3 + 1] * 0.05; // …and aft
          s.positions[i * 3 + 1] = Math.cos(ang) * r;
          s.positions[i * 3 + 2] = Math.sin(ang) * r;
        }
        geo.attributes.position.needsUpdate = true;
        (vbvRef.material as THREE.PointsMaterial).opacity = 0.5 * dump;
      }

      // Cooling air flows whenever the core flows.
      const coolRate = Math.min(1, spool.n2 / 0.66) * 0.35;
      writeAlongLUT(refs.cool.current, sys.cool, paths.cooling, coolRate, 0.05);
      if (refs.cool.current) {
        (refs.cool.current.material as THREE.PointsMaterial).opacity = spool.n2 > 0.1 ? 0.8 : 0;
      }
    }
  });

  if (!show || exploded) return null;

  const points = (
    key: keyof typeof refs,
    s: FlowSystem,
    color: string | null,
    colors: Float32Array | null,
    size: number,
  ) => (
    <points ref={refs[key]} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[s.positions, 3]} />
        {colors && <bufferAttribute attach="attributes-color" args={[colors, 3]} />}
      </bufferGeometry>
      <pointsMaterial
        size={size}
        color={color ?? undefined}
        vertexColors={!!colors}
        transparent
        opacity={0}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );

  return (
    <group>
      {showOil && (
        <>
          {/* Scavenge return line (the supply line already exists on the AGB). */}
          <mesh geometry={paths.scavengeTube} castShadow={false}>
            <meshStandardMaterial color={TUBE_COLORS.oil} metalness={0.6} roughness={0.5} />
          </mesh>
          {points('oil', sys.oil, TUBE_COLORS.oil, null, 0.035)}
          {points('scav', sys.scav, '#8a6a18', null, 0.03)}
        </>
      )}
      {showAir && (
        <>
          {points('vbv', sys.vbv, '#bcd8e8', null, 0.04)}
          {points('cool', sys.cool, null, coolColors, 0.045)}
        </>
      )}
    </group>
  );
}

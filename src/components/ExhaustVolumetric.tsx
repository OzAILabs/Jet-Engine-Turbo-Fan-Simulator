/**
 * ExhaustVolumetric — the "Realistic" exhaust. A ~900 K core jet does NOT glow
 * orange in daylight: what you actually see behind a big turbofan is a faint
 * neutral haze of combustion products and heat-sheared air. Two CPU-advected
 * THREE.Points streams (narrow hot core jet + wide bypass annulus) render as
 * round, normal-blended gas parcels whose opacity follows optical depth —
 * densest on the core axis just aft of the nozzle, thinning with radius and
 * downstream phase — with at most a whisper of warm tint near the nozzle at
 * high EGT. No additive glow, no streak capsules.
 *
 * All drive comes from plumeDrive() (exhaustConstants.ts): no flame = no
 * plume (off / dry motoring renders NOTHING), a wispy shimmer at idle, a long
 * turbulent column at takeoff — plus the brief dark smoke puff a real GE90
 * shows at the core nozzle on light-off.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AXIS } from '../data/engineLayout';
import { clamp } from '../sim/units';
import { plumeDrive, CORE_VEL_REF, BYPASS_VEL_REF } from './exhaustConstants';

const CORE_START = AXIS.coreNozzleExit; // ~3.05
const BYPASS_START = AXIS.bypassNozzleExit; // ~2.55

/** Real jet velocity [m/s] -> on-screen phase advance (sceneSpeed ~= jetVel * PHASE_K). */
const PHASE_K = 0.016;
/** Advection floor [m/s] so the light-off puff still drifts aft at sub-idle. */
const MIN_ADVECT_VEL = 40;

const CORE_COUNT = 2600;
const BYPASS_COUNT = 1200;

// Near-neutral gas tints (NormalBlending) — the plume reads through OPACITY
// over whatever sits behind it, never through additive fire colors.
const CORE_GRAY = new THREE.Color(0.6, 0.6, 0.61);
const CORE_WARM = new THREE.Color(0.78, 0.65, 0.48); // faint near-nozzle warmth at high EGT
const SMOKE = new THREE.Color(0.21, 0.2, 0.19); // light-off soot puff
const BYPASS_GRAY = new THREE.Color(0.66, 0.68, 0.71); // cooler shear-layer haze

interface JetSpec {
  count: number;
  start: number;
  baseRadius: number;
  spread: number;
  length: number;
  turb: number;
}

interface JetBuffers extends JetSpec {
  geom: THREE.BufferGeometry;
  positions: Float32Array;
  colors: Float32Array;
  alphas: Float32Array;
  scales: Float32Array;
  phase: Float32Array;
  ang: Float32Array;
  rseed: Float32Array;
  noiseA: Float32Array;
  noiseB: Float32Array;
  rate: Float32Array;
}

function buildJet(spec: JetSpec): JetBuffers {
  const { count } = spec;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const scales = new Float32Array(count);
  const phase = new Float32Array(count);
  const ang = new Float32Array(count);
  const rseed = new Float32Array(count);
  const noiseA = new Float32Array(count);
  const noiseB = new Float32Array(count);
  const rate = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    phase[i] = Math.random();
    ang[i] = Math.random() * Math.PI * 2;
    // Bias toward the centerline so the optical column is dense with a wispy skirt.
    rseed[i] = Math.sqrt(Math.random()) * (0.55 + 0.45 * Math.random());
    noiseA[i] = Math.random() * Math.PI * 2;
    noiseB[i] = Math.random() * Math.PI * 2;
    rate[i] = 0.7 + Math.random() * 0.6;
    scales[i] = 1;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geom.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  return { ...spec, geom, positions, colors, alphas, scales, phase, ang, rseed, noiseA, noiseB, rate };
}

/**
 * PointsMaterial extended with per-particle alpha + size attributes and a
 * round gaussian falloff — soft spherical gas parcels. (The old capsule
 * streaks stretched across the flow direction and oversold velocity; round
 * sprites are the honest primitive for a subsonic-looking haze.)
 */
function makeHazeMaterial(baseSize: number): THREE.PointsMaterial {
  const mat = new THREE.PointsMaterial({
    size: baseSize,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float aAlpha;\nattribute float aScale;\nvarying float vAlpha;\n' + shader.vertexShader;
    // gl_PointSize is assigned AFTER #include <project_vertex>, so hook the
    // assignment itself rather than the include.
    shader.vertexShader = shader.vertexShader.replace(
      'gl_PointSize = size;',
      'gl_PointSize = size * aScale;\nvAlpha = aAlpha;',
    );
    shader.fragmentShader = 'varying float vAlpha;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <premultiplied_alpha_fragment>',
      [
        '// Round soft-edged gas parcel: gaussian core, clean zero at the rim.',
        'vec2 pcc = gl_PointCoord - vec2(0.5);',
        'float rr = length(pcc) * 2.0;',
        'float soft = exp(-rr * rr * 2.8) * (1.0 - smoothstep(0.75, 1.0, rr));',
        'gl_FragColor.a *= soft * vAlpha;',
        'if (gl_FragColor.a < 0.002) discard;',
        '#include <premultiplied_alpha_fragment>',
      ].join('\n'),
    );
  };
  return mat;
}

/** Per-frame, per-stream drive values handed to the advection loop. */
interface JetFrame {
  phaseRate: number;
  /** Jet velocity / takeoff reference. */
  velN: number;
  baseColor: THREE.Color;
  /** EGT tint target (core stream only). */
  warmColor: THREE.Color | null;
  egtN: number;
  /** Stream-level peak opacity. */
  alphaBudget: number;
  /** runFactor × thrust shaping — the engine-state density gate. */
  gate: number;
  /** Light-off smoke envelope (core stream only). */
  puff: number;
}

export function ExhaustVolumetric() {
  const groupRef = useRef<THREE.Group>(null);
  const core = useMemo(
    () => buildJet({ count: CORE_COUNT, start: CORE_START, baseRadius: 0.3, spread: 1.7, length: 6.0, turb: 0.22 }),
    [],
  );
  const bypass = useMemo(
    () => buildJet({ count: BYPASS_COUNT, start: BYPASS_START, baseRadius: 0.85, spread: 1.35, length: 4.4, turb: 0.34 }),
    [],
  );

  const coreMat = useMemo(() => makeHazeMaterial(0.3), []);
  const bypassMat = useMemo(() => makeHazeMaterial(0.42), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  const advanceJet = (jet: JetBuffers, dt: number, t: number, f: JetFrame) => {
    const { count, positions, colors, alphas, scales, phase, ang, rseed, noiseA, noiseB, rate } = jet;
    const lenScale = clamp(0.45 + f.velN * 0.9, 0.45, 1.6); // idle: stubby wisp; takeoff: long jet
    const length = jet.length * lenScale;
    const radGrow = jet.spread * (0.8 + 0.4 * f.velN);
    const turbAmp = jet.turb * (0.6 + 0.8 * f.velN);

    for (let i = 0; i < count; i++) {
      let p = phase[i] + f.phaseRate * rate[i] * dt;
      p -= Math.floor(p);
      phase[i] = p;

      const x = jet.start + p * length;
      const r = jet.baseRadius * rseed[i] * (0.4 + p * radGrow);
      const a = ang[i] + p * 1.6 + t * 0.4; // gentle bulk swirl
      const tb = turbAmp * (0.2 + p);
      const ty = tb * (Math.sin(noiseA[i] + p * 9.0 + t * 2.6) + 0.5 * Math.sin(noiseB[i] * 1.7 + p * 17.0 + t * 4.1));
      const tz = tb * (Math.cos(noiseB[i] + p * 8.0 + t * 2.2) + 0.5 * Math.cos(noiseA[i] * 1.3 + p * 15.0 + t * 3.4));

      positions[i * 3] = x;
      positions[i * 3 + 1] = Math.sin(a) * r + ty;
      positions[i * 3 + 2] = Math.cos(a) * r + tz;

      // Recycle-pop fix: fade in across the first 5% of phase, and reach
      // EXACTLY zero at phase 1.0 via the (1 - p) factor.
      const fi = clamp(p / 0.05, 0, 1);
      const fadeIn = fi * fi * (3 - 2 * fi);
      const env = fadeIn * (1 - p);

      // Optical depth: parcels near the axis (small rseed) sit inside a
      // thicker gas column; everything thins as the plume mixes downstream.
      const depth = (1 - 0.55 * rseed[i]) * (1 - 0.45 * p);
      let alpha = f.alphaBudget * env * depth * f.gate;

      // Near-neutral haze; only a faint warm cast survives right at the
      // nozzle at high EGT — a ~900 K jet does not glow orange in daylight.
      tmpColor.copy(f.baseColor);
      if (f.warmColor) {
        const warmth = f.egtN * (1 - p) * (1 - p) * 0.45;
        if (warmth > 0.004) tmpColor.lerp(f.warmColor, clamp(warmth, 0, 0.5));
      }

      // Parcels expand as the jet entrains ambient air.
      let scale = 0.75 + 0.7 * p + 0.3 * f.velN;

      // Light-off puff: parcels just aft of the core nozzle darken to soot,
      // thicken and briefly swell, then the envelope decays over ~2 s.
      if (f.puff > 0.002 && p < 0.35) {
        const s = f.puff * (1 - p / 0.35);
        tmpColor.lerp(SMOKE, s * 0.85);
        alpha += s * 0.3 * fadeIn;
        scale *= 1 + s * 0.9;
      }

      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
      alphas[i] = clamp(alpha, 0, 0.85);
      scales[i] = scale;
    }
    jet.geom.attributes.position.needsUpdate = true;
    jet.geom.attributes.color.needsUpdate = true;
    jet.geom.attributes.aAlpha.needsUpdate = true;
    jet.geom.attributes.aScale.needsUpdate = true;
  };

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const drive = plumeDrive();

    // Engine-state master gate: no flame = no plume at all (and no CPU work).
    const visible = drive.runFactor > 0.002;
    if (groupRef.current) groupRef.current.visible = visible;
    if (!visible) return;

    // Physical jet velocities back out of the normalized drive; the floor
    // keeps the light-off puff drifting aft while the core barely pumps.
    const coreVel = Math.max(drive.coreVelN * CORE_VEL_REF, MIN_ADVECT_VEL);
    const bypassVel = Math.max(drive.bypassVelN * BYPASS_VEL_REF, MIN_ADVECT_VEL * 0.6);

    // Overall density: gated by run state, shaped by thrust — wispy shimmer
    // at idle, dense turbulent column at takeoff.
    const gate = drive.runFactor * (0.25 + 0.75 * drive.thrustFrac);

    advanceJet(core, dt, t, {
      phaseRate: (coreVel * PHASE_K * 1.15) / core.length, // core rushes slightly faster on screen
      velN: drive.coreVelN,
      baseColor: CORE_GRAY,
      warmColor: CORE_WARM,
      egtN: drive.egtN,
      alphaBudget: 0.34,
      gate,
      puff: drive.startPuff,
    });
    advanceJet(bypass, dt, t, {
      phaseRate: (bypassVel * PHASE_K * 0.62) / bypass.length,
      velN: drive.bypassVelN,
      baseColor: BYPASS_GRAY,
      warmColor: null,
      egtN: 0,
      alphaBudget: 0.16,
      gate,
      puff: 0,
    });
  });

  return (
    <group ref={groupRef}>
      {/* Wide, cool bypass haze (drawn first so the denser core column reads on top). */}
      <points geometry={bypass.geom} material={bypassMat} frustumCulled={false} />
      {/* Core gas column: densest on-axis, neutral gray, faint warmth at high EGT. */}
      <points geometry={core.geom} material={coreMat} frustumCulled={false} />
    </group>
  );
}

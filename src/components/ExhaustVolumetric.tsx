/**
 * ExhaustVolumetric — the "Realistic" exhaust: a very subtle, mostly-translucent
 * warm jet (a hint of hot gas streaming aft, NOT a flame). Two additive
 * THREE.Points layers (a hotter core and a cooler bypass) are advected
 * downstream with sum-of-sines turbulence and a per-point motion-blur streak
 * (PointsMaterial.onBeforeCompile). Color grades warm — orange → deep red,
 * fading out via brightness (never through the blue/green part of the general
 * temperature scale). Everything scales with thrust/velocity and fades to
 * nothing when the engine is shut down.
 */
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS } from '../data/engineLayout';
import { clamp } from '../sim/units';

const CORE_START = AXIS.coreNozzleExit; // ~3.05
const BYPASS_START = AXIS.bypassNozzleExit; // ~2.55

/** Real jet velocity [m/s] -> on-screen phase advance (sceneSpeed ~= jetVel * PHASE_K). */
const PHASE_K = 0.016;
const CORE_VEL_REF = 620; // m/s near takeoff
const BYPASS_VEL_REF = 300; // m/s near takeoff
const THRUST_REF = 420000; // N — full-power normalization

const CORE_COUNT = 2600;
const BYPASS_COUNT = 1200;

// Warm exhaust gradients — kept strictly in the incandescent orange→red range so
// cooling gas never turns green/blue. The tail disappears via brightness, not hue.
const CORE_HOT = new THREE.Color(1.0, 0.58, 0.26); // dull cherry/orange (EGT glow)
const CORE_COOL = new THREE.Color(0.38, 0.07, 0.02); // deep red-brown tail
const CORE_HEAD = new THREE.Color(1.0, 0.86, 0.62); // brighter near-nozzle head
const BYPASS_HOT = new THREE.Color(0.5, 0.54, 0.6); // faint neutral warm-grey air
const BYPASS_COOL = new THREE.Color(0.14, 0.16, 0.2);

interface JetSpec {
  count: number;
  start: number;
  baseRadius: number;
  spread: number;
  length: number;
  turb: number;
  speedMul: number;
}

interface JetBuffers extends JetSpec {
  geom: THREE.BufferGeometry;
  positions: Float32Array;
  colors: Float32Array;
  pointSpeed: Float32Array;
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
  const pointSpeed = new Float32Array(count);
  const phase = new Float32Array(count);
  const ang = new Float32Array(count);
  const rseed = new Float32Array(count);
  const noiseA = new Float32Array(count);
  const noiseB = new Float32Array(count);
  const rate = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    phase[i] = Math.random();
    ang[i] = Math.random() * Math.PI * 2;
    // Bias toward the centerline so the jet has a dense core and a wispy skirt.
    rseed[i] = Math.sqrt(Math.random()) * (0.55 + 0.45 * Math.random());
    noiseA[i] = Math.random() * Math.PI * 2;
    noiseB[i] = Math.random() * Math.PI * 2;
    rate[i] = 0.7 + Math.random() * 0.6;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setAttribute('aSpeed', new THREE.BufferAttribute(pointSpeed, 1));
  return { ...spec, geom, positions, colors, pointSpeed, phase, ang, rseed, noiseA, noiseB, rate };
}

/** A live-shader handle parked on a material's userData by onBeforeCompile. */
interface StreakUserData {
  shader?: THREE.WebGLProgramParametersWithUniforms;
}

/**
 * A PointsMaterial that stretches each point along +X by a per-point speed
 * attribute, scaled by a live uniform — the motion-blur cue (faster ⇒ longer).
 */
function makeStreakMaterial(baseSize: number): THREE.PointsMaterial {
  const mat = new THREE.PointsMaterial({
    size: baseSize,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStreak = { value: 1.0 };
    shader.vertexShader =
      'attribute float aSpeed;\nuniform float uStreak;\nvarying float vStreak;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      [
        '#include <project_vertex>',
        'float streak = 1.0 + aSpeed * uStreak;',
        'vStreak = streak;',
        'gl_PointSize *= (1.0 + 0.85 * (streak - 1.0));',
      ].join('\n'),
    );
    shader.fragmentShader = 'varying float vStreak;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <premultiplied_alpha_fragment>',
      [
        'vec2 pc = gl_PointCoord - vec2(0.5);',
        'float sx = pc.x / (0.5 * vStreak);',
        'float sy = pc.y / 0.5;',
        'float d = sqrt(sx * sx + sy * sy);',
        'float capsule = smoothstep(1.0, 0.15, d);',
        'float head = smoothstep(0.0, 1.0, 0.5 - pc.x);',
        'gl_FragColor.a *= capsule * (0.55 + 0.65 * head);',
        '#include <premultiplied_alpha_fragment>',
      ].join('\n'),
    );
    (mat.userData as StreakUserData).shader = shader;
  };
  return mat;
}

export function ExhaustVolumetric() {
  const core = useMemo(
    () => buildJet({ count: CORE_COUNT, start: CORE_START, baseRadius: 0.3, spread: 1.7, length: 6.0, turb: 0.22, speedMul: 1.15 }),
    [],
  );
  const bypass = useMemo(
    () => buildJet({ count: BYPASS_COUNT, start: BYPASS_START, baseRadius: 0.85, spread: 1.35, length: 4.4, turb: 0.34, speedMul: 0.62 }),
    [],
  );

  const coreMat = useMemo(() => makeStreakMaterial(0.26), []);
  const bypassMat = useMemo(() => makeStreakMaterial(0.34), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  const advanceJet = (
    jet: JetBuffers,
    dt: number,
    t: number,
    phaseRate: number,
    velNorm: number,
    hotColor: THREE.Color,
    coolColor: THREE.Color,
    headHeat: number,
    brightMul: number,
    vis: number,
  ) => {
    const { count, positions, colors, pointSpeed, phase, ang, rseed, noiseA, noiseB, rate } = jet;
    const lenScale = clamp(0.45 + velNorm * 0.9, 0.45, 1.6);
    const length = jet.length * lenScale;
    const radGrow = jet.spread * (0.8 + 0.4 * velNorm);
    const turbAmp = jet.turb * (0.7 + 0.6 * velNorm);

    for (let i = 0; i < count; i++) {
      let p = phase[i] + phaseRate * rate[i] * dt;
      p -= Math.floor(p);
      phase[i] = p;

      const x = jet.start + p * length;
      const r = jet.baseRadius * rseed[i] * (0.4 + p * radGrow);
      const a = ang[i] + p * 1.6 + t * 0.4; // gentle swirl
      const tb = turbAmp * (0.2 + p);
      const ty = tb * (Math.sin(noiseA[i] + p * 9.0 + t * 2.6) + 0.5 * Math.sin(noiseB[i] * 1.7 + p * 17.0 + t * 4.1));
      const tz = tb * (Math.cos(noiseB[i] + p * 8.0 + t * 2.2) + 0.5 * Math.cos(noiseA[i] * 1.3 + p * 15.0 + t * 3.4));

      positions[i * 3] = x;
      positions[i * 3 + 1] = Math.sin(a) * r + ty;
      positions[i * 3 + 2] = Math.cos(a) * r + tz;

      pointSpeed[i] = velNorm * (1.0 - 0.6 * p);

      // Warm gradient (orange → deep red); fade via brightness, never hue.
      tmpColor.copy(hotColor).lerp(coolColor, Math.pow(p, 0.7));
      const headBoost = headHeat * (1.0 - p) * (1.0 - p);
      if (headBoost > 0.001) tmpColor.lerp(CORE_HEAD, clamp(headBoost * (0.4 + velNorm * 0.5), 0, 0.85));
      const bright = vis * brightMul * (0.16 + 0.84 * (1.0 - p)) * (0.5 + 0.6 * velNorm);
      colors[i * 3] = tmpColor.r * bright;
      colors[i * 3 + 1] = tmpColor.g * bright;
      colors[i * 3 + 2] = tmpColor.b * bright;
    }
    jet.geom.attributes.position.needsUpdate = true;
    jet.geom.attributes.color.needsUpdate = true;
    jet.geom.attributes.aSpeed.needsUpdate = true;
  };

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const { engine, spool } = useSimStore.getState();

    const run = clamp(spool.n1, 0, 1);
    const thrustFrac = clamp(engine.netThrust / THRUST_REF, 0, 1);
    const coreVel = engine.coreExhaustVelocity;
    const bypassVel = engine.bypassExhaustVelocity;
    const vis = clamp(Math.min(run * 1.4, 0.2 + thrustFrac * 1.2), 0, 1) * run;

    const coreVelNorm = clamp(coreVel / CORE_VEL_REF, 0, 1.35);
    const bypassVelNorm = clamp(bypassVel / BYPASS_VEL_REF, 0, 1.35);
    const corePhaseRate = (coreVel * PHASE_K * core.speedMul) / core.length;
    const bypassPhaseRate = (bypassVel * PHASE_K * bypass.speedMul) / bypass.length;

    const coreHeadHeat = clamp((engine.exhaustGasTemp - 650) / 700, 0, 1);
    advanceJet(core, dt, t, corePhaseRate, coreVelNorm, CORE_HOT, CORE_COOL, coreHeadHeat, 0.7, vis);
    advanceJet(bypass, dt, t, bypassPhaseRate, bypassVelNorm, BYPASS_HOT, BYPASS_COOL, 0, 0.38, vis * 0.6);

    const coreShader = (coreMat.userData as StreakUserData).shader;
    if (coreShader) coreShader.uniforms.uStreak.value = 1.6;
    const bypassShader = (bypassMat.userData as StreakUserData).shader;
    if (bypassShader) bypassShader.uniforms.uStreak.value = 1.2;
  });

  return (
    <group>
      {/* Wider, cooler bypass jet (drawn first so the hot core overlays it). */}
      <points geometry={bypass.geom} material={bypassMat} frustumCulled={false} />
      {/* Hot, fast, turbulent core jet with motion-blur streaks. */}
      <points geometry={core.geom} material={coreMat} frustumCulled={false} />
    </group>
  );
}

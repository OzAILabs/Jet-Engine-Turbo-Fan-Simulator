/**
 * ExhaustShader — a GPU-driven, turbulent commercial turbofan exhaust plume.
 *
 * This REPLACES the old faint translucent cone. There is no static cone mesh
 * here: the plume is a single THREE.Points cloud driven entirely by one custom
 * THREE.ShaderMaterial (inline GLSL, normal-blended, one draw call). Every particle
 * is advected in the VERTEX shader from a uniform time plus per-particle
 * attributes (seed / phase / lane), recycled with fract(phase + time * speed),
 * displaced by smooth sum-of-sines turbulence so the shear layer billows, and
 * softened along the screen-projected flow direction to read as motion blur
 * without resolving into straight particle streaks.
 *
 * The FRAGMENT shader gives each particle a soft, flow-aligned falloff and
 * refracts the previously-captured scene through it (true heat shimmer). The
 * plume is intentionally neutral, translucent, and irregular: commercial
 * turbofan exhaust is mainly visible as heat-distorted air, not flame. When
 * the core nozzle CHOKES at high power, a damped periodic brightness train
 * (~4 shock cells, fading downstream) appears along the core jet via uChoked.
 *
 * Everything is HARD GATED on combustion through plumeDrive()
 * (exhaustConstants.ts): an engine that is off or merely dry-motoring renders
 * no plume at all — and skips the whole-scene FBO capture entirely. Live
 * engine data is read non-reactively inside useFrame via getState() and
 * pushed into the material uniforms (mutated in place — never reallocated).
 */
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useFBO } from '@react-three/drei';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS } from '../data/engineLayout';
import { clamp, lerp } from '../sim/units';
import { temperatureColor } from '../util/colorScale';
import { plumeDrive } from './exhaustConstants';

// --- Tunables -------------------------------------------------------------

/** Total particles across both jets. ~3000 -> one cheap draw call at 60fps. */
const CORE_COUNT = 1900;
const BYPASS_COUNT = 1100;
const TOTAL = CORE_COUNT + BYPASS_COUNT;

/**
 * Real jet velocity -> on-screen advection speed.
 *
 *   sceneSpeed [units/s] = jetVelocity [m/s] * K_SPEED
 *
 * With K_SPEED = 0.016 the core jet (~310 m/s idle .. ~640 m/s takeoff) rushes
 * aft at ~5..10 units/s, i.e. fast but trackable. Because each particle's phase
 * advances by sceneSpeed / plumeLength per second, faster gas both recycles
 * quicker AND (via vStretch below) draws longer streaks, selling raw speed.
 */
const K_SPEED = 0.016;

/** Core jet: narrow, blistering hot, leaves the core nozzle on the axis. */
const CORE_START = AXIS.coreNozzleExit; // ~3.05
const CORE_BASE_RADIUS = 0.3;
/** Bypass jet: wide, cooler, slower, leaves the fan-cowl annulus forward. */
const BYPASS_START = AXIS.bypassNozzleExit; // ~2.55
const BYPASS_BASE_RADIUS = 0.85;

// Normalization references (rated thrust / takeoff jet velocities) and the
// per-frame drive gate all live in exhaustConstants.ts, shared with the
// "Realistic" ExhaustVolumetric renderer.

// =========================================================================
// GLSL
// =========================================================================
//
// Written in three.js' default (GLSL ES 1.00-style) shader syntax — three
// rewrites attribute/varying for WebGL2 automatically, so this is valid on
// WebGL2 contexts. No #version / in / out needed.

const VERT = /* glsl */ `
  precision highp float;

  // Per-particle attributes.
  attribute float aPhase;   // 0..1 start offset along the jet
  attribute float aSeed;    // random angle / phase seed
  attribute float aRadial;  // 0..1 radial band (lane thickness)
  attribute float aLane;    // 0.0 = core jet, 1.0 = bypass jet

  // Per-frame uniforms (mutated in JS, never reallocated).
  uniform float uTime;
  uniform float uCoreSpeed;    // scene units/s for the core jet
  uniform float uBypassSpeed;  // scene units/s for the bypass jet
  uniform float uCoreLen;      // core plume length (units)
  uniform float uBypassLen;    // bypass plume length (units)
  uniform float uCoreVis;      // 0..1 core intensity (thrust/runFactor gated)
  uniform float uBypassVis;    // 0..1 bypass intensity
  uniform float uTurb;         // turbulence amplitude scale 0..1+
  uniform float uPixelRatio;   // device pixel ratio (point-size scaling)
  uniform float uHeat;         // 0..1 overall heat (drives incandescence)
  uniform float uSizeBoost;    // extra point-size multiplier (blur for haze mode)

  // To the fragment shader.
  varying float vT;        // 0..1 normalized downstream coordinate
  varying float vCore;     // 1.0 for core particles, 0.0 for bypass
  varying float vBright;   // per-particle brightness (vis * life)
  varying float vNoise;    // irregular density/distortion strength
  varying vec2  vFlowDir;  // screen-space flow direction (for streak stretch)
  varying float vStretch;  // streak elongation factor (>=1)

  // Cheap smooth value-ish noise from sums of sines (no textures).
  float wobble(float a, float b, float c) {
    return sin(a) * 0.5 + sin(b) * 0.33 + sin(c) * 0.17;
  }

  void main() {
    float isCore = step(aLane, 0.5); // 1.0 if core, else 0.0
    vCore = isCore;

    float speed = mix(uBypassSpeed, uCoreSpeed, isCore);
    float len   = mix(uBypassLen,   uCoreLen,   isCore);
    float vis   = mix(uBypassVis,   uCoreVis,   isCore);
    float start = mix(${BYPASS_START.toFixed(3)}, ${CORE_START.toFixed(3)}, isCore);
    float baseR = mix(${BYPASS_BASE_RADIUS.toFixed(3)}, ${CORE_BASE_RADIUS.toFixed(3)}, isCore);

    // Per-particle phase-rate jitter so the jet doesn't pulse in lockstep.
    float rate = (0.75 + 0.55 * fract(aSeed * 0.731)) * speed / max(len, 0.001);
    float p = fract(aPhase + uTime * rate); // 0..1 downstream progress
    vT = p;

    // Axial position: rush straight aft along +X.
    float x = start + p * len;

    // Keep a dense, almost invisible center and concentrate visible distortion
    // in the turbulent shear layers. Multiple seed-dependent terms prevent a
    // clean cone edge or radial lanes.
    float spread = mix(1.18, 0.92, isCore);
    float radialJitter = 0.82 + 0.28 * wobble(aSeed * 31.7, aSeed * 17.1 + p * 8.3, aSeed * 9.2 - p * 13.0);
    float r = baseR * (0.18 + p * spread) * (0.24 + 0.96 * aRadial) * radialJitter;

    // Swirl + turbulent billowing (smooth, time-varying sum of sines).
    float ang = aSeed * 6.2831853 + p * mix(1.1, 1.8, isCore);
    float amp = uTurb * baseR * (0.08 + 0.72 * p);
    float tx = uTime * (3.4 + isCore * 1.4);
    float wy = wobble(aSeed * 12.7 + p * 11.0 + tx,
                      aSeed * 5.1  + p * 6.3  + tx * 0.7,
                      aSeed * 21.3 + p * 17.0 + tx * 1.3);
    float wz = wobble(aSeed * 9.4  + p * 9.7  + tx * 0.9 + 1.7,
                      aSeed * 15.8 + p * 7.1  + tx * 1.1 + 0.3,
                      aSeed * 3.2  + p * 19.0 + tx * 0.6 + 2.4);

    float y = sin(ang) * r + amp * wy;
    float z = cos(ang) * r + amp * wz;
    float axisDist = length(vec2(y, z));

    vec3 worldPos = vec3(x, y, z);

    // Irregular pockets appear and disappear as they rush downstream. (Shock
    // cells are NOT faked here — the fragment stage adds them, gated by the
    // live choked-nozzle flag via uChoked.)
    float pocketA = wobble(aSeed * 41.3 + p * 19.0 - tx * 1.4,
                           aSeed * 13.7 - p * 31.0 + tx * 0.8,
                           aSeed * 67.1 + p * 7.0 - tx * 2.1);
    float pocketB = wobble(aSeed * 23.9 - p * 11.0 + tx * 1.7,
                           aSeed * 53.2 + p * 27.0 - tx,
                           aSeed * 5.7 - p * 43.0 + tx * 0.6);
    vNoise = smoothstep(-0.42, 0.58, pocketA * 0.65 + pocketB * 0.35);

    // Visible density is strongest in the shear layer and breaks apart aft.
    // Recycle-pop fix: the envelope eases in over the first 5% of phase and is
    // EXACTLY zero at phase 1.0 (the old 0.32 life floor made every respawn a
    // visible pop at the nozzle).
    float env = smoothstep(0.0, 0.05, p) * (1.0 - smoothstep(0.72, 1.0, p));
    float life = 1.0 - smoothstep(0.18, 1.0, p);
    float shear = smoothstep(baseR * 0.08, baseR * (0.9 + p), axisDist);
    vBright = vis * (0.18 + 0.82 * vNoise) * (0.35 + 0.65 * shear) * env * (0.45 + 0.55 * life);

    // --- Projection + screen-space flow direction (for motion blur) -----
    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    vec4 clip = projectionMatrix * mvPos;
    gl_Position = clip;

    // Project a short +X flow step into clip space, then NDC, to learn which
    // screen direction "downstream" points so the fragment can streak along it.
    vec4 mvAhead = mvPos + modelViewMatrix * vec4(0.06, 0.0, 0.0, 0.0);
    vec4 clipAhead = projectionMatrix * mvAhead;
    vec2 ndc0 = clip.xy / max(clip.w, 1e-4);
    vec2 ndc1 = clipAhead.xy / max(clipAhead.w, 1e-4);
    vec2 dir = ndc1 - ndc0;
    float dlen = length(dir);
    vFlowDir = dlen > 1e-5 ? dir / dlen : vec2(1.0, 0.0);

    // Speed broadens the soft directional blur, but it stays short enough that
    // individual particles never resolve into straight lines.
    vStretch = 1.0 + clamp(speed * 0.16, 0.0, 1.7) * mix(0.7, 1.0, isCore);

    // Point size: bigger near the nozzle, attenuated by distance, scaled by
    // device pixel ratio. Hotter/denser at high heat. The fragment shader
    // applies the directional stretch within this (square) point sprite, so we
    // size the sprite to fit the elongated streak.
    float sizeBase = mix(5.8, 4.2, isCore) * (0.72 + 0.65 * vNoise) * (0.78 + 0.35 * uHeat);
    float pointPx = sizeBase * uPixelRatio * (300.0 / max(-mvPos.z, 1.0));
    gl_PointSize = clamp(pointPx * vStretch * uSizeBoost, 1.0, 120.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uHotColor;
  uniform vec3 uMidColor;
  uniform vec3 uCoolColor;
  uniform vec3 uBypassHot;
  uniform vec3 uBypassCool;
  uniform float uOpacity;   // global fade (engine running state)
  uniform float uChoked;    // 0..1 shock-cell strength (thrustFrac while choked)
  uniform sampler2D uSceneTexture;
  uniform vec2 uResolution;
  uniform float uDistort;

  varying float vT;
  varying float vCore;
  varying float vBright;
  varying float vNoise;
  varying vec2  vFlowDir;
  varying float vStretch;

  void main() {
    // Centered point coords in [-1,1].
    vec2 pc = gl_PointCoord * 2.0 - 1.0;

    // Rotate into the flow frame so we can stretch ALONG the screen flow dir.
    // (vFlowDir.y is NDC where +Y is up; gl_PointCoord.y grows downward, so
    // flip Y to align the two frames.)
    vec2 f = vec2(vFlowDir.x, -vFlowDir.y);
    vec2 perp = vec2(-f.y, f.x);
    float along = dot(pc, f);
    float across = dot(pc, perp);

    // Soft directional blur. A pair of offset lobes makes the plume feel fast
    // while avoiding the crisp capsule/streak silhouette of the old effect.
    float a = along / vStretch;
    float d2 = a * a + across * across;
    float fall = exp(-d2 * 2.25);
    float wake = exp(-(pow((along + 0.32) / (vStretch + 0.4), 2.0) + across * across) * 3.0);
    float edgeBreakup = 0.72 + 0.28 * sin((along * 3.7 + across * 5.1 + vNoise * 4.0) * 3.14159);
    float mask = clamp((fall * 0.72 + wake * 0.28) * edgeBreakup, 0.0, 1.0);
    if (mask < 0.004) discard;

    // Neutral warm/cool air tones. These remain deliberately desaturated so
    // the effect reads as distorted hot air rather than combustion flame.
    vec3 hotCool;
    if (vCore > 0.5) {
      vec3 mid = mix(uHotColor, uMidColor, smoothstep(0.0, 0.4, vT));
      hotCool = mix(mid, uCoolColor, smoothstep(0.3, 1.0, vT));
    } else {
      hotCool = mix(uBypassHot, uBypassCool, smoothstep(0.0, 1.0, vT));
    }

    // Sample the already-rendered scene at several irregular offsets. Blending
    // the displaced/blurred scene back over itself creates true heat shimmer:
    // the plume remains see-through instead of becoming smoke or a flame.
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    vec2 flowOffset = f * uDistort * (0.45 + vNoise * 0.8);
    vec2 crossOffset = perp * uDistort * (vNoise - 0.5) * 1.8;
    vec2 texelGuard = 2.0 / uResolution;
    vec2 uvA = clamp(screenUv + flowOffset + crossOffset, texelGuard, 1.0 - texelGuard);
    vec2 uvB = clamp(screenUv - flowOffset * 0.65 + crossOffset * 0.5, texelGuard, 1.0 - texelGuard);
    vec2 uvC = clamp(screenUv + perp * uDistort * 1.2, texelGuard, 1.0 - texelGuard);
    vec3 refracted = texture2D(uSceneTexture, uvA).rgb;
    refracted += texture2D(uSceneTexture, uvB).rgb;
    refracted += texture2D(uSceneTexture, uvC).rgb;
    refracted *= 0.333333;

    // A tiny neutral tint helps the distortion remain legible against a plain
    // background without turning the plume into a grey cloud.
    vec3 col = mix(refracted, hotCool, 0.12 + 0.1 * vNoise);

    // Shock cells: a choked, underexpanded core nozzle sets up a standing
    // expansion/compression train — ~4 cells brighten the first stretch of
    // the core jet and damp out downstream as mixing destroys them. uChoked
    // carries thrustFrac only while the nozzle is actually choked at high
    // power, so the train appears/strengthens with the throttle.
    float cell = max(sin(vT * 25.13), 0.0); // ~4 cycles across the plume
    float shock = uChoked * vCore * cell * cell * exp(-vT * 3.0);
    col *= 1.0 + shock * 0.6;

    // Dissolve the tail: turbulent mixing dilutes the jet into clean air, so
    // the far plume must vanish rather than linger as a gray smear (real
    // high-bypass engines do not leave a visible smoke trail).
    float dissolve = 1.0 - 0.97 * smoothstep(0.28, 0.85, vT);
    float alpha = mask * vBright * uOpacity * (0.52 + 0.3 * shock) * dissolve;
    gl_FragColor = vec4(col, alpha);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

// =========================================================================
// Component
// =========================================================================

/**
 * GPU plume. Two looks share the SAME shape/motion logic:
 *   - mode="flame" (Dramatic): dense translucent turbulent hot-air plume.
 *   - mode="haze"  (Realistic): the same plume rendered as a desaturated, soft,
 *     translucent heat-shimmer BLUR — no flame color, no diamonds.
 */
export function ExhaustShader({ mode = 'flame' }: { mode?: 'flame' | 'haze' }) {
  const pointsRef = useRef<THREE.Points>(null!);
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const { size, gl } = useThree();
  const pixelRatio = Math.min(gl.getPixelRatio(), 2);
  const sceneTarget = useFBO(
    Math.max(1, Math.floor(size.width * pixelRatio * 0.5)),
    Math.max(1, Math.floor(size.height * pixelRatio * 0.5)),
    {
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    },
  );

  // --- Build geometry + attributes once -----------------------------------
  const geometry = useMemo(() => {
    const positions = new Float32Array(TOTAL * 3); // placeholder; shader drives x/y/z
    const aPhase = new Float32Array(TOTAL);
    const aSeed = new Float32Array(TOTAL);
    const aRadial = new Float32Array(TOTAL);
    const aLane = new Float32Array(TOTAL);

    for (let i = 0; i < TOTAL; i++) {
      const isCore = i < CORE_COUNT;
      aLane[i] = isCore ? 0 : 1;
      aPhase[i] = Math.random();
      aSeed[i] = Math.random();
      // Bias toward the jet core so the center is dense and the edges wispy.
      const u = Math.random();
      aRadial[i] = isCore ? u * u : Math.sqrt(u);
      // The position attribute is required by three but unused for placement.
      positions[i * 3] = CORE_START;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    g.setAttribute('aRadial', new THREE.BufferAttribute(aRadial, 1));
    g.setAttribute('aLane', new THREE.BufferAttribute(aLane, 1));
    // Generous bounding sphere so the streaks are never frustum-culled away.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CORE_START + 4, 0, 0), 12);
    return g;
  }, []);

  // --- Uniforms: created once, mutated in place each frame -----------------
  // The five tint colors start black and are written every frame from the
  // mode palette + the live EGT-derived warm cast (see useFrame).
  const uniforms = useMemo(() => {
    return {
      uTime: { value: 0 },
      uCoreSpeed: { value: 0 },
      uBypassSpeed: { value: 0 },
      uCoreLen: { value: 3.0 },
      uBypassLen: { value: 2.4 },
      uCoreVis: { value: 0 },
      uBypassVis: { value: 0 },
      uChoked: { value: 0 },
      uTurb: { value: 1 },
      uPixelRatio: { value: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2) },
      uHeat: { value: 0 },
      uSizeBoost: { value: 1 },
      uOpacity: { value: 0 },
      uSceneTexture: { value: sceneTarget.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uDistort: { value: 0.002 },
      uHotColor: { value: new THREE.Color() },
      uMidColor: { value: new THREE.Color() },
      uCoolColor: { value: new THREE.Color() },
      uBypassHot: { value: new THREE.Color('#cfe0ee') },
      uBypassCool: { value: new THREE.Color('#243140') },
    };
  }, [sceneTarget.texture]);

  // Two NEUTRAL color palettes, built once. Both read as distorted air, not
  // flame; the hot end leans toward the live temperature scale per frame,
  // scaled by the actual EGT (see useFrame) — never a hardcoded fire color.
  const palettes = useMemo(() => {
    return {
      flame: {
        hot: new THREE.Color('#d5d9d7'),
        mid: new THREE.Color('#929997'),
        cool: new THREE.Color('#4b5355'),
        bypHot: new THREE.Color('#c4cccf'),
        bypCool: new THREE.Color('#586268'),
      },
      haze: {
        hot: new THREE.Color(0.95, 0.86, 0.74), // warm off-white hot air
        mid: new THREE.Color(0.74, 0.69, 0.63),
        cool: new THREE.Color(0.5, 0.49, 0.47),
        bypHot: new THREE.Color(0.72, 0.74, 0.78),
        bypCool: new THREE.Color(0.4, 0.42, 0.45),
      },
    };
  }, []);

  // Scratch color for the per-frame EGT tint (never reallocated).
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const mat = matRef.current;
    if (!mat) return;
    const u = mat.uniforms;
    u.uTime.value += dt;

    const { engine } = useSimStore.getState();
    const haze = mode === 'haze';

    // The shared engine-state drive: runFactor is 0 with no flame (off / dry
    // motoring / post-cutoff), ramps in from light-off, and is 1 running.
    const { runFactor, thrustFrac, coreVelN, bypassVelN, egtN } = plumeDrive();

    // Master gate: no combustion = no plume AND no FBO capture below — an
    // engine sitting cold on the stand costs literally nothing here.
    const active = runFactor > 0.002;
    if (pointsRef.current) pointsRef.current.visible = active;
    if (!active) return;

    const coreVel = Math.max(engine.coreExhaustVelocity, 0);
    const bypassVel = Math.max(engine.bypassExhaustVelocity, 0);

    // Heat haze drifts/wobbles rather than streaking, so it advects gentler.
    const speedMul = haze ? 0.5 : 1.0;
    u.uCoreSpeed.value = coreVel * K_SPEED * speedMul;
    u.uBypassSpeed.value = bypassVel * K_SPEED * speedMul;

    u.uCoreLen.value = lerp(1.6, 5.4, Math.min(coreVelN, 1.15)) * (0.6 + 0.4 * thrustFrac);
    u.uBypassLen.value = lerp(1.2, 3.6, Math.min(bypassVelN, 1.15));

    // Color palette (flame vs. desaturated haze), plus a live heat cast: the
    // near-nozzle tone leans toward the shared temperature scale evaluated at
    // the CURRENT Tt5, scaled by the displayed-EGT fraction — so the tint
    // follows the actual cycle instead of a hardcoded flame color.
    const pal = haze ? palettes.haze : palettes.flame;
    temperatureColor(engine.exhaustGasTemp, tint);
    u.uHotColor.value.copy(pal.hot).lerp(tint, 0.25 * egtN);
    u.uMidColor.value.copy(pal.mid).lerp(tint, 0.12 * egtN);
    u.uCoolColor.value.copy(pal.cool);
    u.uBypassHot.value.copy(pal.bypHot);
    u.uBypassCool.value.copy(pal.bypCool);

    if (haze) {
      // Heat shimmer: a faint, translucent, turbulent blur — no flame, no
      // diamonds. Kept very low so the many sprites read as wispy hot air
      // rather than saturating into a white blob.
      u.uCoreVis.value = clamp(0.12 + thrustFrac * 0.2, 0, 0.34) * runFactor;
      u.uBypassVis.value = 0.12 * runFactor;
      u.uChoked.value = 0;
      u.uHeat.value = 0.25 * egtN * runFactor; // low incandescence
      u.uTurb.value = 1.7 + 0.8 * thrustFrac; // strong, wispy boil/shimmer
      u.uSizeBoost.value = 2.0; // soft sprites for a blurred look (not a blob)
    } else {
      // Dramatic commercial-jet plume: much denser and more active than the
      // Realistic option, but still translucent, neutral, and flame-free.
      u.uCoreVis.value = clamp(0.42 + thrustFrac * 0.48, 0, 0.9) * runFactor;
      u.uBypassVis.value = clamp(0.34 + runFactor * 0.5, 0, 0.82) * runFactor;
      // Shock cells exist only while the core nozzle is ACTUALLY choked at
      // high power; strength follows the thrust fraction.
      u.uChoked.value = engine.coreNozzleChoked && thrustFrac > 0.5 ? thrustFrac : 0;
      u.uHeat.value = egtN * runFactor;
      u.uTurb.value = 1.15 + 1.25 * thrustFrac;
      u.uSizeBoost.value = 2.15;
    }

    // Global fade: the engine-state gate, shaped by thrust.
    u.uOpacity.value = runFactor * lerp(0.35, 1.0, thrustFrac);
    u.uResolution.value.set(size.width * pixelRatio, size.height * pixelRatio);
    u.uDistort.value = haze ? 0 : (0.004 + thrustFrac * 0.012) * runFactor;

    // Capture the scene without this plume. The regular canvas render that
    // follows draws the refractive particles over this clean background.
    if (!haze && pointsRef.current) {
      const oldTarget = state.gl.getRenderTarget();
      const oldToneMapping = state.gl.toneMapping;
      pointsRef.current.visible = false;
      // The captured scene is sampled by a material in the final render, where
      // tone mapping is applied. Capture it linear to avoid darkening it twice.
      state.gl.toneMapping = THREE.NoToneMapping;
      state.gl.setRenderTarget(sceneTarget);
      state.gl.clear();
      state.gl.render(state.scene, state.camera);
      state.gl.setRenderTarget(oldTarget);
      state.gl.toneMapping = oldToneMapping;
      pointsRef.current.visible = true;
    }
  }, -1);

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent
        depthWrite={false}
        depthTest
        blending={THREE.NormalBlending}
      />
    </points>
  );
}

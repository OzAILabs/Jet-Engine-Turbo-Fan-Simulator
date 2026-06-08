/**
 * ExhaustPlume — a GPU-driven torrent of fast, hot, turbulent jet exhaust.
 *
 * This REPLACES the old faint translucent cone. There is no static cone mesh
 * here: the plume is a single THREE.Points cloud driven entirely by one custom
 * THREE.ShaderMaterial (inline GLSL, additive, one draw call). Every particle
 * is advected in the VERTEX shader from a uniform time plus per-particle
 * attributes (seed / phase / lane), recycled with fract(phase + time * speed),
 * displaced by smooth sum-of-sines turbulence so the shear layer billows, and
 * elongated ALONG the screen-projected flow direction to read as motion blur
 * (faster jet -> longer streaks, denser, longer plume).
 *
 * The FRAGMENT shader gives each particle a soft round/streaked falloff, an
 * incandescent hot->cool color from a normalized downstream coordinate, and —
 * when the core nozzle is choked or thrust is high — a chain of bright
 * MACH DIAMONDS as sin()-banded incandescent nodes near the core axis just aft
 * of the nozzle. Plume length, density and brightness all scale with thrust,
 * and the whole effect fades to nothing when the engine is shut down.
 *
 * Live engine data is read non-reactively inside useFrame via getState() and
 * pushed into the material uniforms (mutated in place — never reallocated).
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS } from '../data/engineLayout';
import { clamp, lerp } from '../sim/units';
import { temperatureColor, heatFraction } from '../util/colorScale';

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

// Reference values used to normalize the live data into 0..1 drive amounts.
const CORE_VEL_REF = 640; // m/s, ~takeoff core jet
const BYPASS_VEL_REF = 300; // m/s, ~takeoff bypass jet
const THRUST_REF = 480000; // N, ~full takeoff thrust

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
  uniform float uCoreVis;      // 0..1 core intensity (thrust/n1 gated)
  uniform float uBypassVis;    // 0..1 bypass intensity
  uniform float uChoked;       // 0..1+ shock-diamond strength
  uniform float uTurb;         // turbulence amplitude scale 0..1+
  uniform float uPixelRatio;   // device pixel ratio (point-size scaling)
  uniform float uHeat;         // 0..1 overall heat (drives incandescence)
  uniform float uSizeBoost;    // extra point-size multiplier (blur for haze mode)

  // To the fragment shader.
  varying float vT;        // 0..1 normalized downstream coordinate
  varying float vCore;     // 1.0 for core particles, 0.0 for bypass
  varying float vBright;   // per-particle brightness (vis * life)
  varying float vDiamond;  // 0..1 shock-diamond intensity at this particle
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

    // The shear layer expands as it travels: cone half-angle grows downstream,
    // wider/softer for the bypass jet, tight near the core nozzle.
    float spread = mix(1.35, 1.15, isCore);
    float r = baseR * (0.22 + p * spread) * (0.35 + 0.9 * aRadial);

    // Swirl + turbulent billowing (smooth, time-varying sum of sines).
    float ang = aSeed * 6.2831853 + p * mix(2.0, 3.4, isCore) + uTime * 0.7;
    float amp = uTurb * baseR * (0.18 + 1.1 * p);
    float tx = uTime * (1.6 + isCore * 0.8);
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

    // --- Shock / Mach diamonds ------------------------------------------
    // A periodic chain of bright incandescent nodes hugging the core axis just
    // aft of the nozzle. Bands come from sin() of the axial coordinate; they
    // decay downstream and tighten/brighten with choke + thrust.
    float aft = x - ${CORE_START.toFixed(3)};
    float bands = sin(aft * 14.0);     // spacing ~2*pi/14 ~= 0.45 units
    bands = pow(max(bands, 0.0), 6.0); // sharp bright nodes between dark gaps
    float nearAxis = exp(-axisDist * axisDist * 26.0); // only on the axis
    float decay = exp(-aft * 0.85);                    // fade with distance
    vDiamond = isCore * uChoked * bands * nearAxis * decay * step(0.0, aft);

    // Life fade: brightest at the nozzle, fading aft. Diamonds re-light it.
    float life = 1.0 - p;
    vBright = vis * (0.16 + 0.74 * life) + vDiamond * 1.1;

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

    // Streak length grows with speed (units/s) — this is the core SPEED cue.
    vStretch = 1.0 + clamp(speed * 0.9, 0.0, 6.5) * mix(0.8, 1.25, isCore);

    // Point size: bigger near the nozzle, attenuated by distance, scaled by
    // device pixel ratio. Hotter/denser at high heat. The fragment shader
    // applies the directional stretch within this (square) point sprite, so we
    // size the sprite to fit the elongated streak.
    float sizeBase = mix(4.2, 2.8, isCore) * (0.55 + 0.9 * life) * (0.6 + 0.7 * uHeat);
    float pointPx = sizeBase * uPixelRatio * (300.0 / max(-mvPos.z, 1.0));
    gl_PointSize = clamp(pointPx * vStretch * uSizeBoost, 1.0, 120.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uHotColor;   // incandescent near-nozzle color
  uniform vec3 uMidColor;   // orange mid plume
  uniform vec3 uCoolColor;  // deep-red cooled tail
  uniform vec3 uBypassHot;  // bypass near-white/grey hot
  uniform vec3 uBypassCool; // bypass cool grey-blue
  uniform vec3 uDiamondCol; // shock-diamond incandescence (near white)
  uniform float uOpacity;   // global fade (engine running state)

  varying float vT;
  varying float vCore;
  varying float vBright;
  varying float vDiamond;
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

    // Comet/streak falloff: compress along the flow by vStretch so a fast
    // particle reads as an elongated motion-blurred streak; soft round across.
    float a = along / vStretch;
    float d2 = a * a + across * across;
    float fall = exp(-d2 * 3.2);
    // Brighter, tighter head toward the leading (downstream) end of the streak.
    float head = exp(-pow((along - 0.55) * 2.2, 2.0)) * 0.5;
    float mask = clamp(fall + head, 0.0, 1.0);
    if (mask < 0.004) discard;

    // Incandescent hot->cool gradient along the downstream coordinate.
    vec3 hotCool;
    if (vCore > 0.5) {
      vec3 mid = mix(uHotColor, uMidColor, smoothstep(0.0, 0.4, vT));
      hotCool = mix(mid, uCoolColor, smoothstep(0.3, 1.0, vT));
    } else {
      hotCool = mix(uBypassHot, uBypassCool, smoothstep(0.0, 1.0, vT));
    }

    // Shock diamonds blow the color toward incandescent white at the nodes.
    vec3 col = mix(hotCool, uDiamondCol, clamp(vDiamond, 0.0, 1.0));

    float alpha = mask * vBright * uOpacity;
    // Additive blend: scale color by brightness for a hot, glowing core
    // (kept moderate so the streak + shock-diamond structure shows through
    // instead of saturating to a white blob).
    gl_FragColor = vec4(col * (0.5 + 0.4 * vBright), alpha);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

// =========================================================================
// Component
// =========================================================================

/**
 * GPU plume. Two looks share the SAME shape/motion logic:
 *   - mode="flame" (Dramatic): toned-down incandescent jet with shock diamonds.
 *   - mode="haze"  (Realistic): the same plume rendered as a desaturated, soft,
 *     translucent heat-shimmer BLUR — no flame color, no diamonds.
 */
export function ExhaustShader({ mode = 'flame' }: { mode?: 'flame' | 'haze' }) {
  const pointsRef = useRef<THREE.Points>(null!);
  const matRef = useRef<THREE.ShaderMaterial>(null!);

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
  const uniforms = useMemo(() => {
    // Hot core colors come straight from the shared temperature scale so the
    // plume agrees with the rest of the UI; pulled from temperatureColor().
    const hot = temperatureColor(1450); // warm orange-white at the nozzle
    const mid = temperatureColor(1080); // orange mid plume
    const cool = temperatureColor(760); // deep red cooled tail
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
      uHotColor: { value: new THREE.Color(hot.r, hot.g, hot.b) },
      uMidColor: { value: new THREE.Color(mid.r, mid.g, mid.b) },
      uCoolColor: { value: new THREE.Color(cool.r, cool.g, cool.b) },
      uBypassHot: { value: new THREE.Color('#cfe0ee') },
      uBypassCool: { value: new THREE.Color('#243140') },
      uDiamondCol: { value: new THREE.Color('#fff3da') },
    };
  }, []);

  // Two color palettes, built once. Flame = incandescent (from the heat scale);
  // haze = desaturated warm-white (so the plume reads as hot translucent air,
  // not a flame). Copied into the live uniforms each frame.
  const palettes = useMemo(() => {
    const fh = new THREE.Color();
    const fm = new THREE.Color();
    const fc = new THREE.Color();
    temperatureColor(1200, fh);
    temperatureColor(980, fm);
    temperatureColor(740, fc);
    return {
      flame: { hot: fh, mid: fm, cool: fc, bypHot: new THREE.Color('#cfe0ee'), bypCool: new THREE.Color('#243140') },
      haze: {
        hot: new THREE.Color(0.95, 0.86, 0.74), // warm off-white hot air
        mid: new THREE.Color(0.74, 0.69, 0.63),
        cool: new THREE.Color(0.5, 0.49, 0.47),
        bypHot: new THREE.Color(0.72, 0.74, 0.78),
        bypCool: new THREE.Color(0.4, 0.42, 0.45),
      },
    };
  }, []);

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.05);
    const mat = matRef.current;
    if (!mat) return;
    const u = mat.uniforms;
    u.uTime.value += dt;

    const { engine, spool } = useSimStore.getState();
    const haze = mode === 'haze';

    // Overall running state: everything fades to nothing as the engine winds
    // down (n1 -> 0 / netThrust -> 0).
    const run = clamp(spool.n1, 0, 1);
    const thrustFrac = clamp(engine.netThrust / THRUST_REF, 0, 1);
    const lit = run > 0.02 ? 1 : 0;

    const coreVel = Math.max(engine.coreExhaustVelocity, 0);
    const bypassVel = Math.max(engine.bypassExhaustVelocity, 0);

    // Heat haze drifts/wobbles rather than streaking, so it advects gentler.
    const speedMul = haze ? 0.5 : 1.0;
    u.uCoreSpeed.value = coreVel * K_SPEED * lit * speedMul;
    u.uBypassSpeed.value = bypassVel * K_SPEED * lit * speedMul;

    const coreVelN = clamp(coreVel / CORE_VEL_REF, 0, 1.15);
    const bypassVelN = clamp(bypassVel / BYPASS_VEL_REF, 0, 1.15);
    u.uCoreLen.value = lerp(1.6, 5.4, coreVelN) * (0.6 + 0.4 * thrustFrac);
    u.uBypassLen.value = lerp(1.2, 3.6, bypassVelN);

    // Color palette (flame vs. desaturated haze).
    const pal = haze ? palettes.haze : palettes.flame;
    u.uHotColor.value.copy(pal.hot);
    u.uMidColor.value.copy(pal.mid);
    u.uCoolColor.value.copy(pal.cool);
    u.uBypassHot.value.copy(pal.bypHot);
    u.uBypassCool.value.copy(pal.bypCool);

    if (haze) {
      // Heat shimmer: a faint, translucent, turbulent blur — no flame, no
      // diamonds. Kept very low so the many additive sprites read as wispy hot
      // air rather than saturating into a white blob.
      u.uCoreVis.value = clamp(0.12 + thrustFrac * 0.2, 0, 0.34) * run * lit;
      u.uBypassVis.value = clamp(run, 0, 1) * 0.12 * lit;
      u.uChoked.value = 0;
      u.uHeat.value = 0.18 * run; // low incandescence
      u.uTurb.value = 1.7 + 0.8 * thrustFrac; // strong, wispy boil/shimmer
      u.uSizeBoost.value = 2.0; // soft sprites for a blurred look (not a blob)
    } else {
      // Dramatic flame: brighter, with shock diamonds.
      u.uCoreVis.value = clamp(0.12 + thrustFrac * 0.42, 0, 0.58) * run * lit;
      u.uBypassVis.value = clamp(run * 1.4, 0, 1) * 0.4 * lit;
      const chokeBoost = engine.coreNozzleChoked ? 1 : 0;
      u.uChoked.value = clamp(chokeBoost * (0.5 + 0.5 * thrustFrac) + (thrustFrac - 0.6) * 1.4, 0, 1.4) * run * lit;
      u.uHeat.value = heatFraction(lerp(620, 1850, thrustFrac)) * run;
      u.uTurb.value = 0.55 + 0.7 * thrustFrac;
      u.uSizeBoost.value = 1.0;
    }

    // Global fade. Squaring run via the product makes the spool-down tail die
    // cleanly to nothing at shutdown.
    u.uOpacity.value = clamp(Math.min(run * 1.3, 0.25 + thrustFrac) * run, 0, 1);
  });

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
        // Flame glows (additive); haze is a translucent veil (alpha) so the many
        // overlapping sprites form a soft blur instead of saturating to white.
        blending={mode === 'haze' ? THREE.NormalBlending : THREE.AdditiveBlending}
      />
    </points>
  );
}
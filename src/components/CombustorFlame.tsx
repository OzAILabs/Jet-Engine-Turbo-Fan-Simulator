/**
 * CombustorFlame — the fire itself. Replaces the old "oval beacon" flame
 * pockets with a procedural, layered, turbulent flame volume that behaves
 * like a real annular combustor through the whole operating envelope:
 *
 *   COLD / MOTORING   nothing (dry crank shows no fire),
 *   FUEL ON, UNLIT    faint gray-brown fuel haze streaming aft through the
 *                     can (the "gasses going through" before light-off),
 *   LIGHT-OFF         an ignition BURST: flame erupts at the two igniter
 *                     clock positions and a light-around front sweeps the
 *                     annulus in ~0.7 s with a bright overshoot that decays
 *                     as the burn stabilizes (syncs with the audio whoomph —
 *                     both key on the same startSeq.lit edge),
 *   RUNNING           a violent, continuously-roaring turbulent fire whose
 *                     coverage, speed, flicker and HDR peak all scale with
 *                     fuel flow — angry at takeoff, lazy at idle.
 *
 * HOW: three nested open cylinders (outer sheet / mid / hot core) merged into
 * ONE geometry with a per-vertex layer attribute, drawn additively by ONE
 * ShaderMaterial. The fragment shader runs domain-warped FBM value noise per
 * layer — different scales, scroll speeds and swirl per layer give the
 * parallax "layers of fire" read — with an axial envelope (fire lives in the
 * primary zone, thins toward the turbine), an angular ignition mask (the
 * light-around front), and an HDR color ramp (deep red → orange → yellow →
 * white-hot > 1.0, so the bloom pass lifts the hottest tongues).
 *
 * Perf: one draw call, zero per-frame allocation; useFrame only writes a
 * handful of uniform scalars read non-reactively from the store.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimStore } from '../store/useSimStore';
import { createTube } from '../geometry/annularSection';
import { temperatureColor } from '../util/colorScale';

/** Shell radii [m] — outer sheet just inside the liner, hot core inside. */
const SHELL_RADII = [0.48, 0.42, 0.35] as const;

/** Igniter plug angular positions as fractions of a turn (clocks 7.8 / 8.6). */
const IGN_A = 7.8 / 12;
const IGN_B = 8.6 / 12;

/** Light-around time [s]: flame front sweeps the annulus after light-off. */
const IGNITE_SWEEP_S = 0.55;
/** Ignition burst decay time-constant [s] — long enough that light-off reads
 *  as a sustained eruption, not a camera flash. */
const BURST_TAU_S = 1.1;

const VERT = /* glsl */ `
  attribute float aLayer;
  varying vec2 vUv;
  varying float vLayer;
  void main() {
    vUv = uv;
    vLayer = aLayer;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying vec2 vUv;   // u: around the annulus (0..1), v: axial (0..1)
  varying float vLayer; // 0 outer sheet, 0.5 mid, 1 hot core

  uniform float uTime;
  uniform float uPower;   // 0..1 fuel-flow violence (0 at idle-ish, 1 takeoff)
  uniform float uLit;     // smoothed 0..1 (flame exists)
  uniform float uIgnite;  // 0..1 light-around sweep progress
  uniform float uBurst;   // 1 -> 0 ignition overshoot
  uniform float uHaze;    // 0..1 pre-light fuel haze
  uniform float uIgnW;    // igniter weighting: 0 = A only, 1 = B only, 0.5 = both
  uniform vec3 uTint;     // Tt4 whitening tint

  // --- cheap value noise + 4-octave FBM ------------------------------------
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 s = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.13 + vec2(17.3, 9.1);
      a *= 0.5;
    }
    return v;
  }

  /** Wrapped angular distance in turns (0..0.5). */
  float turnDist(float u, float a) {
    return abs(fract(u - a + 0.5) - 0.5);
  }

  void main() {
    float t = uTime;

    // Per-layer character: the core is finer, faster, hotter; the outer sheet
    // is broad and lazy. Layer also offsets the noise domain so the shells
    // never line up — that parallax is the "layers of fire".
    float lay = vLayer;
    float aroundScale = mix(6.0, 11.0, lay);
    float axialScale  = mix(3.0, 5.5, lay);
    // Fast even at light-off (real combustion is never a slow dance), and a
    // burst slam on top so ignition TEARS through the can.
    float flowSpeed   = (2.6 + 3.4 * uPower + 2.5 * uBurst) * mix(0.7, 1.35, lay);
    float swirlSpeed  = (0.5 + 1.3 * uPower) * mix(1.0, -1.4, lay); // counter-swirl layers

    // Noise domain: u wraps 0..1, so scale by whole numbers to keep the seam
    // invisible at integer around-scales; add domain warp for licking tongues.
    vec2 p = vec2(vUv.x * aroundScale + swirlSpeed * t, vUv.y * axialScale - flowSpeed * t);
    p.x += lay * 7.7; // decorrelate layers
    float warp = fbm(p * 1.7 + vec2(0.0, -t * 1.6));
    float n = fbm(p + (0.55 + 0.35 * uPower) * vec2(warp, warp * 0.8));

    // Roaring: two incommensurate global pulsations, harder with power.
    float roar = 1.0 + (0.10 + 0.28 * uPower) * sin(t * 23.7 + lay * 2.1)
                     + (0.06 + 0.20 * uPower) * sin(t * 14.3 + lay * 4.7);

    // Coverage: high power lowers the cut so fire fills more of the volume —
    // near-total at takeoff — and the ignition burst floods it further.
    float cut = mix(0.46, 0.24, uPower) - 0.30 * uBurst;
    float I = smoothstep(cut, 1.0, n) * roar;
    I = pow(I, mix(1.25, 0.85, uPower)); // <1 at full power lifts the mids: an inferno wash

    // Axial envelope: fire erupts in the primary zone (just aft of the dome)
    // and thins toward the turbine; the burst momentarily lengthens it.
    float axial = smoothstep(0.01, 0.10, vUv.y) * (1.0 - smoothstep(0.62 + 0.3 * uBurst, 1.0, vUv.y));

    // Light-around: flame only exists within the swept angle from the active
    // igniter(s) — A, B, or the shorter of both when BOTH fire. Full annulus
    // once uIgnite reaches 1.
    float dA = turnDist(vUv.x, ${IGN_A.toFixed(4)});
    float dB = turnDist(vUv.x, ${IGN_B.toFixed(4)});
    float d = (uIgnW < 0.25) ? dA : (uIgnW > 0.75) ? dB : min(dA, dB);
    float sweep = uIgnite * 0.52;
    float ignMask = smoothstep(sweep + 0.05, sweep - 0.02, d);

    // Flame color ramp, HDR at the top so bloom lifts the hottest tongues.
    vec3 cRed    = vec3(0.55, 0.05, 0.008);
    vec3 cOrange = vec3(1.15, 0.34, 0.04);
    vec3 cYellow = vec3(1.7, 1.05, 0.22);
    vec3 cWhite  = vec3(2.6, 2.2, 1.7) * (0.7 + 0.3 * uTint);
    vec3 col = mix(cRed, cOrange, smoothstep(0.0, 0.45, I));
    col = mix(col, cYellow, smoothstep(0.45, 0.8, I));
    col = mix(col, cWhite, smoothstep(0.8, 1.15, I));

    float gain = (1.0 + 1.9 * uPower) * (1.0 + 3.0 * uBurst);
    float flameA = I * axial * ignMask * uLit;

    // Pre-light fuel haze: cool gray-brown wisps streaming aft, no ignition
    // mask (raw fuel mist fills the can), very low alpha.
    float hazeN = smoothstep(0.45, 0.95, n);
    float hazeA = hazeN * axial * uHaze * 0.16;
    vec3 hazeCol = vec3(0.30, 0.27, 0.235);

    vec3 rgb = col * gain * flameA + hazeCol * hazeA;
    float a = clamp(flameA * (0.85 + 0.35 * uPower + 0.6 * uBurst) + hazeA, 0.0, 1.0);
    if (a < 0.004) discard;
    gl_FragColor = vec4(rgb, a);
  }
`;

export function CombustorFlame(props: { length: number }) {
  const { length } = props;

  // Three nested shells merged into ONE geometry with a per-vertex layer id.
  const geometry = useMemo(() => {
    const shells = SHELL_RADII.map((r) => createTube(r, r, length * 0.94, { radialSegments: 72, openEnded: true }));
    const counts = shells.map((g) => g.getAttribute('position').count);
    const merged = mergeGeometries(shells)!;
    shells.forEach((g) => g.dispose());
    const layer = new Float32Array(merged.getAttribute('position').count);
    let o = 0;
    counts.forEach((c, i) => {
      layer.fill(i / (counts.length - 1), o, o + c);
      o += c;
    });
    merged.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
    return merged;
  }, [length]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uPower: { value: 0 },
          uLit: { value: 0 },
          uIgnite: { value: 0 },
          uBurst: { value: 0 },
          uHaze: { value: 0 },
          uIgnW: { value: 0 }, // 0 = igniter A, 1 = B, 0.5 = BOTH
          uTint: { value: new THREE.Color(1, 1, 1) },
        },
      }),
    [],
  );

  // Ignition event state (refs — no React re-render involvement).
  const prevLit = useRef(false);
  const prevSurge = useRef(false);
  const prevSurgeT = useRef(0);
  const ignite = useRef(0);
  const burst = useRef(0);
  const litSmooth = useRef(0);
  const tint = useRef(new THREE.Color());

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const { engine, instruments, startSeq, config, surgeActive } = useSimStore.getState();
    const u = material.uniforms;

    const lit = startSeq.lit;
    if (lit && !prevLit.current) {
      // LIGHT-OFF: burst + start the light-around sweep from the igniter(s).
      ignite.current = 0;
      burst.current = 1;
    }
    prevLit.current = lit;

    // SURGE: reversed airflow belches flame — full burst on the event edge
    // AND on each re-armed pop of a repeating surge (surgeT snaps back to 0).
    const { surgeT } = useSimStore.getState();
    if (surgeActive && (!prevSurge.current || surgeT < prevSurgeT.current)) burst.current = 1;
    prevSurge.current = surgeActive;
    prevSurgeT.current = surgeT;

    if (lit) ignite.current = Math.min(1, ignite.current + dt / IGNITE_SWEEP_S);
    else ignite.current = Math.max(0, ignite.current - dt * 4);
    burst.current *= Math.exp(-dt / BURST_TAU_S);
    litSmooth.current += ((lit ? 1 : 0) - litSmooth.current) * Math.min(1, dt * 8);

    // Violence tracks fuel flow (the burn), not the throttle lever directly.
    // A high floor keeps even the idle burn a fast, full-chamber fire; the
    // ignition burst rides on top and briefly pushes uPower PAST 1 so
    // light-off is the most violent moment until takeoff outdoes it.
    const fuelFrac = Math.min(instruments.fuelFlowKgs / config.takeoffFuelFlow, 1);
    const power = lit ? Math.min(1.2, 0.35 + 0.65 * Math.pow(fuelFrac, 0.7) + 0.5 * burst.current) : 0;

    // Pre-light haze: fuel valve open + metering, but no flame yet.
    const haze = !lit && startSeq.fuelValveOpen ? Math.min(1, instruments.fuelFlowKgs / 0.15) : 0;

    // Igniter weighting for the light-around origin.
    const ignW = startSeq.activeIgniter === 'BOTH' ? 0.5 : startSeq.activeIgniter === 'B' ? 1 : 0;

    temperatureColor(engine.turbineInletTemp, tint.current);

    u.uTime.value = state.clock.elapsedTime;
    u.uPower.value = power;
    u.uLit.value = litSmooth.current;
    u.uIgnite.value = ignite.current;
    u.uBurst.value = burst.current;
    u.uHaze.value = haze;
    u.uIgnW.value = ignW;
    (u.uTint.value as THREE.Color).copy(tint.current);
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

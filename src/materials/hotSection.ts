/**
 * Hot-section materials — "hot-section honesty".
 *
 * Real engines at normal power show NO visible glow through the hot section:
 * the metal wears its thermal history as permanent HEAT STAINING — the
 * straw → bronze → violet-blue tempering bands you see on any exhaust header.
 * Visible incandescence through the gas path is an OVER-TEMP event, full stop.
 *
 * This module provides:
 *   • createHeatStainedTurbineMaterial('hpt'|'lpt') — nickel-alloy metal with a
 *     procedural CanvasTexture of tempering bands (stronger + violet-cored for
 *     the hotter HPT, subtler for the LPT). Emissive boots black at intensity 0;
 *     the owning component ramps it in useFrame ONLY past the certified limit.
 *   • createHeatStainedDrumMaterial() — darker variant sharing the HPT staining
 *     texture, for the rotating drum / disk stack.
 *   • createCeramicLinerMaterial() — pale thermal-barrier-coating ceramic for
 *     the combustor liners, with faint soot mottling.
 *   • createFlamePocketMaterial() — emissive-driven additive material for the
 *     instanced primary-zone flame pockets.
 *   • ensureSpanChordUVs(geometry) — the procedural blade loft carries no UV
 *     attribute (an unbound `uv` samples texel (0,0), flattening any map to a
 *     single color); this derives a cheap span/chord parameterization from the
 *     bounding box so the staining bands land across the blades.
 *   • overTempGlow(temp, limit, span) — 0 at/below the limit, then a hard
 *     smoothstep 0→1 over `span` degrees past it.
 *
 * Constraints honored: no network fetches, no texture files — every texture is
 * painted ONCE into an offscreen 2D canvas (THREE.CanvasTexture ⇒ repeatable,
 * mipmapped, sRGB). Textures are cached at module scope; factories are meant to
 * be called once from useMemo. Nothing in this module allocates per frame.
 */
import * as THREE from 'three';
import { normalMapFromHeight } from './proceduralNormal';

// --- Palette ----------------------------------------------------------------
const NICKEL_BASE = '#8f8a7e'; // Inconel-ish nickel alloy
const STAIN_STRAW = '#c9a25e'; // ~230 °C tempering tint
const STAIN_BRONZE = '#a06a48'; // ~260 °C
const STAIN_VIOLET = '#5a5a8a'; // ~290+ °C — only the HPT earns this one
const CERAMIC_BASE = '#ded9cc'; // pale thermal-barrier coating

// --- Deterministic PRNG so the staining is identical run-to-run --------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return [canvas, ctx];
}

/** hex '#rrggbb' + alpha → 'rgba(r,g,b,a)' for canvas gradient stops. */
function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${THREE.MathUtils.clamp(alpha, 0, 1)})`;
}

function finishColorTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; // u runs around the circumference / chord
  tex.wrapT = THREE.ClampToEdgeWrapping; // v runs along the axis / blade span
  tex.anisotropy = 4;
  return tex;
}

// --- Heat-staining texture ----------------------------------------------------
// Canvas y is the axial/spanwise (v) direction, canvas x the circumferential/
// chordwise (u) direction. Bands are composited with 'multiply' so they TINT
// the alloy base the way real oxide interference films do (white = untouched).
function paintHeatStain(kind: 'hpt' | 'lpt'): HTMLCanvasElement {
  const w = 512;
  const h = 256;
  const [canvas, ctx] = makeCanvas(w, h);
  const rand = mulberry32(kind === 'hpt' ? 0x9e3779b1 : 0x85ebca6b);
  const strength = kind === 'hpt' ? 0.8 : 0.42; // LPT stains at ~half strength

  // 1) Alloy base + fine circumferential machining streaks (turned metal).
  ctx.fillStyle = NICKEL_BASE;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 110; i++) {
    const y = Math.floor(rand() * h);
    const a = 0.02 + 0.05 * rand();
    ctx.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(0, y, w, 1);
  }

  // 2) Tempering bands: straw at the cool edges, bronze inside, and (HPT only)
  //    a violet-blue core where the film grew thickest.
  ctx.globalCompositeOperation = 'multiply';
  const bands = kind === 'hpt' ? 6 : 4;
  for (let b = 0; b < bands; b++) {
    const yC = h * (0.12 + 0.76 * rand());
    const half = h * (0.06 + 0.14 * rand());
    const a = strength * (0.55 + 0.45 * rand());
    const g = ctx.createLinearGradient(0, yC - half, 0, yC + half);
    g.addColorStop(0.0, 'rgba(255,255,255,0)');
    g.addColorStop(0.22, hexA(STAIN_STRAW, 0.75 * a));
    g.addColorStop(0.42, hexA(STAIN_BRONZE, a));
    if (kind === 'hpt') g.addColorStop(0.5, hexA(STAIN_VIOLET, a));
    g.addColorStop(0.58, hexA(STAIN_BRONZE, a));
    g.addColorStop(0.78, hexA(STAIN_STRAW, 0.75 * a));
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, yC - half, w, half * 2);
  }

  // 3) HPT only: 16 soft clocked smudges — combustor-exit hot streaks (one per
  //    fuel nozzle) licking the first-stage NGVs. u wraps, so keep them inside.
  if (kind === 'hpt') {
    for (let k = 0; k < 16; k++) {
      const x = ((k + 0.5) / 16) * w;
      const g = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, hexA(STAIN_BRONZE, 0.28));
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 14, 0, 28, h);
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

// --- Ceramic liner texture ----------------------------------------------------
function paintCeramic(): HTMLCanvasElement {
  const w = 256;
  const h = 256;
  const [canvas, ctx] = makeCanvas(w, h);
  const rand = mulberry32(0x27d4eb2f);
  ctx.fillStyle = CERAMIC_BASE;
  ctx.fillRect(0, 0, w, h);
  // Faint tan/grey mottling — soot shadows and sintering variation in the TBC.
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 26; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 12 + 34 * rand();
    const a = 0.04 + 0.09 * rand();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(122,108,92,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

// --- Texture cache (painted once, shared by every material that wants it) -----
const stainTextures: { hpt?: THREE.CanvasTexture; lpt?: THREE.CanvasTexture } = {};
let ceramicTex: THREE.CanvasTexture | null = null;

function stainTexture(kind: 'hpt' | 'lpt'): THREE.CanvasTexture {
  const cached = stainTextures[kind];
  if (cached) return cached;
  const tex = finishColorTexture(paintHeatStain(kind));
  stainTextures[kind] = tex;
  return tex;
}

/**
 * Relief for the hot section, derived from the staining canvas itself
 * (CanvasTexture keeps its source canvas in `.image`, so no painter refactor
 * is needed). Oxide scale and thermal-barrier spallation genuinely stand
 * proud of the parent metal, and the mottling that darkens a blade is the
 * same field that roughens it — so the stain doubles as a height field.
 */
const stainNormals: { hpt?: THREE.CanvasTexture | null; lpt?: THREE.CanvasTexture | null } = {};

function stainNormalTexture(kind: 'hpt' | 'lpt'): THREE.CanvasTexture | null {
  if (kind in stainNormals) return stainNormals[kind] ?? null;
  const src = stainTexture(kind).image as HTMLCanvasElement | undefined;
  const tex =
    src && typeof src.getContext === 'function'
      ? normalMapFromHeight(src, 1.0, THREE.RepeatWrapping)
      : null;
  stainNormals[kind] = tex;
  return tex;
}

function ceramicTexture(): THREE.CanvasTexture {
  if (!ceramicTex) ceramicTex = finishColorTexture(paintCeramic());
  return ceramicTex;
}

// --- Public factories ----------------------------------------------------------

/**
 * Heat-stained nickel-alloy turbine metal. The albedo lives ENTIRELY in the
 * staining map (material color stays white so the canvas is the single source
 * of truth). Emissive boots black/0 — normal operation must not glow; the
 * component drives emissive+intensity in useFrame via overTempGlow().
 */
export function createHeatStainedTurbineMaterial(kind: 'hpt' | 'lpt'): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: stainTexture(kind),
    metalness: 0.75,
    roughness: 0.45,
    emissive: new THREE.Color('#000000'),
    emissiveIntensity: 0,
  });
  const normal = stainNormalTexture(kind);
  if (normal) {
    mat.normalMap = normal;
    mat.normalScale = new THREE.Vector2(0.3, 0.3); // scale, not corrugation
  }
  return mat;
}

/** Drum/disk variant: shares the HPT staining, multiplied darker (shadowed
 *  rotating hardware), slightly rougher. Same over-temp emissive contract. */
export function createHeatStainedDrumMaterial(): THREE.MeshStandardMaterial {
  const m = createHeatStainedTurbineMaterial('hpt');
  m.color.set('#9a948a');
  m.metalness = 0.7;
  m.roughness = 0.5;
  return m;
}

/**
 * Thermal-barrier-coating ceramic for the combustor liners — soot-darkened in
 * service. The original pale/white 0.55-opacity shell WASHED OUT the additive
 * fire behind it (additive orange over a bright surface reads as nothing);
 * dark + very see-through lets the flame own the chamber while the liner
 * still reads as a surface. DoubleSide / no-depth-write as before.
 */
export function createCeramicLinerMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#6f665c',
    map: ceramicTexture(),
    metalness: 0.05,
    roughness: 0.85,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/**
 * Flame-pocket material for the instanced primary-zone fire. Additive with a
 * black diffuse: only the emissive term shows, so overlapping pockets bloom
 * into each other. Boots at intensity 0 (cold & dark); the combustor's
 * useFrame copies temperatureColor(Tt4) into `emissive` and scales intensity
 * with fuel flow — the same mutation pattern the old flame tube used.
 */
export function createFlamePocketMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#000000',
    emissive: new THREE.Color('#ff7a2b'),
    emissiveIntensity: 0,
    metalness: 0,
    roughness: 1,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// --- Geometry + math helpers -----------------------------------------------------

/**
 * The procedural blade loft (bladeGeometry.ts) emits no `uv` attribute; WebGL
 * then feeds the shader a constant (0,0) and any map collapses to one texel.
 * Derive u = chordwise (local X), v = spanwise (local Y, root→tip) from the
 * bounding box — plenty for tempering bands. No-op if UVs already exist.
 */
export function ensureSpanChordUVs(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geometry.getAttribute('uv')) return geometry;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox as THREE.Box3;
  const pos = geometry.getAttribute('position');
  const sx = Math.max(bb.max.x - bb.min.x, 1e-6);
  const sy = Math.max(bb.max.y - bb.min.y, 1e-6);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - bb.min.x) / sx;
    uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / sy;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * Over-temp glow ramp: exactly 0 at or below the certified limit, then a hard
 * smoothstep 0→1 across the next `span` degrees (K and °C deltas are the same
 * size, so this works for both the Tt4 [K] and EGT [°C] planes).
 */
export function overTempGlow(temp: number, limit: number, span = 80): number {
  const t = THREE.MathUtils.clamp((temp - limit) / span, 0, 1);
  return t * t * (3 - 2 * t);
}

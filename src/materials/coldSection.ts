/**
 * coldSection.ts — procedural PBR materials for the COLD section of the
 * engine: the composite fan blades, the brushed-titanium compressor metal and
 * the painted nacelle cowl.
 *
 * NO texture assets and NO network: every map is painted ONCE into an
 * offscreen 2D canvas (lazily, on the first factory call) and wrapped in a
 * THREE.CanvasTexture — it mipmaps and filters like a file texture but ships
 * as pure code. CanvasTexture was chosen over onBeforeCompile injection
 * because these are static wear/weave/mottle patterns, not view-dependent
 * effects.
 *
 * Factory contract (matches how the components consume materials):
 *   - Each create*() call returns a FRESH MeshStandardMaterial. Callers keep
 *     mutating them exactly as before: Compressor writes rotorMat.emissive /
 *     emissiveIntensity EVERY FRAME (surge glow — emissive starts black
 *     here), and Nacelle flips transparent/opacity/depthWrite/side per view
 *     mode. Fresh instances keep those mutations from bleeding across users.
 *   - The underlying CanvasTextures are module-level singletons SHARED by all
 *     material instances — one canvas paint + one GPU upload each, total.
 *     Nothing here allocates per frame.
 *   - A deterministic PRNG seeds every painter, so reloads look identical.
 *
 * Channel packing: MeshStandardMaterial reads roughnessMap from the GREEN
 * channel and metalnessMap from the BLUE channel, so one RGB canvas can feed
 * both slots (the fan blade's "rm" texture does exactly that).
 *
 * Headless safety: in environments without a 2D canvas (vitest/jsdom, SSR)
 * the factories skip the maps and return equivalent flat-value materials.
 */
import * as THREE from 'three';
import { heightCanvasToNormal, normalMapFromHeight } from './proceduralNormal';

/** All maps are painted at this square power-of-two size (mipmap friendly). */
const SIZE = 256;
/**
 * Hero surfaces (the ones the camera gets close to) paint at this size
 * instead. 256 px was fine for tinting but far too coarse to carry believable
 * surface relief — the nacelle skin's 2048 px maps are visibly the best
 * surfaces in the sim, and this closes some of that gap.
 */
const HERO_SIZE = 1024;

/** Deterministic PRNG (Park–Miller) so every load paints identical textures. */
export function makeRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export interface PaintSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** Offscreen canvas + 2D context, or null when headless (tests / SSR). */
export function tryMakeCanvas(size = SIZE): PaintSurface | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

export function toTexture(
  canvas: HTMLCanvasElement,
  opts: { srgb?: boolean; wrap?: THREE.Wrapping; repeat?: [number, number] } = {},
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  const wrap = opts.wrap ?? THREE.ClampToEdgeWrapping;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  if (opts.srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4; // safe everywhere; keeps the weave crisp at glancing angles
  return tex;
}

/* ------------------------------------------------------------------------- *
 * 1. Fan blades — carbon twill weave + titanium leading-edge sheath
 * ------------------------------------------------------------------------- */

/** Chordwise fraction of the blade covered by the titanium LE sheath. */
const LE_FRAC = 0.07;

interface FanBladeMaps {
  map: THREE.CanvasTexture;
  /** Packed roughness (G) + metalness (B) — one texture feeds both slots. */
  rm: THREE.CanvasTexture;
  /** Tangent-space relief: the woven tows stand proud of the resin. */
  normal: THREE.CanvasTexture | null;
}
let fanBladeMaps: FanBladeMaps | null | undefined; // undefined = not tried yet

/**
 * Weave RELIEF, painted as its own height field rather than derived from the
 * colour map: a 2/2 twill's tows physically stand proud where they pass OVER
 * and sink where they pass under, and deriving that from the colour canvas
 * would also pick up the sheen gradient and sheath fade as if they were
 * geometry. Cell size matches the colour map's twill so relief and tone line
 * up exactly.
 */
function paintWeaveHeight(ctx: CanvasRenderingContext2D, size: number): void {
  const cellPx = Math.round((size / SIZE) * 3); // same tow pitch as the colour map
  const cells = Math.ceil(size / cellPx);
  for (let iy = 0; iy < cells; iy++) {
    for (let ix = 0; ix < cells; ix++) {
      const over = (ix + iy) % 4 < 2;
      const v = over ? 190 : 96; // raised tow vs. the one passing beneath
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(ix * cellPx, iy * cellPx, cellPx, cellPx);
    }
  }
}

function getFanBladeMaps(): FanBladeMaps | null {
  if (fanBladeMaps !== undefined) return fanBladeMaps;
  const colorC = tryMakeCanvas();
  const rmC = tryMakeCanvas();
  if (!colorC || !rmC) {
    fanBladeMaps = null;
    return fanBladeMaps;
  }
  const rand = makeRand(90115); // GE90-115B

  // Blade UVs (see bladeGeometry.ts): u = chordwise with the LEADING edge at
  // u = 0, v = spanwise root→tip. The twill fills the whole canvas and the
  // titanium strip is painted down the LEFT columns; both blade faces share
  // the same u, so the strip wraps the LE like the real bonded sheath.
  // ClampToEdge (no repeat) keeps the strip from tiling across the chord.
  const cellPx = 3; // one tow cell ≈ 3 px → ~7 mm on the ~0.6 m mean chord
  const cells = Math.ceil(SIZE / cellPx);
  const toneA = [35, 39, 46]; // #23272e
  const toneB = [43, 48, 56]; // #2b3038

  for (let iy = 0; iy < cells; iy++) {
    for (let ix = 0; ix < cells; ix++) {
      // 2/2 twill: the over/under pattern steps one cell per row, which is
      // what draws the classic diagonal (and suggests anisotropy).
      const over = (ix + iy) % 4 < 2;
      const t = over ? toneA : toneB;
      const j = Math.round((rand() - 0.5) * 10); // tow-to-tow variation
      colorC.ctx.fillStyle = `rgb(${t[0] + j},${t[1] + j},${t[2] + j})`;
      colorC.ctx.fillRect(ix * cellPx, iy * cellPx, cellPx, cellPx);

      // Matching gloss variation: the "over" tow catches more resin shine.
      // Green = roughness ~0.35–0.55, blue = metalness ~0.22 (resin composite).
      const rough = (over ? 0.38 : 0.52) + (rand() - 0.5) * 0.06;
      const g = Math.round(rough * 255);
      rmC.ctx.fillStyle = `rgb(${g},${g},56)`;
      rmC.ctx.fillRect(ix * cellPx, iy * cellPx, cellPx, cellPx);
    }
  }

  // Faint corner-to-corner sheen so the weave reads anisotropic at distance.
  const sheen = colorC.ctx.createLinearGradient(0, 0, SIZE, SIZE);
  sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.04)');
  colorC.ctx.fillStyle = sheen;
  colorC.ctx.fillRect(0, 0, SIZE, SIZE);

  // Silvery titanium leading-edge strip fading into the weave. (Gradient end
  // stops repeat the RGB of the previous stop with alpha 0 — interpolating to
  // transparent BLACK dirties the fade in some browsers.)
  const lePx = Math.round(SIZE * LE_FRAC);
  const leColor = colorC.ctx.createLinearGradient(0, 0, lePx, 0);
  leColor.addColorStop(0, 'rgba(206,211,218,1)');
  leColor.addColorStop(0.7, 'rgba(196,202,210,0.9)');
  leColor.addColorStop(1, 'rgba(196,202,210,0)');
  colorC.ctx.fillStyle = leColor;
  colorC.ctx.fillRect(0, 0, lePx, SIZE);

  // Same strip on the packed map: polished (G ≈ 0.22) and metallic (B ≈ 0.95).
  const leRM = rmC.ctx.createLinearGradient(0, 0, lePx, 0);
  leRM.addColorStop(0, 'rgba(56,56,242,1)');
  leRM.addColorStop(0.7, 'rgba(64,64,235,0.9)');
  leRM.addColorStop(1, 'rgba(64,64,235,0)');
  rmC.ctx.fillStyle = leRM;
  rmC.ctx.fillRect(0, 0, lePx, SIZE);

  fanBladeMaps = {
    map: toTexture(colorC.canvas, { srgb: true }),
    rm: toTexture(rmC.canvas),
    // Blade UVs are ClampToEdge (the sheath strip must not tile across the
    // chord), so the relief has to clamp identically.
    normal: heightCanvasToNormal(
      HERO_SIZE,
      paintWeaveHeight,
      1.6,
      THREE.ClampToEdgeWrapping,
    ),
  };
  return fanBladeMaps;
}

/**
 * The 22 composite fan blades: near-black carbon twill (procedural map +
 * matching roughness variation) with a silvery titanium leading-edge sheath
 * baked into the map's leading columns (blade UVs put the LE at u = 0).
 * Metalness/roughness scalars stay 1.0 — the packed rm texture rules.
 */
export function createFanBladeMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', // the weave map carries the tones; keep the tint neutral
    metalness: 1.0, // scalars multiply the packed maps → map channels rule
    roughness: 1.0,
    side: THREE.DoubleSide, // thin lofted blades are shaded from both faces
  });
  const maps = getFanBladeMaps();
  if (maps) {
    mat.map = maps.map;
    mat.roughnessMap = maps.rm; // green channel
    mat.metalnessMap = maps.rm; // blue channel — one texture, two slots
    if (maps.normal) {
      mat.normalMap = maps.normal;
      mat.normalScale = new THREE.Vector2(0.55, 0.55); // woven, not corrugated
    }
  } else {
    // Headless fallback: plain dark composite with a resin-like sheen.
    mat.color.set('#262a31');
    mat.metalness = 0.35;
    mat.roughness = 0.45;
  }
  return mat;
}

/* ------------------------------------------------------------------------- *
 * 2. Brushed titanium — compressor rotor/stator blades + drums
 * ------------------------------------------------------------------------- */

/** Mean green value painted into the streak map (used to normalize below). */
const BRUSH_MEAN = 0.78;

let brushedRoughTex: THREE.CanvasTexture | null | undefined;
/** Relief derived from the same streak field (grinding grooves ARE height). */
let brushedNormalTex: THREE.CanvasTexture | null | undefined;

function getBrushedRoughnessTexture(): THREE.CanvasTexture | null {
  if (brushedRoughTex !== undefined) return brushedRoughTex;
  const surf = tryMakeCanvas(HERO_SIZE);
  if (!surf) {
    brushedRoughTex = null;
    brushedNormalTex = null;
    return brushedRoughTex;
  }
  const { canvas, ctx } = surf;
  const rand = makeRand(23550); // N1 rated rpm ×10

  // Painted at HERO_SIZE now (the drums and blades are close-up surfaces), so
  // every extent below comes from the canvas rather than the 256 px default.
  const S = canvas.width;
  const base = Math.round(BRUSH_MEAN * 255);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, S, S);

  // 1 px machining streaks. Canvas +x maps CHORDWISE on the blades (their UVs
  // run u = chord) and CIRCUMFERENTIALLY on the drums (CylinderGeometry UVs) —
  // i.e. along the grinding/turning direction in both cases. Full-width rows
  // tile seamlessly under RepeatWrapping.
  for (let y = 0; y < S; y++) {
    const v = THREE.MathUtils.clamp(BRUSH_MEAN + (rand() - 0.5) * 0.3, 0.55, 1.0);
    const g = Math.round(v * 255);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(0, y, S, 1);
  }
  // A few wider polished bands / score lines for large-scale interest.
  for (let i = 0; i < 26 * (S / SIZE); i++) {
    const y = Math.floor(rand() * S);
    const h = 1 + Math.floor(rand() * 2);
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(40,40,40,0.14)';
    ctx.fillRect(0, y, S, h);
  }

  brushedRoughTex = toTexture(canvas, { wrap: THREE.RepeatWrapping });
  // Those streaks are grinding grooves, so the same field IS the height field:
  // gentle gain, because turning marks are microns deep, not millimetres.
  brushedNormalTex = normalMapFromHeight(canvas, 0.8, THREE.RepeatWrapping);
  return brushedRoughTex;
}

export interface BrushedTitaniumOptions {
  /** Base metal tint (default #b9c2cc — pale titanium). */
  color?: THREE.ColorRepresentation;
  /** EFFECTIVE mean roughness after the streak map (default 0.35). */
  roughness?: number;
  metalness?: number;
  /** Defaults to FrontSide (blade solids are capped; drums face outward). */
  side?: THREE.Side;
}

/**
 * Brushed titanium for compressor blades and drums: fine streak CanvasTexture
 * as roughnessMap over a bare-metal base. The map averages BRUSH_MEAN, so the
 * scalar is `roughness / BRUSH_MEAN` and the requested value is the effective
 * MEAN while streaks swing ±~40 % around it.
 *
 * IMPORTANT: emissive starts BLACK and stays caller-owned — Compressor.tsx
 * writes rotorMat.emissive / emissiveIntensity every frame for the surge
 * glow, and that mutation contract keeps working on these materials.
 */
export function createBrushedTitaniumMaterial(
  opts: BrushedTitaniumOptions = {},
): THREE.MeshStandardMaterial {
  const { color = '#b9c2cc', roughness = 0.35, metalness = 0.9, side = THREE.FrontSide } = opts;
  const mat = new THREE.MeshStandardMaterial({ color, metalness, side });
  const tex = getBrushedRoughnessTexture();
  if (tex) {
    mat.roughnessMap = tex;
    mat.roughness = roughness / BRUSH_MEAN;
    if (brushedNormalTex) {
      mat.normalMap = brushedNormalTex;
      mat.normalScale = new THREE.Vector2(0.4, 0.4);
    }
  } else {
    mat.roughness = roughness;
  }
  return mat;
}

/* ------------------------------------------------------------------------- *
 * 3. Painted nacelle cowl — off-white paint with large-scale mottling
 * ------------------------------------------------------------------------- */

/** Mean green value painted into the mottle map (used to normalize below). */
const MOTTLE_MEAN = 0.86;

let nacelleRoughTex: THREE.CanvasTexture | null | undefined;

function getNacelleRoughnessTexture(): THREE.CanvasTexture | null {
  if (nacelleRoughTex !== undefined) return nacelleRoughTex;
  const surf = tryMakeCanvas();
  if (!surf) {
    nacelleRoughTex = null;
    return nacelleRoughTex;
  }
  const { canvas, ctx } = surf;
  const rand = makeRand(3251); // fan diameter, mm

  const base = Math.round(MOTTLE_MEAN * 255);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Soft polish/weathering blobs. Each is stamped at 3×3 wrapped offsets so
  // the canvas tiles seamlessly — the cowl lathe wraps u around the full
  // circumference and the texture repeats 3× around it.
  for (let i = 0; i < 42; i++) {
    const bx = rand() * SIZE;
    const by = rand() * SIZE;
    const r = 18 + rand() * 46;
    const lighter = rand() > 0.5;
    const a = 0.04 + rand() * 0.08;
    const rgb = lighter ? '255,255,255' : '70,70,70';
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cx = bx + ox * SIZE;
        const cy = by + oy * SIZE;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(${rgb},${a})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }

  nacelleRoughTex = toTexture(canvas, { wrap: THREE.RepeatWrapping, repeat: [3, 1] });
  return nacelleRoughTex;
}

/**
 * The cowl: off-white/grey paint, low metalness, roughness ~0.5 with subtle
 * large-scale mottling (procedural roughnessMap).
 *
 * IMPORTANT: Nacelle.tsx mutates transparent / opacity / depthWrite / side on
 * this material per view mode — all plain MeshStandardMaterial flags, fully
 * compatible with the map. `side` starts DoubleSide to match every mode's
 * expectation (the thin shell is lit from both faces).
 */
export function createPaintedNacelleMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: '#d8dcdf',
    metalness: 0.1,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const tex = getNacelleRoughnessTexture();
  if (tex) {
    mat.roughnessMap = tex;
    mat.roughness = 0.5 / MOTTLE_MEAN; // effective mean lands on ~0.5
  }
  return mat;
}

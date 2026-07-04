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

/** All maps are painted at this square power-of-two size (mipmap friendly). */
const SIZE = 256;

/** Deterministic PRNG (Park–Miller) so every load paints identical textures. */
function makeRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface PaintSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** Offscreen canvas + 2D context, or null when headless (tests / SSR). */
function tryMakeCanvas(): PaintSurface | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

function toTexture(
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
}
let fanBladeMaps: FanBladeMaps | null | undefined; // undefined = not tried yet

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

function getBrushedRoughnessTexture(): THREE.CanvasTexture | null {
  if (brushedRoughTex !== undefined) return brushedRoughTex;
  const surf = tryMakeCanvas();
  if (!surf) {
    brushedRoughTex = null;
    return brushedRoughTex;
  }
  const { canvas, ctx } = surf;
  const rand = makeRand(23550); // N1 rated rpm ×10

  const base = Math.round(BRUSH_MEAN * 255);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 1 px machining streaks. Canvas +x maps CHORDWISE on the blades (their UVs
  // run u = chord) and CIRCUMFERENTIALLY on the drums (CylinderGeometry UVs) —
  // i.e. along the grinding/turning direction in both cases. Full-width rows
  // tile seamlessly under RepeatWrapping.
  for (let y = 0; y < SIZE; y++) {
    const v = THREE.MathUtils.clamp(BRUSH_MEAN + (rand() - 0.5) * 0.3, 0.55, 1.0);
    const g = Math.round(v * 255);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(0, y, SIZE, 1);
  }
  // A few wider polished bands / score lines for large-scale interest.
  for (let i = 0; i < 26; i++) {
    const y = Math.floor(rand() * SIZE);
    const h = 1 + Math.floor(rand() * 2);
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(40,40,40,0.14)';
    ctx.fillRect(0, y, SIZE, h);
  }

  brushedRoughTex = toTexture(canvas, { wrap: THREE.RepeatWrapping });
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

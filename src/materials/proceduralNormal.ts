/**
 * proceduralNormal.ts — derive tangent-space NORMAL MAPS from the height
 * patterns the material painters already draw.
 *
 * Why this exists: every material in this project was flat-shaded PBR (a
 * colour tint plus, at best, a roughness map). Mathematically perfect
 * smoothness is exactly what makes a render read as CAD instead of metal —
 * real hardware has machining marks, casting texture, weave and weld relief
 * that catch the light. Rather than ship texture assets (the project is
 * deliberately asset-free and offline), we take the SAME procedural canvases
 * the painters produce, treat their luminance as a height field, and Sobel it
 * into a normal map. Deterministic, zero network, one extra GPU upload.
 *
 * Convention: OpenGL-style tangent space (+Y up), which is what three.js
 * expects for `normalMap`. Flat areas encode as (0.5, 0.5, 1.0).
 */
import * as THREE from 'three';

/**
 * Sobel a height canvas into a tangent-space normal map.
 *
 * @param src     Canvas whose per-pixel LUMINANCE is read as height.
 * @param strength Slope gain. ~0.5 = a whisper of relief, ~4 = coarse casting.
 * @param wrap     Sampling wrap; must match how the source map is wrapped so
 *                 the derived relief tiles seamlessly with it.
 */
export function normalMapFromHeight(
  src: HTMLCanvasElement,
  strength: number,
  wrap: THREE.Wrapping = THREE.RepeatWrapping,
  maxSize = 1024,
): THREE.CanvasTexture | null {
  // Sobel is O(pixels): a 2048² source is ~4.2 M pixels × 9 taps, which is a
  // visible hitch at load. Surface relief is far lower-frequency than albedo,
  // so downsample first — 1024 carries every seam and rivet just fine.
  let source = src;
  if (Math.max(src.width, src.height) > maxSize) {
    const scale = maxSize / Math.max(src.width, src.height);
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(src.width * scale));
    small.height = Math.max(1, Math.round(src.height * scale));
    const sctxSmall = small.getContext('2d');
    if (!sctxSmall) return null;
    sctxSmall.drawImage(src, 0, 0, small.width, small.height);
    source = small;
  }

  const w = source.width;
  const h = source.height;
  const sctx = source.getContext('2d');
  if (!sctx) return null;
  const srcData = sctx.getImageData(0, 0, w, h).data;

  // Luminance height field in [0,1].
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    height[i] =
      (0.2126 * srcData[o] + 0.7152 * srcData[o + 1] + 0.0722 * srcData[o + 2]) / 255;
  }

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  if (!octx) return null;
  const dst = octx.createImageData(w, h);

  const repeat = wrap === THREE.RepeatWrapping;
  // Index with wrap (repeat) or clamp, so the derived map tiles exactly like
  // the source it came from.
  const at = (x: number, y: number): number => {
    let xi = x;
    let yi = y;
    if (repeat) {
      xi = ((x % w) + w) % w;
      yi = ((y % h) + h) % h;
    } else {
      xi = Math.min(w - 1, Math.max(0, x));
      yi = Math.min(h - 1, Math.max(0, y));
    }
    return height[yi * w + xi];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel gradients (3×3) — less noisy than a 2-tap difference.
      const dX =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dY =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));

      // Normal of the height surface; canvas +y runs DOWN while tangent-space
      // +Y runs up, so dY is negated.
      const nx = -dX * strength;
      const ny = dY * strength;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);

      const o = (y * w + x) * 4;
      dst.data[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      dst.data[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      dst.data[o + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      dst.data[o + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);

  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Paint a fresh height canvas with a callback, then Sobel it. Used where the
 * relief pattern is NOT the same image as an existing colour/roughness map
 * (cast housings, honeycomb, weld beads).
 */
export function heightCanvasToNormal(
  size: number,
  paint: (ctx: CanvasRenderingContext2D, size: number) => void,
  strength: number,
  wrap: THREE.Wrapping = THREE.RepeatWrapping,
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  paint(ctx, size);
  return normalMapFromHeight(canvas, strength, wrap);
}

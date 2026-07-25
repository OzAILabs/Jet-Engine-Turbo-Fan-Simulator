/**
 * hardware.ts — surface relief for the EXTERNAL hardware: the accessory
 * gearbox castings, case flanges, bolt circles, brackets and valve bodies.
 *
 * These are, collectively, the largest area of visible surface in the sim
 * (hundreds of greebles hung off the core) and every one of them was a flat
 * colour/metalness/roughness triple. Real hardware in this family splits into
 * two finishes that look nothing alike:
 *
 *   CAST  — sand- or investment-cast housings (AGB case, valve bodies, cast
 *           brackets): a fine orange-peel pebble, matte, slightly irregular.
 *   MACHINED — turned or ground faces (flanges, bolt heads, fittings, tube
 *           unions): fine directional tool marks, tighter and shinier.
 *
 * Both factories take the same colour/metalness/roughness the call sites
 * already used, so the palette is unchanged — the only difference is that
 * light now catches a surface instead of a mathematically perfect one.
 * Textures are module-level singletons (one paint + one upload each), shared
 * across every instance, exactly like the other material modules here.
 */
import * as THREE from 'three';
import { makeRand } from './coldSection';
import { heightCanvasToNormal } from './proceduralNormal';

const SIZE = 512;

export interface HardwareOptions {
  color?: THREE.ColorRepresentation;
  metalness?: number;
  roughness?: number;
  side?: THREE.Side;
}

/* --------------------------------------------------------------------------
 * Cast finish: orange-peel pebble
 * ------------------------------------------------------------------------ */

let castNormal: THREE.CanvasTexture | null | undefined;

function getCastNormal(): THREE.CanvasTexture | null {
  if (castNormal !== undefined) return castNormal;
  castNormal = heightCanvasToNormal(
    SIZE,
    (ctx, size) => {
      const rand = makeRand(4711);
      // Overlapping soft blobs at two scales: the coarse pass is the sand
      // grain of the mould, the fine pass is the shot-blast that follows.
      for (const [count, rMin, rMax, alpha] of [
        [520, 5, 14, 0.16],
        [1400, 1.5, 4, 0.1],
      ] as const) {
        for (let i = 0; i < count; i++) {
          const x = rand() * size;
          const y = rand() * size;
          const r = rMin + rand() * (rMax - rMin);
          const up = rand() > 0.5;
          // Stamp at wrapped offsets so the pattern tiles seamlessly.
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const cx = x + ox * size;
              const cy = y + oy * size;
              if (cx < -r || cx > size + r || cy < -r || cy > size + r) continue;
              const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
              const tone = up ? '255,255,255' : '0,0,0';
              g.addColorStop(0, `rgba(${tone},${alpha})`);
              g.addColorStop(1, `rgba(${tone},0)`);
              ctx.fillStyle = g;
              ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            }
          }
        }
      }
    },
    2.6,
    THREE.RepeatWrapping,
  );
  if (castNormal) castNormal.repeat.set(3, 3);
  return castNormal;
}

/**
 * Sand-cast housing finish (AGB case, valve bodies, cast brackets). Defaults
 * match the call sites' previous inline values.
 */
export function createCastingMaterial(opts: HardwareOptions = {}): THREE.MeshStandardMaterial {
  const { color = '#aab3bf', metalness = 0.8, roughness = 0.5, side = THREE.FrontSide } = opts;
  const mat = new THREE.MeshStandardMaterial({ color, metalness, roughness, side });
  const n = getCastNormal();
  if (n) {
    mat.normalMap = n;
    mat.normalScale = new THREE.Vector2(0.7, 0.7);
  }
  return mat;
}

/* --------------------------------------------------------------------------
 * Machined finish: fine directional tool marks
 * ------------------------------------------------------------------------ */

let machinedNormal: THREE.CanvasTexture | null | undefined;

function getMachinedNormal(): THREE.CanvasTexture | null {
  if (machinedNormal !== undefined) return machinedNormal;
  machinedNormal = heightCanvasToNormal(
    SIZE,
    (ctx, size) => {
      const rand = makeRand(9332); // N2 rated rpm
      // Full-width rows: tool marks running along one UV axis. Rows tile
      // seamlessly under RepeatWrapping.
      for (let y = 0; y < size; y++) {
        const v = 128 + Math.round((rand() - 0.5) * 46);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(0, y, size, 1);
      }
      // A few deeper grooves — the tool's feed lines.
      for (let i = 0; i < 40; i++) {
        const y = Math.floor(rand() * size);
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.26)';
        ctx.fillRect(0, y, size, 1 + Math.floor(rand() * 2));
      }
    },
    1.1,
    THREE.RepeatWrapping,
  );
  if (machinedNormal) machinedNormal.repeat.set(4, 4);
  return machinedNormal;
}

/**
 * Turned/ground finish (case flanges, bolt heads, brass fittings, tube
 * unions). Defaults match the call sites' previous inline values.
 */
export function createMachinedMaterial(opts: HardwareOptions = {}): THREE.MeshStandardMaterial {
  const { color = '#8a9099', metalness = 0.75, roughness = 0.45, side = THREE.FrontSide } = opts;
  const mat = new THREE.MeshStandardMaterial({ color, metalness, roughness, side });
  const n = getMachinedNormal();
  if (n) {
    mat.normalMap = n;
    mat.normalScale = new THREE.Vector2(0.45, 0.45);
  }
  return mat;
}

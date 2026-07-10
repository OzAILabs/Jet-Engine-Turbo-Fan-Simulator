/**
 * NacelleFurniture — the 3D hardware that sits ON the painted cowl skin:
 *
 *   - seven flush latch handles along the 6-o'clock cowl split (one per
 *     painted recess in materials/nacelleSkin.ts — base plate, handle bar and
 *     trigger tab, slightly proud of the skin),
 *   - the T2 inlet temperature probe inside the intake barrel at 1:30,
 *   - crisp placard DECALS (DANGER intake, OIL TANK ACCESS, HOIST POINT,
 *     COWL LATCHES) — thin planes 6 mm off the skin sharing one 512² canvas
 *     atlas, so close-up text stays sharp where the 2048² skin texture blurs.
 *
 * Everything is placed with the same nacelleSkin coordinate helpers +
 * clockToTheta as the painter, so decals land exactly on their painted doors.
 * Visible in 'full'; in 'cutaway' only the pieces whose skin survives the
 * wedge are kept (checked per item against CUTAWAY's theta window). Hidden in
 * transparent/exploded/internals along with the rest of the cowl decor.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimStore } from '../store/useSimStore';
import { clockToTheta, clockToYZ } from '../data/engineLayout';
import { CUTAWAY } from '../geometry/annularSection';
import { nacelleSkin as skin } from '../geometry/nacelleGeometry';
import { LATCH_XS } from '../materials/nacelleSkin';
import { toTexture, tryMakeCanvas } from '../materials/coldSection';

/* --------------------------------------------------------------------------
 * Steel: latch handles + T2 probe (ONE merged mesh)
 * ------------------------------------------------------------------------ */

function buildSteelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Cowl latches, sitting proud inside their painted recesses at 6 o'clock.
  for (const x of LATCH_XS) {
    const r = skin.outerRadiusAt(x);
    const base = new THREE.BoxGeometry(0.19, 0.006, 0.065);
    base.translate(x, -(r + 0.004), 0);
    const bar = new THREE.BoxGeometry(0.15, 0.016, 0.05);
    bar.translate(x - 0.008, -(r + 0.014), 0);
    const trigger = new THREE.BoxGeometry(0.045, 0.013, 0.032);
    trigger.translate(x + 0.052, -(r + 0.021), 0);
    parts.push(base, bar, trigger);
  }
  // T2 total-temperature probe inside the inlet barrel at 1:30 — stem in
  // from the wall, sensing head cranked forward into the oncoming flow.
  const probeX = -3.35;
  const rIn = skin.innerRadiusAt(probeX);
  const phi = (1.5 / 12) * Math.PI * 2;
  const stem = new THREE.CylinderGeometry(0.007, 0.009, 0.07, 8);
  stem.translate(0, rIn - 0.035, 0);
  const head = new THREE.BoxGeometry(0.016, 0.03, 0.013);
  head.translate(-0.015, rIn - 0.078, 0);
  for (const g of [stem, head]) {
    g.rotateX(-phi); // +Y → the ALF 1:30 direction (matches clockToYZ)
    g.translate(probeX, 0, 0);
    parts.push(g);
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

/* --------------------------------------------------------------------------
 * Placard decals: one 512² atlas canvas + merged tangent planes
 * ------------------------------------------------------------------------ */

/** Atlas designs: painter + physical aspect (height/width). 2×2 cell grid. */
const DESIGNS: Array<{ aspect: number; paint: (x: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number) => void }> = [
  {
    aspect: 0.2 / 0.26, // DANGER — intake
    paint: (c, x0, y0, w, h) => {
      c.strokeStyle = '#b3221d';
      c.lineWidth = 8;
      c.strokeRect(x0 + 6, y0 + 6, w - 12, h - 12);
      c.fillStyle = '#b3221d';
      c.font = '900 52px Arial, sans-serif';
      c.fillText('DANGER', x0 + w / 2, y0 + h * 0.32);
      c.fillStyle = '#1c1e22';
      c.font = '700 25px Arial, sans-serif';
      c.fillText('STAY CLEAR OF', x0 + w / 2, y0 + h * 0.62);
      c.fillText('INTAKE AREA', x0 + w / 2, y0 + h * 0.82);
    },
  },
  {
    aspect: 0.085 / 0.22, // OIL TANK ACCESS
    paint: (c, x0, y0, w, h) => {
      c.strokeStyle = '#1c1e22';
      c.lineWidth = 4;
      c.strokeRect(x0 + 3, y0 + 3, w - 6, h - 6);
      c.fillStyle = '#1c1e22';
      c.font = '700 29px Arial, sans-serif';
      c.fillText('OIL TANK ACCESS', x0 + w / 2, y0 + h * 0.42);
      c.fillStyle = '#5a6068';
      c.font = '600 15px Arial, sans-serif';
      c.fillText('AMM 79-11-01', x0 + w / 2, y0 + h * 0.78);
    },
  },
  {
    aspect: 0.08 / 0.2, // HOIST POINT
    paint: (c, x0, y0, w, h) => {
      c.strokeStyle = '#1c1e22';
      c.lineWidth = 4;
      c.strokeRect(x0 + 3, y0 + 3, w - 6, h - 6);
      c.fillStyle = '#1c1e22';
      c.font = '800 30px Arial, sans-serif';
      c.fillText('HOIST POINT', x0 + w / 2, y0 + h * 0.58);
      c.beginPath();
      c.moveTo(x0 + w / 2, y0 + 8);
      c.lineTo(x0 + w / 2 - 11, y0 + 26);
      c.lineTo(x0 + w / 2 + 11, y0 + 26);
      c.closePath();
      c.fill();
    },
  },
  {
    aspect: 0.11 / 0.26, // COWL LATCHES
    paint: (c, x0, y0, w, h) => {
      c.strokeStyle = '#b3221d';
      c.lineWidth = 5;
      c.strokeRect(x0 + 4, y0 + 4, w - 8, h - 8);
      c.fillStyle = '#1c1e22';
      c.font = '800 30px Arial, sans-serif';
      c.fillText('COWL LATCHES', x0 + w / 2, y0 + h * 0.36);
      c.font = '600 17px Arial, sans-serif';
      c.fillText('VERIFY FLUSH BEFORE FLIGHT', x0 + w / 2, y0 + h * 0.72);
    },
  },
];

/** Decal instances: [design, ALF hour, x center, width m]. */
const DECALS: Array<[number, number, number, number]> = [
  [0, 8.2, -3.05, 0.26], // DANGER — inlet, +Z side
  [0, 3.8, -3.05, 0.26], // DANGER — inlet, −Z side
  [1, 7.2, -1.35, 0.22], // OIL — on the oil access door
  [2, 10.4, -1.6, 0.2], // HOIST — upper +Z
  [2, 1.6, -1.6, 0.2], // HOIST — upper −Z
  [3, 5.6, -2.62, 0.26], // LATCHES — by the forward latch
];

const ATLAS = 512;
const CELL = ATLAS / 2;
const PAD = 2;

/** Content rect of a design inside its atlas cell (px). */
function cellRect(design: number): { x0: number; y0: number; w: number; h: number } {
  const x0 = (design % 2) * CELL;
  const y0 = Math.floor(design / 2) * CELL;
  const w = CELL - 2 * PAD;
  const h = Math.round(w * DESIGNS[design].aspect);
  return { x0: x0 + PAD, y0: y0 + PAD, w, h };
}

interface DecalBundle {
  geoFull: THREE.BufferGeometry;
  geoCut: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

function buildDecals(): DecalBundle | null {
  const surf = tryMakeCanvas(ATLAS);
  if (!surf) return null;
  const { canvas, ctx } = surf;
  ctx.fillStyle = '#f4f5f6';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  DESIGNS.forEach((d, i) => {
    const { x0, y0, w, h } = cellRect(i);
    d.paint(ctx, x0, y0, w, h);
  });

  const keptTheta = (theta: number) =>
    theta >= CUTAWAY.thetaStart && theta <= CUTAWAY.thetaStart + CUTAWAY.thetaLength;

  const makePlane = ([design, hour, x, wM]: [number, number, number, number]) => {
    const { x0, y0, w, h } = cellRect(design);
    const hM = wM * DESIGNS[design].aspect;
    const plane = new THREE.PlaneGeometry(wM, hM);
    // UVs → the design's atlas content rect (canvas y down, texture v up).
    const u0 = x0 / ATLAS;
    const u1 = (x0 + w) / ATLAS;
    const v1 = 1 - y0 / ATLAS;
    const v0 = 1 - (y0 + h) / ATLAS;
    const uv = plane.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
    }
    // Tangent frame on the cowl: +z_local = outward normal, +x_local = the
    // reading direction, +y_local = glyph-up. The −Z flank (ALF hours 0–6)
    // flips both tangents so text still reads nose→tail with tops up.
    const theta = clockToTheta(hour);
    const n = new THREE.Vector3(0, -Math.sin(theta), Math.cos(theta));
    const t1 = new THREE.Vector3(1, 0, 0);
    const t2 = new THREE.Vector3(0, Math.cos(theta), Math.sin(theta));
    if (hour < 6) {
      t1.negate();
      t2.negate();
    }
    const r = skin.outerRadiusAt(x) + 0.006;
    const p = clockToYZ(hour, r);
    const mtx = new THREE.Matrix4().makeBasis(t1, t2, n);
    mtx.setPosition(x, p.y, p.z);
    plane.applyMatrix4(mtx);
    return { plane, theta };
  };

  const all = DECALS.map(makePlane);
  const geoFull = mergeGeometries(all.map((a) => a.plane))!;
  const kept = all.filter((a) => keptTheta(a.theta));
  const geoCut = mergeGeometries(kept.map((a) => a.plane.clone()))!;
  all.forEach((a) => a.plane.dispose());

  const material = new THREE.MeshStandardMaterial({
    map: toTexture(canvas, { srgb: true }),
    roughness: 0.35,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  return { geoFull, geoCut, material };
}

export function NacelleFurniture() {
  const viewMode = useSimStore((s) => s.viewMode);

  const steelGeo = useMemo(buildSteelGeometry, []);
  const steelMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#454a51', metalness: 0.85, roughness: 0.38 }),
    [],
  );
  const decals = useMemo(buildDecals, []);

  // Furniture only makes sense on a SOLID skin: full + cutaway.
  if (viewMode !== 'full' && viewMode !== 'cutaway') return null;

  return (
    <group>
      {/* Latches + T2 probe (all at kept-wedge clock positions in cutaway). */}
      <mesh geometry={steelGeo} material={steelMat} castShadow={false} userData={{ noShadow: true }} />
      {/* Placard decals — in cutaway only those whose skin panel survives. */}
      {decals && (
        <mesh
          geometry={viewMode === 'cutaway' ? decals.geoCut : decals.geoFull}
          material={decals.material}
          castShadow={false}
          userData={{ noShadow: true }}
        />
      )}
    </group>
  );
}

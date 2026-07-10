/**
 * nacelleSkin.ts — the painted outer skin of the nacelle, authored in METERS.
 *
 * One 2048² color canvas + one 2048² bump canvas + one 1024² packed
 * roughness(G)/metalness(B) canvas, all procedural (no assets, deterministic
 * PRNG). The nacelle lathe's UVs are arc-length/absolute-angle remapped
 * (see geometry/nacelleGeometry.ts), so `nacelleSkin`'s coordinate helpers let
 * every feature below be placed by engine x / clock hour and sized in meters:
 *
 *   - bare-metal anti-ice inlet lip (paint stops in a fastened joint ring),
 *   - acoustic-liner + fan rub strip inside the inlet barrel,
 *   - circumferential panel joints (inlet/fan-cowl/reverser/core-cowl) and the
 *     12-and-6-o'clock fan-cowl & reverser split lines, all with fastener rows,
 *   - latched access doors (oil, IDG, starter, EEC, pressure relief, hydraulic)
 *     with hinge lines, perimeter fasteners and grubby AO,
 *   - anti-ice exhaust louvre with a heat-tinted wake,
 *   - "GE90-115B" markings on both sides (mirrored so each reads forward),
 *     navy accent rings on the inlet, mini service placards,
 *   - wear: aft-flowing grime streaks, exhaust soot at the trailing edge,
 *     scuffed latch bellies, paint chips at the metal lip edge, fine scratches.
 *
 * Canvas axes: x = u (circumference, wraps), y = v (profile arc, CanvasTexture
 * flipY ⇒ canvas TOP = v=1 = trailing edge, so "aft" is UP the canvas on the
 * outer skin). The rough/metal canvas is painted through a scale transform so
 * all three canvases share one master pixel space.
 */
import * as THREE from 'three';
import { nacelleSkin as skin } from '../geometry/nacelleGeometry';
import { makeRand, toTexture, tryMakeCanvas } from './coldSection';

const W = 2048; // master px space (color + bump canvases)
const RM = 1024; // packed rough/metal canvas (scaled to master space)

/** px per meter along v (axial-ish, along the profile arc). */
const MPV = W / skin.totalArc;
/** px per meter along u at local radius r (circumferential). */
const mpu = (r: number) => W / (2 * Math.PI * r);

const pxV = (v: number) => (1 - v) * W; // flipY
const pxU = (u: number) => (((u % 1) + 1) % 1) * W;

interface SkinMaps {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  rm: THREE.CanvasTexture;
}
let skinMaps: SkinMaps | null | undefined; // undefined = not tried yet

/* --------------------------------------------------------------------------
 * Feature tables (engine coordinates, meters, clock hours)
 * ------------------------------------------------------------------------ */

/** Circumferential panel joints on the outer skin. */
const JOINTS_X = [-2.78, -0.55, 1.6, 2.3];
/** Fan-cowl + reverser halves split at 12 and 6 o'clock across this x span. */
const SPLIT_SPAN: [number, number] = [-2.78, 1.6];
/** Latched access doors: [clock hour, x center, axial w, circumferential h]. */
const DOORS: Array<[number, number, number, number]> = [
  [4.8, -1.35, 0.46, 0.34], // oil tank access
  [5.5, -1.95, 0.36, 0.27], // IDG
  [7.1, -0.95, 0.36, 0.3], // starter
  [1.8, -2.35, 0.42, 0.33], // EEC
  [4.6, 0.55, 0.42, 0.32], // pressure relief
  [7.6, 0.9, 0.3, 0.24], // hydraulics
];
/** Cowl latch stations along the 6-o'clock split (recesses painted here;
 *  the 3D handles in NacelleFurniture.tsx sit on top of these). */
export const LATCH_XS = [-2.45, -1.9, -1.35, -0.8, 0.05, 0.65, 1.25];
/** Bare-metal anti-ice lip: paint edge on the inner barrel / outer skin. */
const LIP_METAL_INNER_X = -3.47;
const LIP_METAL_OUTER_X = -3.38;

/* --------------------------------------------------------------------------
 * Painter
 * ------------------------------------------------------------------------ */

function paintSkin(
  c: CanvasRenderingContext2D, // color (sRGB)
  b: CanvasRenderingContext2D, // bump (grayscale, 128 = flat)
  m: CanvasRenderingContext2D, // packed: G = roughness, B = metalness
): void {
  const rand = makeRand(115); // -115B
  m.scale(RM / W, RM / W); // rough/metal shares the master px space

  /** Dot on any ctx, wrapped across the u seam. */
  const dot = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, style: string) => {
    ctx.fillStyle = style;
    for (const ox of [0, -W, W]) {
      if (x + ox > -r - 2 && x + ox < W + r + 2) {
        ctx.beginPath();
        ctx.arc(x + ox, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  /** Full-circumference line at v (constant-x ring on the engine). */
  const ring = (ctx: CanvasRenderingContext2D, y: number, h: number, style: string) => {
    ctx.fillStyle = style;
    ctx.fillRect(0, y - h / 2, W, h);
  };
  /** Ring of fasteners at (x on outer/inner skin), ~7.5 cm pitch. */
  const fastenerRing = (v: number, r: number, opts: { onMetal?: boolean } = {}) => {
    const y = pxV(v);
    const n = Math.round((2 * Math.PI * r) / 0.075);
    for (let i = 0; i < n; i++) {
      const x = pxU((i + 0.5) / n);
      dot(c, x, y, 1.7, opts.onMetal ? 'rgba(70,76,84,0.7)' : 'rgba(84,90,97,0.5)');
      dot(b, x, y, 2.0, '#4e4e4e');
      dot(m, x, y, 2.2, opts.onMetal ? 'rgb(0,110,235)' : 'rgb(0,150,26)');
    }
  };

  // ---- base coats ---------------------------------------------------------
  c.fillStyle = '#d8dcdf';
  c.fillRect(0, 0, W, W);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, W, W);
  m.fillStyle = 'rgb(0,128,26)'; // roughness 0.5, metalness 0.1
  m.fillRect(0, 0, W, W);

  // Large soft tint blotches (weathered paint), wrapped across the u seam.
  for (let i = 0; i < 26; i++) {
    const bx = rand() * W;
    const by = rand() * W;
    const r = 90 + rand() * 240;
    const warm = rand() > 0.5;
    const rgb = warm ? '226,221,210' : '206,212,220';
    for (const ox of [0, -W, W]) {
      const g = c.createRadialGradient(bx + ox, by, 0, bx + ox, by, r);
      g.addColorStop(0, `rgba(${rgb},${0.03 + rand() * 0.05})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g;
      c.fillRect(bx + ox - r, by - r, r * 2, r * 2);
    }
  }
  // Fine speckle so the paint never reads as flat plastic.
  for (let i = 0; i < 3200; i++) {
    const x = rand() * W;
    const y = rand() * W;
    c.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(60,64,70,0.04)';
    c.fillRect(x, y, 1.4, 1.4);
  }

  // ---- inner inlet barrel: acoustic liner + fan rub strip -----------------
  {
    const vTop = skin.vOfInnerX(-3.44); // forward end (lip joint)
    const yTop = pxV(vTop);
    const yBot = pxV(0); // v=0 = barrel aft end
    c.fillStyle = '#d2d6da';
    c.fillRect(0, yTop, W, yBot - yTop);
    m.fillStyle = 'rgb(0,150,26)';
    m.fillRect(0, yTop, W, yBot - yTop);
    // Perforated acoustic panels: fine stipple grid + 8 circumferential
    // segment joints (the liner is built from arc segments).
    const yA = pxV(skin.vOfInnerX(-3.4));
    const yB = pxV(skin.vOfInnerX(-3.0));
    c.fillStyle = 'rgba(72,77,84,0.15)';
    for (let y = yA; y < yB; y += 3) {
      const off = (Math.floor(y / 3) % 2) * 1.5;
      for (let x = off; x < W; x += 3) c.fillRect(x, y, 1, 1);
    }
    c.fillStyle = 'rgba(90,95,100,0.4)';
    for (let s = 0; s < 8; s++) c.fillRect(pxU(s / 8) - 1, yA, 2, yB - yA);
    // Fan-tip rub strip (abradable band, gets scored in service).
    const yR0 = pxV(skin.vOfInnerX(-3.3));
    const yR1 = pxV(skin.vOfInnerX(-3.07));
    c.fillStyle = '#c3c6c9';
    c.fillRect(0, yR0, W, yR1 - yR0);
    m.fillStyle = 'rgba(0,185,26,0.9)';
    m.fillRect(0, yR0, W, yR1 - yR0);
    for (let i = 0; i < 14; i++) {
      const y = yR0 + rand() * (yR1 - yR0);
      ring(c, y, 1, `rgba(60,60,60,${0.05 + rand() * 0.06})`);
    }
    // Grime pools at the bottom of the intake (6 o'clock).
    const gx = pxU(0.25);
    const g = c.createRadialGradient(gx, (yA + yB) / 2, 0, gx, (yA + yB) / 2, 260);
    g.addColorStop(0, 'rgba(80,78,70,0.08)');
    g.addColorStop(1, 'rgba(80,78,70,0)');
    c.fillStyle = g;
    c.fillRect(gx - 260, yA - 40, 520, yB - yA + 80);
  }

  // ---- bare-metal anti-ice lip -------------------------------------------
  {
    const v0 = skin.vOfInnerX(LIP_METAL_INNER_X);
    const v1 = skin.vOfOuterX(LIP_METAL_OUTER_X);
    const y0 = pxV(v1); // v1 > v0 ⇒ y smaller
    const y1 = pxV(v0);
    c.fillStyle = '#c9ced4';
    c.fillRect(0, y0, W, y1 - y0);
    m.fillStyle = 'rgb(0,66,235)'; // polished + metallic
    m.fillRect(0, y0, W, y1 - y0);
    // Circumferential polish streaks.
    for (let i = 0; i < 46; i++) {
      const y = y0 + rand() * (y1 - y0);
      ring(c, y, 1, rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(80,86,94,0.05)');
    }
    // Skin-joint fastener rings where the lip bolts to the barrel.
    fastenerRing(skin.vOfInnerX(-3.455), skin.innerRadiusAt(-3.455), { onMetal: true });
    fastenerRing(skin.vOfOuterX(-3.365), skin.outerRadiusAt(-3.365), { onMetal: true });
    // Paint chips where the painted skin meets the metal (outer edge).
    const yEdge = pxV(skin.vOfOuterX(LIP_METAL_OUTER_X));
    for (let i = 0; i < 34; i++) {
      const x = rand() * W;
      const y = yEdge - 1 - rand() * 5;
      dot(c, x, y, 0.8 + rand() * 1.4, '#c4cad2');
      dot(m, x, y, 1.6, 'rgb(0,70,220)');
    }
    // Sparse bug strikes on the polished front.
    for (let i = 0; i < 22; i++) {
      const y = pxV(skin.noseV) + (rand() - 0.5) * 16;
      dot(c, rand() * W, y, 0.7 + rand() * 0.9, 'rgba(52,50,44,0.35)');
    }
  }

  // ---- circumferential panel joints + fastener rows -----------------------
  for (const x of JOINTS_X) {
    const v = skin.vOfOuterX(x);
    const y = pxV(v);
    const r = skin.outerRadiusAt(x);
    ring(c, y, 2.4, 'rgba(70,76,84,0.45)');
    ring(c, y - 2.6, 1.2, 'rgba(255,255,255,0.16)'); // catch-light on the aft edge
    ring(b, y, 3, '#565656');
    ring(m, y, 3, 'rgb(0,165,26)');
    fastenerRing(skin.vOfOuterX(x - 0.045), skin.outerRadiusAt(x - 0.045));
    fastenerRing(skin.vOfOuterX(x + 0.045), skin.outerRadiusAt(x + 0.045));
    // Grime streaks bleeding AFT (up-canvas) from the joint.
    for (let i = 0; i < 46; i++) {
      const sx = rand() * W;
      const len = (0.05 + rand() * 0.3) * MPV;
      const g = c.createLinearGradient(0, y, 0, y - len);
      g.addColorStop(0, `rgba(82,80,72,${0.03 + rand() * 0.05})`);
      g.addColorStop(1, 'rgba(82,80,72,0)');
      c.fillStyle = g;
      c.fillRect(sx, y - len, 1 + rand() * 2.5, len);
    }
    void r;
  }

  // ---- axial split lines (fan cowl + reverser halves) ---------------------
  {
    const y0 = pxV(skin.vOfOuterX(SPLIT_SPAN[1]));
    const y1 = pxV(skin.vOfOuterX(SPLIT_SPAN[0]));
    for (const u of [0.25, 0.75]) {
      const x = pxU(u);
      c.fillStyle = 'rgba(70,76,84,0.4)';
      c.fillRect(x - 1, y0, 2.2, y1 - y0);
      b.fillStyle = '#585858';
      b.fillRect(x - 1.5, y0, 3, y1 - y0);
      m.fillStyle = 'rgb(0,160,26)';
      m.fillRect(x - 1.5, y0, 3, y1 - y0);
    }
  }

  // ---- latch recesses along the 6-o'clock split ---------------------------
  for (const x of LATCH_XS) {
    const cx = pxU(0.25);
    const cy = pxV(skin.vOfOuterX(x));
    const hw = (0.085 * mpu(skin.outerRadiusAt(x))) / 2; // circ half-width px
    const hh = (0.21 * MPV) / 2; // axial half-height px
    c.fillStyle = 'rgba(52,56,62,0.3)';
    c.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
    b.fillStyle = '#5e5e5e';
    b.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
    m.fillStyle = 'rgb(0,155,26)';
    m.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
    // Scuffed paint around the latch (ground crew hands and boots).
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, hh * 2.2);
    g.addColorStop(0, 'rgba(70,70,74,0.07)');
    g.addColorStop(1, 'rgba(70,70,74,0)');
    c.fillStyle = g;
    c.fillRect(cx - hh * 2.2, cy - hh * 2.2, hh * 4.4, hh * 4.4);
  }

  // ---- access doors --------------------------------------------------------
  for (const [hour, x, wAx, hCirc] of DOORS) {
    const r = skin.outerRadiusAt(x);
    const cx = pxU(skin.uOfClock(hour));
    const cy = pxV(skin.vOfOuterX(x));
    const hw = (hCirc * mpu(r)) / 2; // canvas-x half extent (circumferential)
    const hh = (wAx * MPV) / 2; // canvas-y half extent (axial)
    // Soft AO halo, then the scribed outline, then a bump groove.
    c.strokeStyle = 'rgba(60,65,72,0.09)';
    c.lineWidth = 7;
    c.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    c.strokeStyle = 'rgba(75,80,88,0.55)';
    c.lineWidth = 2;
    c.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    b.strokeStyle = '#585858';
    b.lineWidth = 2.5;
    b.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    m.strokeStyle = 'rgb(0,160,26)';
    m.lineWidth = 3;
    m.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    // Hinge on the FORWARD edge (down-canvas), latch ticks on the aft edge.
    c.fillStyle = 'rgba(75,80,88,0.6)';
    c.fillRect(cx - hw * 0.8, cy + hh - 3.5, hw * 1.6, 3.5);
    c.fillRect(cx - hw * 0.55, cy - hh, 7, 4.5);
    c.fillRect(cx + hw * 0.55 - 7, cy - hh, 7, 4.5);
    // Perimeter fasteners (~7 cm pitch).
    const per = 2 * (hw + hh);
    const n = Math.max(8, Math.round(per / (0.07 * mpu(r))));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const d = t * per;
      let px: number;
      let py: number;
      const inset = 5;
      if (d < hw * 2) {
        px = cx - hw + d;
        py = cy - hh + inset;
      } else if (d < hw * 2 + hh * 2) {
        px = cx + hw - inset;
        py = cy - hh + (d - hw * 2);
      } else if (d < hw * 4 + hh * 2) {
        px = cx + hw - (d - hw * 2 - hh * 2);
        py = cy + hh - inset;
      } else {
        px = cx - hw + inset;
        py = cy + hh - (d - hw * 4 - hh * 2);
      }
      dot(c, px, py, 1.4, 'rgba(84,90,97,0.5)');
      dot(b, px, py, 1.7, '#525252');
    }
    // Grubby smudge near the latch edge.
    const g = c.createRadialGradient(cx, cy - hh, 0, cx, cy - hh, hh);
    g.addColorStop(0, 'rgba(76,74,68,0.06)');
    g.addColorStop(1, 'rgba(76,74,68,0)');
    c.fillStyle = g;
    c.fillRect(cx - hh, cy - hh * 2, hh * 2, hh * 2);
  }

  // ---- anti-ice exhaust louvre (right side, just aft of the metal lip) ----
  {
    const x = -3.28;
    const r = skin.outerRadiusAt(x);
    const cx = pxU(skin.uOfClock(4.0));
    const cy = pxV(skin.vOfOuterX(x));
    const rx = (0.09 * mpu(r)) / 2; // circ
    const ry = (0.15 * MPV) / 2; // axial
    c.fillStyle = '#34383d';
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
    b.fillStyle = '#3a3a3a';
    b.beginPath();
    b.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    b.fill();
    c.strokeStyle = '#b9bec5';
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = '#565b61';
    for (let i = -2; i <= 2; i++) c.fillRect(cx - rx * 0.7, cy + i * (ry / 3) - 1, rx * 1.4, 2);
    // Heat-tinted wake trailing aft.
    const g = c.createLinearGradient(0, cy - ry, 0, cy - ry - 0.5 * MPV);
    g.addColorStop(0, 'rgba(125,95,60,0.12)');
    g.addColorStop(1, 'rgba(125,95,60,0)');
    c.fillStyle = g;
    c.fillRect(cx - rx, cy - ry - 0.5 * MPV, rx * 2, 0.5 * MPV);
  }

  // ---- markings ------------------------------------------------------------
  // "GE90-115B" on both sides of the fan cowl, mirrored to read nose→tail.
  const engraveType = (hour: number, side: 'right' | 'left') => {
    const x = -1.62;
    const r = skin.outerRadiusAt(x);
    const cx = pxU(skin.uOfClock(hour));
    const cy = pxV(skin.vOfOuterX(x));
    const fontPx = 0.3 * mpu(r);
    c.save();
    c.translate(cx, cy);
    c.rotate(side === 'right' ? -Math.PI / 2 : Math.PI / 2);
    c.scale(MPV / mpu(r), 1); // advance in true meters along the axis
    c.font = `600 ${fontPx}px Arial, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#22304d';
    c.fillText('GE90-115B', 0, 0);
    c.restore();
  };
  engraveType(2.2, 'right');
  engraveType(9.8, 'left');
  // Navy accent rings on the inlet barrel.
  ring(c, pxV(skin.vOfOuterX(-3.0)), 0.036 * MPV, '#24334f');
  ring(c, pxV(skin.vOfOuterX(-2.93)), 0.014 * MPV, '#24334f');
  // Mini service placards (red-bordered, believable at distance).
  const placards: Array<[number, number]> = [
    [4.8, -1.05],
    [5.5, -2.2],
    [7.1, -0.68],
    [1.8, -2.06],
    [4.4, -2.95],
    [7.9, -2.95],
    [5.0, 0.15],
    [10.6, -1.3],
  ];
  for (const [hour, x] of placards) {
    const r = skin.outerRadiusAt(x);
    const cx = pxU(skin.uOfClock(hour));
    const cy = pxV(skin.vOfOuterX(x));
    const hw = (0.05 * mpu(r)) / 2;
    const hh = (0.09 * MPV) / 2;
    c.fillStyle = '#f2f3f4';
    c.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
    c.strokeStyle = rand() > 0.4 ? '#b03a37' : '#3a3f45';
    c.lineWidth = 1.5;
    c.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    c.fillStyle = '#9aa0a8';
    for (let i = 0; i < 3; i++) c.fillRect(cx - hw * 0.55, cy - hh * 0.6 + i * hh * 0.55, 1.2, hh * 1.1 * 0.35);
    m.fillStyle = 'rgb(0,70,26)'; // glossy sticker
    m.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
  }

  // ---- wear pass (kept last so grime overlays every feature) --------------
  // Exhaust soot creeping up the trailing edge.
  {
    const y0 = pxV(skin.vOfOuterX(2.72));
    const y1 = pxV(skin.vOfOuterX(2.4));
    const g = c.createLinearGradient(0, y1, 0, y0);
    g.addColorStop(0, 'rgba(55,52,48,0)');
    g.addColorStop(1, 'rgba(55,52,48,0.13)');
    c.fillStyle = g;
    c.fillRect(0, y0, W, y1 - y0);
    const gm = m.createLinearGradient(0, y1, 0, y0);
    gm.addColorStop(0, 'rgba(0,190,26,0)');
    gm.addColorStop(1, 'rgba(0,190,26,0.5)');
    m.fillStyle = gm;
    m.fillRect(0, y0, W, y1 - y0);
  }
  // Thin aft-flowing streaks seeded anywhere on the outer skin.
  const yNose = pxV(skin.noseV);
  for (let i = 0; i < 120; i++) {
    const sx = rand() * W;
    const sy = rand() * (yNose - 8);
    const len = (0.05 + rand() * 0.35) * MPV;
    const g = c.createLinearGradient(0, sy + len, 0, sy);
    g.addColorStop(0, `rgba(80,78,70,${0.02 + rand() * 0.05})`);
    g.addColorStop(1, 'rgba(80,78,70,0)');
    c.fillStyle = g;
    c.fillRect(sx, sy, 1 + rand() * 2, len);
  }
  // Fine scratches.
  for (let i = 0; i < 70; i++) {
    const sx = rand() * W;
    const sy = rand() * W;
    const a = rand() * Math.PI;
    const l = 8 + rand() * 34;
    c.strokeStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(60,62,66,0.05)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l);
    c.stroke();
  }
}

function getSkinMaps(): SkinMaps | null {
  if (skinMaps !== undefined) return skinMaps;
  const color = tryMakeCanvas(W);
  const bump = tryMakeCanvas(W);
  const rm = tryMakeCanvas(RM);
  if (!color || !bump || !rm) {
    skinMaps = null;
    return skinMaps;
  }
  paintSkin(color.ctx, bump.ctx, rm.ctx);
  skinMaps = {
    map: toTexture(color.canvas, { srgb: true, wrap: THREE.RepeatWrapping }),
    bump: toTexture(bump.canvas, { wrap: THREE.RepeatWrapping }),
    rm: toTexture(rm.canvas, { wrap: THREE.RepeatWrapping }),
  };
  return skinMaps;
}

/**
 * The decorated cowl skin. Same mutation contract as the old painted material
 * (Nacelle.tsx flips transparent/opacity/depthWrite/side per view mode);
 * scalars stay 1.0 so the packed maps rule. Headless fallback matches the old
 * flat paint.
 */
export function createNacelleSkinMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    metalness: 1.0,
    roughness: 1.0,
    side: THREE.DoubleSide,
  });
  const maps = getSkinMaps();
  if (maps) {
    mat.map = maps.map;
    mat.bumpMap = maps.bump;
    mat.bumpScale = 0.02;
    mat.roughnessMap = maps.rm;
    mat.metalnessMap = maps.rm;
  } else {
    mat.color.set('#d8dcdf');
    mat.metalness = 0.1;
    mat.roughness = 0.5;
  }
  return mat;
}

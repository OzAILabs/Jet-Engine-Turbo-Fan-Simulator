/**
 * Nacelle (cowl) geometry: a surface of revolution with a FAT elliptical inlet
 * lip, a bulged mid-body and a tapered tail. Built as an X-axis lathe so the
 * cutaway can be applied by limiting the sweep angle.
 *
 * The lathe's UVs are REMAPPED from three.js's defaults so a painted skin can
 * be authored in real-world coordinates:
 *   - v = normalized ARC LENGTH along the profile (three.js uses profile-point
 *     index, which stretches wildly between unevenly spaced points),
 *   - u = absolute angle / 2π (so the full shell and the cutaway shell sample
 *     the SAME texels — markings stay put when the wedge is removed).
 * `nacelleSkin` below converts between engine coordinates (x, clock hour) and
 * this UV space; the skin painter (materials/nacelleSkin.ts) and the cowl
 * furniture (latches, placards) both build on it.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AXIS, RADII } from '../data/engineLayout';
import { createLatheAlongX } from './annularSection';

// --- Inlet lip ellipse ------------------------------------------------------
// The leading edge is half an ellipse: bottom tangent flows into the inlet
// throat, top tangent lands exactly on the max cowl diameter. Sized so the
// highlight (nose) sits well forward — a thick, rounded lip like the real
// GE90-115B inlet, not a knife edge.
const LIP_B = (RADII.nacelleOuter - RADII.nacelleInner) / 2 - 0.0025; // radial semi-axis ≈ 0.10
const LIP_RC = RADII.nacelleOuter - LIP_B; // lip centerline radius (top tangent = max dia)
const LIP_A = 0.2; // axial semi-axis — the lip "fatness"
const LIP_XC = AXIS.inletLip + 0.06; // ellipse center; nose lands at LIP_XC − LIP_A

/**
 * The single continuous cowl profile: inner barrel aft→forward, around the
 * elliptical lip, then the outer skin forward→aft to the trailing edge.
 */
function buildNacelleProfile(): Array<[number, number]> {
  const { fanPlane, bypassNozzleExit, nacelleBack } = AXIS;
  const { nacelleOuter, nacelleInner } = RADII;

  const pts: Array<[number, number]> = [
    // --- inner inlet barrel (throat), just outside the fan, going FORWARD ---
    [fanPlane + 0.25, nacelleInner + 0.003],
    [-3.3, nacelleInner + 0.0015], // throat: minimum radius, aft of the highlight
    [-3.46, nacelleInner + 0.0035],
  ];
  // --- elliptical leading edge: bottom tangent → nose → top tangent -------
  for (let deg = 270; deg >= 90; deg -= 15) {
    const t = (deg * Math.PI) / 180;
    pts.push([LIP_XC + LIP_A * Math.cos(t), LIP_RC + LIP_B * Math.sin(t)]);
  }
  pts.push(
    // --- cowl outer body: hold max diameter, then a STEADY taper aft ------
    [fanPlane + 0.4, nacelleOuter],
    [-1.5, nacelleOuter * 0.974],
    [-0.2, nacelleOuter * 0.919],
    [1.0, nacelleOuter * 0.838],
    [1.8, nacelleOuter * 0.757],
    [2.2, nacelleOuter * 0.703],
    [bypassNozzleExit, nacelleOuter * 0.638], // ~1.18: open bypass-nozzle lip
    [nacelleBack, nacelleOuter * 0.611], // ~1.13 trailing edge
  );
  return pts;
}

const PROFILE = buildNacelleProfile();
/** Index of the forward-most profile point (the lip nose / highlight). */
const NOSE_INDEX = PROFILE.reduce((best, p, i) => (p[0] < PROFILE[best][0] ? i : best), 0);

/** Cumulative arc length at each profile point. */
const ARC: number[] = [0];
for (let j = 1; j < PROFILE.length; j++) {
  const dx = PROFILE[j][0] - PROFILE[j - 1][0];
  const dr = PROFILE[j][1] - PROFILE[j - 1][1];
  ARC.push(ARC[j - 1] + Math.hypot(dx, dr));
}
const TOTAL_ARC = ARC[ARC.length - 1];

/**
 * Rewrite the lathe's UVs: v ← arc-length fraction, u ← absolute angle / 2π.
 * LatheGeometry writes v = j/(N−1) exactly, so rounding recovers the profile
 * point index; u spans 0..1 across whatever partial sweep was requested, so
 * folding thetaStart/Length back in makes the cutaway sample the same texels.
 */
function remapLatheUVs(geo: THREE.BufferGeometry, thetaStart: number, thetaLength: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const nSeg = PROFILE.length - 1;
  for (let k = 0; k < uv.count; k++) {
    const j = Math.round(uv.getY(k) * nSeg);
    uv.setY(k, ARC[j] / TOTAL_ARC);
    uv.setX(k, (thetaStart + uv.getX(k) * thetaLength) / (Math.PI * 2));
  }
  uv.needsUpdate = true;
}

/**
 * Same UV remap for a SUB-profile lathe: vByPoint carries each profile
 * point's arc fraction within the FULL cowl profile, so a piece cut out of
 * the shell (fan-cowl door, remnant strip) samples exactly the texels the
 * intact shell showed there. u may exceed 1 for sweeps crossing θ = 2π —
 * the skin maps use RepeatWrapping, so it lands on the same texels.
 */
function remapSubLatheUVs(
  geo: THREE.BufferGeometry,
  vByPoint: number[],
  thetaStart: number,
  thetaLength: number,
): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const nSeg = vByPoint.length - 1;
  for (let k = 0; k < uv.count; k++) {
    const j = Math.round(uv.getY(k) * nSeg);
    uv.setY(k, vByPoint[j]);
    uv.setX(k, (thetaStart + uv.getX(k) * thetaLength) / (Math.PI * 2));
  }
  uv.needsUpdate = true;
}

/** Outer-skin sub-profile x0→x1 (interpolated ends) + per-point arc v. */
function outerSub(x0: number, x1: number): { pts: Array<[number, number]>; v: number[] } {
  const last = PROFILE.length - 1;
  const pts: Array<[number, number]> = [[x0, rOnBranch(x0, last, NOSE_INDEX)]];
  const v: number[] = [vOnBranch(x0, last, NOSE_INDEX)];
  for (let j = NOSE_INDEX; j <= last; j++) {
    if (PROFILE[j][0] > x0 && PROFILE[j][0] < x1) {
      pts.push(PROFILE[j]);
      v.push(ARC[j] / TOTAL_ARC);
    }
  }
  pts.push([x1, rOnBranch(x1, last, NOSE_INDEX)]);
  v.push(vOnBranch(x1, last, NOSE_INDEX));
  return { pts, v };
}

/** Interpolate arc-length fraction at axial position x on one profile branch. */
function vOnBranch(x: number, from: number, to: number): number {
  const step = from < to ? 1 : -1;
  for (let j = from; j !== to; j += step) {
    const [x0] = PROFILE[j];
    const [x1] = PROFILE[j + step];
    if ((x - x0) * (x - x1) <= 0 && x0 !== x1) {
      const t = (x - x0) / (x1 - x0);
      const a0 = ARC[Math.min(j, j + step)];
      const a1 = ARC[Math.max(j, j + step)];
      // Walking against profile order still lerps between the same two arcs.
      const arc = step > 0 ? THREE.MathUtils.lerp(a0, a1, t) : THREE.MathUtils.lerp(a1, a0, t);
      return arc / TOTAL_ARC;
    }
  }
  // Clamp: forward of the nose → the nose; otherwise the branch's own start
  // (v=0 for the inner walk, v=1 for the outer walk).
  return x <= PROFILE[NOSE_INDEX][0] ? ARC[NOSE_INDEX] / TOTAL_ARC : ARC[from] / TOTAL_ARC;
}

/** Interpolate radius at axial position x on one profile branch. */
function rOnBranch(x: number, from: number, to: number): number {
  const step = from < to ? 1 : -1;
  for (let j = from; j !== to; j += step) {
    const [x0, r0] = PROFILE[j];
    const [x1, r1] = PROFILE[j + step];
    if ((x - x0) * (x - x1) <= 0 && x0 !== x1) {
      return THREE.MathUtils.lerp(r0, r1, (x - x0) / (x1 - x0));
    }
  }
  return x <= PROFILE[NOSE_INDEX][0] ? PROFILE[NOSE_INDEX][1] : PROFILE[from][1];
}

/**
 * Engine-coordinates → cowl-UV conversions (plus real sizes for scaling
 * features in meters). "inner" walks the inlet barrel from the fan forward to
 * the lip nose; "outer" walks the nose aft to the trailing edge.
 */
export const nacelleSkin = {
  /** Total profile arc length [m] — sets the meters-per-v scale. */
  totalArc: TOTAL_ARC,
  /** v at the lip nose (the forward-most point / paint↔metal watershed). */
  noseV: ARC[NOSE_INDEX] / TOTAL_ARC,
  /** Forward-most x of the cowl (the lip highlight). */
  noseX: PROFILE[NOSE_INDEX][0],
  /** v of a point on the INNER barrel (x from ~−2.95 forward to the nose). */
  vOfInnerX: (x: number) => vOnBranch(x, 0, NOSE_INDEX),
  /** v of a point on the OUTER skin (x from the nose aft to ~2.72). */
  vOfOuterX: (x: number) => vOnBranch(x, PROFILE.length - 1, NOSE_INDEX),
  /** Outer-skin radius at axial x (for circumference/px scaling, furniture). */
  outerRadiusAt: (x: number) => rOnBranch(x, PROFILE.length - 1, NOSE_INDEX),
  /** Inner-barrel radius at axial x. */
  innerRadiusAt: (x: number) => rOnBranch(x, 0, NOSE_INDEX),
  /**
   * u of an ALF clock position (project convention, clockToYZ: y = r·cosφ,
   * z = −r·sinφ). The lathe puts u = 0 at 9 o'clock and sweeps DOWN the
   * ALF dial: 6 o'clock at u = 0.25, 3 at 0.5, 12 at 0.75 — equivalent to
   * clockToTheta(hour) / 2π.
   */
  uOfClock: (hour: number) => (((0.75 - hour / 12) % 1) + 1) % 1,
} as const;

/**
 * Outer nacelle shell. Pass a partial thetaStart/thetaLength for the cutaway;
 * UVs always address the full 0..1 texture space (see remapLatheUVs).
 */
export function createNacelleShell(
  opts: { thetaStart?: number; thetaLength?: number } = {},
): THREE.BufferGeometry {
  const { thetaStart = 0, thetaLength = Math.PI * 2 } = opts;
  const geo = createLatheAlongX(PROFILE, { segments: 140, thetaStart, thetaLength });
  remapLatheUVs(geo, thetaStart, thetaLength);
  return geo;
}

/**
 * Noise-reduction CHEVRONS on the bypass-nozzle trailing edge — the GEnx/787
 * style sawtooth (the real GE90-115B has a plain lip; this is a deliberate
 * aesthetic upgrade). A lathe can't vary with theta, so this is a custom band
 * welded onto the shell's trailing edge: forward edge matches the cowl's
 * radius and taper exactly, the aft edge is a rounded triangle wave, and the
 * tips droop into the exhaust stream like the real serrations. UVs continue
 * the shell's (u = absolute angle, v = last sooty rows of the skin texture),
 * so the band wears the same paint/soot and ghosts with the same material in
 * every view mode. Pass the CUTAWAY theta window for the cut shell — the
 * sawtooth phase is a function of absolute theta, so both variants align.
 */
const CHEVRON_COUNT = 16;
const CHEVRON_LENGTH = 0.34; // axial reach of a tip beyond the trailing edge
const CHEVRON_DROOP = 0.06; // radial dip of a tip into the exhaust stream

export function createNacelleChevrons(
  opts: { thetaStart?: number; thetaLength?: number } = {},
): THREE.BufferGeometry {
  const { thetaStart = 0, thetaLength = Math.PI * 2 } = opts;
  const x0 = AXIS.nacelleBack;
  const r0 = RADII.nacelleOuter * 0.611; // shell trailing-edge radius
  const slope =
    (RADII.nacelleOuter * (0.611 - 0.638)) / (AXIS.nacelleBack - AXIS.bypassNozzleExit);

  const segs = Math.max(12, Math.round(224 * (thetaLength / (Math.PI * 2))));
  const rows = 6;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const theta = thetaStart + (i / segs) * thetaLength;
    // Rounded triangle wave in absolute theta: 1 at a tip center, 0 in a
    // valley; the small floor keeps valley quads non-degenerate.
    const s = ((theta * CHEVRON_COUNT) / (Math.PI * 2)) % 1;
    const w = Math.pow(0.5 - 0.5 * Math.cos(Math.PI * 2 * s), 0.85);
    const wEff = 0.03 + 0.97 * w;
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const x = x0 + t * CHEVRON_LENGTH * wEff;
      const r = r0 + (x - x0) * slope - CHEVRON_DROOP * t * t * w;
      // Lathe vertex convention (annularSection): y = −r·sinθ, z = r·cosθ.
      positions.push(x, -r * Math.sin(theta), r * Math.cos(theta));
      uvs.push(theta / (Math.PI * 2), 0.986 + t * 0.012);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = a + rows + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Inner wall of the bypass duct (the cowl's inner surface) = outer boundary of
 * the bypass flow path. It tapers steadily (tracking the outer skin) to the
 * bypass-nozzle exit, leaving a LARGE annular gap to the core cowl through
 * which the bypass air leaves — not a tight little hole. Shared with the
 * solid-wall cut faces below, which treat the space between this and the
 * outer shell as the cowl's structural thickness.
 */
const DUCT_PROFILE: Array<[number, number]> = [
  // Starts EXACTLY at the shell's inner-barrel aft edge so barrel + duct wall
  // read as ONE continuous surface (no lap joint, no bridge ring), and holds
  // near-cylindrical until aft of the REAL fan-blade envelope before
  // tapering. The nominal blade is deceiving: the tip trailing edge sweeps
  // back to x ≈ −2.48 (sweep 0.34 + 0.78 chord), and twist/camber z-offsets
  // push the true tip radius to ~1.63 (√(r² + z²), not the loft's r) — the
  // old taper from x −3.1 cut straight through that arc.
  [PROFILE[0][0], PROFILE[0][1]], // −2.95, 1.648
  [-2.4, 1.643], // still ~10 mm above the true tip arc at the TE corner
  [0.0, 1.5],
  [1.0, 1.32],
  [1.8, 1.18],
  [2.2, 1.1],
  [AXIS.bypassNozzleExit, 1.02], // bypass nozzle exit (wide annulus around the core)
];

export function createBypassDuctInner(
  opts: { thetaStart?: number; thetaLength?: number } = {},
): THREE.BufferGeometry {
  return createLatheAlongX(DUCT_PROFILE, { segments: 110, ...opts });
}

/** Sandwich-panel thickness shown at the cut faces [m]. */
const SHELL_PANEL_T = 0.035;
const DUCT_PANEL_T = 0.03;

/**
 * Offset a profile polyline sideways in the (x, r) plane by t, using averaged
 * segment normals (n = (dr, −dx)/len — the material side of the shell curve;
 * pass negative t for the opposite side).
 */
function offsetPolyline(pts: Array<[number, number]>, t: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let j = 0; j < pts.length; j++) {
    const a = pts[Math.max(0, j - 1)];
    const b = pts[Math.min(pts.length - 1, j + 1)];
    const dx = b[0] - a[0];
    const dr = b[1] - a[1];
    const len = Math.hypot(dx, dr) || 1;
    out.push([pts[j][0] + (dr / len) * t, pts[j][1] - (dx / len) * t]);
  }
  return out;
}

/**
 * The cowl's CUT FACES for the museum cutaway: NOT a solid fill — a real
 * cowl is thin honeycomb-sandwich skins with a hollow cavity between. Each
 * cut plane gets two PANEL BANDS: the shell profile (inner barrel → lip →
 * outer skin) with ~3.5 cm of panel thickness on its material side, and the
 * bypass-duct wall with ~3 cm on the cavity side. The lip therefore reads as
 * a hollow D-duct with a thick wrapped skin, and the space between outer
 * skin and duct wall stays visibly open. Returns all four bands merged (one
 * mesh, DoubleSide it).
 */
export function createNacelleCutFaces(thetaStart: number, thetaLength: number): THREE.BufferGeometry {
  const bandOutline = (pts: Array<[number, number]>, t: number) => [
    ...pts.map(([x, r]) => new THREE.Vector2(x, r)),
    ...offsetPolyline(pts, t)
      .reverse()
      .map(([x, r]) => new THREE.Vector2(x, r)),
  ];
  const shapes = [
    new THREE.Shape(bandOutline(PROFILE, SHELL_PANEL_T)),
    new THREE.Shape(bandOutline(DUCT_PROFILE, -DUCT_PANEL_T)),
  ];
  const faces: THREE.BufferGeometry[] = [];
  for (const theta of [thetaStart, thetaStart + thetaLength]) {
    for (const shape of shapes) {
      const geo = new THREE.ShapeGeometry(shape, 24);
      // Shape space (x, r) → the half-plane at constant theta: X stays axial,
      // shape-Y maps onto the radial ray (lathe convention y=−r·sinθ, z=r·cosθ).
      geo.applyMatrix4(
        new THREE.Matrix4().makeBasis(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, -Math.sin(theta), Math.cos(theta)),
          new THREE.Vector3(0, -Math.cos(theta), -Math.sin(theta)),
        ),
      );
      faces.push(geo);
    }
  }
  const merged = mergeGeometries(faces)!;
  faces.forEach((g) => g.dispose());
  return merged;
}

/**
 * Closeout structure sealing the cowl cavity in EVERY view mode: an angled
 * ring joining the outer-skin trailing edge to the bypass-duct exit lip, and
 * the inlet's AFT BULKHEAD — the flat ring wall closing the back of the
 * hollow D-duct (barrel → outer skin), like the real attach bulkhead. (The
 * barrel/duct junction itself needs no ring anymore: DUCT_PROFILE starts at
 * PROFILE[0], so the inner wall is one continuous piece.) The structure
 * stays hollow, but you can no longer sight into the open-ended cavity or
 * through the D-duct's cut opening onto the far-side fan blades.
 */
export function createNacelleCloseouts(
  opts: { thetaStart?: number; thetaLength?: number } = {},
): THREE.BufferGeometry {
  const aft = createLatheAlongX(
    [PROFILE[PROFILE.length - 1], DUCT_PROFILE[DUCT_PROFILE.length - 1]],
    { segments: 110, ...opts },
  );
  const bulkhead = createLatheAlongX(
    [PROFILE[0], [PROFILE[0][0], RADII.nacelleOuter]],
    { segments: 110, ...opts },
  );
  const merged = mergeGeometries([aft, bulkhead])!;
  aft.dispose();
  bulkhead.dispose();
  return merged;
}

/* --------------------------------------------------------------------------
 * Fan-cowl doors — the panels that DEPART in a severe blade-off event
 * (SWA 1380-style). The fan cowl spans the two painted circumferential
 * joints; its left/right halves hinge at 12:00 and latch at 6:00, so when
 * they tear away, narrow hinge and latch strips stay behind (the 3D latch
 * handles keep their footing on the bottom strip).
 * ------------------------------------------------------------------------ */
export const FAN_COWL = {
  x0: -2.78, // forward joint (matches the painted seam)
  x1: -0.55, // aft joint
  /** Half-widths [rad] of the hinge (12:00) and latch (6:00) remnant strips. */
  hingeHalf: 0.1,
  latchHalf: 0.12,
} as const;

const THETA_TOP = (3 * Math.PI) / 2; // u = 0.75 → ALF 12:00
const THETA_BOTTOM = Math.PI / 2; // u = 0.25 → ALF 6:00

/**
 * The cowl shell with BOTH fan-cowl doors gone: forward section (barrel +
 * lip), aft section (reverser/core cowl), and the hinge + latch remnant
 * strips across the door bay. Full-view (and transparent) only — the
 * cutaway keeps its normal cut shell, which is an analysis view.
 */
export function createNacelleShellDoorsOff(): THREE.BufferGeometry {
  const last = PROFILE.length - 1;
  // Forward piece: every profile point up the barrel/lip/skin to x0.
  const fwdPts: Array<[number, number]> = [];
  const fwdV: number[] = [];
  for (let j = 0; j <= last && (j <= NOSE_INDEX || PROFILE[j][0] < FAN_COWL.x0); j++) {
    fwdPts.push(PROFILE[j]);
    fwdV.push(ARC[j] / TOTAL_ARC);
  }
  fwdPts.push([FAN_COWL.x0, rOnBranch(FAN_COWL.x0, last, NOSE_INDEX)]);
  fwdV.push(vOnBranch(FAN_COWL.x0, last, NOSE_INDEX));
  const aftSub = outerSub(FAN_COWL.x1, AXIS.nacelleBack);
  const band = outerSub(FAN_COWL.x0, FAN_COWL.x1);

  const parts: THREE.BufferGeometry[] = [];
  const fwd = createLatheAlongX(fwdPts, { segments: 140 });
  remapSubLatheUVs(fwd, fwdV, 0, Math.PI * 2);
  parts.push(fwd);
  const aft = createLatheAlongX(aftSub.pts, { segments: 140 });
  remapSubLatheUVs(aft, aftSub.v, 0, Math.PI * 2);
  parts.push(aft);
  for (const [center, half] of [
    [THETA_TOP, FAN_COWL.hingeHalf],
    [THETA_BOTTOM, FAN_COWL.latchHalf],
  ]) {
    const strip = createLatheAlongX(band.pts, {
      segments: 8,
      thetaStart: center - half,
      thetaLength: half * 2,
    });
    remapSubLatheUVs(strip, band.v, center - half, half * 2);
    parts.push(strip);
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

export interface FanCowlDoor {
  geometry: THREE.BufferGeometry; // centered on its own centroid
  /** World position of the door's centroid when installed. */
  center: THREE.Vector3;
  /** Unit outward radial at the door's mid-arc (its fly-away direction). */
  outward: THREE.Vector3;
}

/**
 * The two fan-cowl door panels as separate geometries (translated to their
 * own centroids so they can tumble about themselves). They wear the painted
 * skin material — texts, doors, rivets fly away with them.
 */
export function createFanCowlDoors(): [FanCowlDoor, FanCowlDoor] {
  const band = outerSub(FAN_COWL.x0, FAN_COWL.x1);
  const midX = (FAN_COWL.x0 + FAN_COWL.x1) / 2;
  const midR = rOnBranch(midX, PROFILE.length - 1, NOSE_INDEX);
  const spans: Array<[number, number]> = [
    // Left door: from the latch strip's edge up the −Z side to the hinge.
    [THETA_BOTTOM + FAN_COWL.latchHalf, THETA_TOP - FAN_COWL.hingeHalf],
    // Right door: from the hinge down the +Z side back to the latch (crosses 2π).
    [THETA_TOP + FAN_COWL.hingeHalf, Math.PI * 2 + THETA_BOTTOM - FAN_COWL.latchHalf],
  ];
  return spans.map(([t0, t1]) => {
    const geo = createLatheAlongX(band.pts, {
      segments: 70,
      thetaStart: t0,
      thetaLength: t1 - t0,
    });
    remapSubLatheUVs(geo, band.v, t0, t1 - t0);
    const mid = (t0 + t1) / 2;
    // Lathe vertex convention: y = −r·sinθ, z = r·cosθ.
    const outward = new THREE.Vector3(0, -Math.sin(mid), Math.cos(mid));
    const center = new THREE.Vector3(midX, outward.y * midR, outward.z * midR);
    geo.translate(-center.x, -center.y, -center.z);
    return { geometry: geo, center, outward };
  }) as [FanCowlDoor, FanCowlDoor];
}

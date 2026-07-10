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
 * Inner wall of the bypass duct (the cowl's inner surface). A simple taper that
 * forms the outer boundary of the bypass flow path.
 */
export function createBypassDuctInner(
  opts: { thetaStart?: number; thetaLength?: number } = {},
): THREE.BufferGeometry {
  const { fanPlane, bypassNozzleExit } = AXIS;
  // Inner wall of the cowl = outer boundary of the bypass flow path. It tapers
  // steadily (tracking the outer skin) to the bypass-nozzle exit, leaving a
  // LARGE annular gap to the core cowl through which the bypass air leaves —
  // not a tight little hole.
  const profile: Array<[number, number]> = [
    [fanPlane + 0.1, RADII.nacelleInner * 0.99],
    [0.0, 1.5],
    [1.0, 1.32],
    [1.8, 1.18],
    [2.2, 1.1],
    [bypassNozzleExit, 1.02], // bypass nozzle exit (wide annulus around the core)
  ];
  return createLatheAlongX(profile, { segments: 110, ...opts });
}

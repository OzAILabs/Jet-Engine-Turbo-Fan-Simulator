/**
 * Procedural blade geometry.
 *
 * A blade is built as a *solid lofted airfoil*, not a flat rectangle:
 *   1. At each radial station we lay out a closed airfoil cross-section
 *      (upper + lower surface) with camber, thickness and twist.
 *   2. We loft (skin) those closed loops from root to tip.
 *   3. We cap the root and tip so the blade is watertight.
 *
 * The blade spans radially along +Y with the airfoil chord in the X–Z plane.
 * A component places copies by rotating the mesh about the engine's X axis.
 *
 * All inputs are plain numbers so the same routine serves fan, compressor and
 * turbine blades — the per-type presets live in the sibling geometry files.
 */
import * as THREE from 'three';

export interface BladeParams {
  radiusInner: number;
  radiusOuter: number;
  chordRoot: number;
  chordTip: number;
  /** Axial (X) sweep of the tip relative to the root [m]. */
  sweep: number;
  twistRootDeg: number;
  twistTipDeg: number;
  /** Max thickness as a fraction of local chord. */
  thickness: number;
  /** Camber (max camber-line rise) as a fraction of local chord. */
  camber: number;
  segmentsRadial: number;
  segmentsChord: number;
}

const DEG = Math.PI / 180;

/** Symmetric thickness distribution, zero at LE/TE, max near mid-chord. */
const thicknessShape = (u: number) => Math.pow(Math.sin(Math.PI * u), 0.9);
/** Camber line shape, zero at LE/TE. */
const camberShape = (u: number) => Math.sin(Math.PI * u);

export function createBladeGeometry(params: BladeParams): THREE.BufferGeometry {
  const {
    radiusInner,
    radiusOuter,
    chordRoot,
    chordTip,
    sweep,
    twistRootDeg,
    twistTipDeg,
    thickness,
    camber,
    segmentsRadial,
    segmentsChord,
  } = params;

  const nRad = Math.max(2, segmentsRadial + 1);
  const nChord = Math.max(3, segmentsChord + 1);

  // Build a single closed cross-section loop at radial fraction f.
  // Loop = upper surface (LE→TE) then lower surface (TE→LE), endpoints shared.
  const loopLen = 2 * nChord - 2;

  const positions: number[] = [];

  const pushPoint = (f: number, u: number, side: 1 | -1) => {
    const r = THREE.MathUtils.lerp(radiusInner, radiusOuter, f);
    const chord = THREE.MathUtils.lerp(chordRoot, chordTip, f);
    const twist = THREE.MathUtils.lerp(twistRootDeg, twistTipDeg, f) * DEG;
    const xBase = sweep * f * f; // more sweep toward the tip

    const s = (u - 0.5) * chord; // chordwise position, −c/2 … +c/2
    const cam = camber * chord * camberShape(u);
    const halfThk = 0.5 * thickness * chord * thicknessShape(u);

    // chord direction d and its in-plane normal n (both in the X–Z plane)
    const dx = Math.cos(twist);
    const dz = Math.sin(twist);
    const nx = -Math.sin(twist);
    const nz = Math.cos(twist);

    const off = cam + side * halfThk;
    const x = xBase + dx * s + nx * off;
    const z = dz * s + nz * off;
    positions.push(x, r, z);
  };

  // Emit all rings.
  for (let j = 0; j < nRad; j++) {
    const f = j / (nRad - 1);
    // upper surface LE→TE  (u: 0 … 1)
    for (let i = 0; i < nChord; i++) pushPoint(f, i / (nChord - 1), 1);
    // lower surface TE→LE, excluding the shared endpoints (i = nChord-2 … 1)
    for (let i = nChord - 2; i >= 1; i--) pushPoint(f, i / (nChord - 1), -1);
  }

  const indices: number[] = [];
  const ringStart = (j: number) => j * loopLen;

  // Loft the closed loops.
  for (let j = 0; j < nRad - 1; j++) {
    for (let k = 0; k < loopLen; k++) {
      const kNext = (k + 1) % loopLen;
      const a = ringStart(j) + k;
      const b = ringStart(j) + kNext;
      const c = ringStart(j + 1) + kNext;
      const d = ringStart(j + 1) + k;
      indices.push(a, b, c, a, c, d);
    }
  }

  // Caps (root and tip) — fan from a centroid vertex added at the end.
  const addCap = (j: number, flip: boolean) => {
    const start = ringStart(j);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < loopLen; k++) {
      cx += positions[(start + k) * 3];
      cy += positions[(start + k) * 3 + 1];
      cz += positions[(start + k) * 3 + 2];
    }
    cx /= loopLen;
    cy /= loopLen;
    cz /= loopLen;
    const centerIdx = positions.length / 3;
    positions.push(cx, cy, cz);
    for (let k = 0; k < loopLen; k++) {
      const a = start + k;
      const b = start + ((k + 1) % loopLen);
      if (flip) indices.push(centerIdx, b, a);
      else indices.push(centerIdx, a, b);
    }
  };
  addCap(0, true); // root
  addCap(nRad - 1, false); // tip

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Large, very wide-chord composite fan blade in the spirit of the GE90's 22
 * carbon-fibre blades. The chord is broad (the blades nearly overlap head-on);
 * the sweep is kept moderate so the WIDE tip's trailing edge does not march aft
 * into the fan outlet guide vanes (the chord widens forward — a scimitar lean —
 * rather than reaching further back).
 */
export function createFanBladeGeometry(hubRadius: number, tipRadius: number): THREE.BufferGeometry {
  return createBladeGeometry({
    radiusInner: hubRadius,
    radiusOuter: tipRadius,
    chordRoot: 0.52,
    chordTip: 0.78,
    sweep: 0.34,
    twistRootDeg: 54,
    twistTipDeg: 12,
    thickness: 0.11,
    camber: 0.06,
    segmentsRadial: 20,
    segmentsChord: 16,
  });
}

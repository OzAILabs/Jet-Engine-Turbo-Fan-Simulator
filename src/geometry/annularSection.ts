/**
 * Reusable surfaces of revolution, all oriented along the engine's +X axis and
 * centered on it. These build the casings, drums, ducts and end-caps.
 *
 * Each helper accepts optional `thetaStart` / `thetaLength` so a piece can be
 * rendered as a partial ring for the museum-style cutaway. The angle is
 * measured around the X axis; the convention is chosen so that the cutaway gap
 * opens toward the default isometric camera (upper / +Z side).
 */
import * as THREE from 'three';

/** Default cutaway: remove roughly a 110° wedge from the top-front quadrant. */
export const CUTAWAY = {
  thetaStart: Math.PI * 0.08,
  thetaLength: Math.PI * 2 - Math.PI * 0.61, // ~110° removed
} as const;

const FULL = Math.PI * 2;

/**
 * A cylinder/frustum along X, centered at the local origin.
 * `radiusFront` is the −X end, `radiusBack` is the +X end.
 */
export function createTube(
  radiusFront: number,
  radiusBack: number,
  length: number,
  opts: { thetaStart?: number; thetaLength?: number; openEnded?: boolean; radialSegments?: number } = {},
): THREE.BufferGeometry {
  const { thetaStart = 0, thetaLength = FULL, openEnded = true, radialSegments = 64 } = opts;
  // CylinderGeometry is along +Y with `radiusTop` at +Y. Rotating −90° about Z
  // maps +Y → +X, so radiusTop becomes the +X (back) end.
  const geo = new THREE.CylinderGeometry(
    radiusBack,
    radiusFront,
    length,
    radialSegments,
    1,
    openEnded,
    thetaStart,
    thetaLength,
  );
  geo.rotateZ(-Math.PI / 2);
  return geo;
}

/** A nose cone along X with its tip at −X. */
export function createCone(
  radius: number,
  length: number,
  opts: { thetaStart?: number; thetaLength?: number; radialSegments?: number } = {},
): THREE.BufferGeometry {
  const { thetaStart = 0, thetaLength = FULL, radialSegments = 48 } = opts;
  const geo = new THREE.ConeGeometry(radius, length, radialSegments, 1, false, thetaStart, thetaLength);
  // Cone tip is at +Y; rotate so the tip points −X (forward).
  geo.rotateZ(Math.PI / 2);
  return geo;
}

/** A flat annular ring in the Y–Z plane (normal along X) — used as an end cap. */
export function createRing(
  innerRadius: number,
  outerRadius: number,
  opts: { thetaStart?: number; thetaLength?: number; segments?: number } = {},
): THREE.BufferGeometry {
  const { thetaStart = 0, thetaLength = FULL, segments = 64 } = opts;
  const geo = new THREE.RingGeometry(innerRadius, outerRadius, segments, 1, thetaStart, thetaLength);
  geo.rotateY(Math.PI / 2); // face +X
  return geo;
}

/** A profile-of-revolution (lathe) along X. `profile` is [x, radius] pairs. */
export function createLatheAlongX(
  profile: Array<[number, number]>,
  opts: { thetaStart?: number; thetaLength?: number; segments?: number } = {},
): THREE.BufferGeometry {
  const { thetaStart = 0, thetaLength = FULL, segments = 64 } = opts;
  // LatheGeometry revolves a 2D profile (x = radius, y = axis) around +Y.
  const points = profile.map(([x, r]) => new THREE.Vector2(r, x));
  const geo = new THREE.LatheGeometry(points, segments, thetaStart, thetaLength);
  geo.rotateZ(-Math.PI / 2); // axis +Y → +X
  return geo;
}

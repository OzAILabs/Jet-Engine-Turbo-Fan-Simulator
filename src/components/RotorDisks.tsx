/**
 * RotorDisks — the machined rotor-disk stack + drive cones inside a spinning
 * drum. Shared by Compressor.tsx (booster + HPC) and Turbine.tsx (HPT + LPT);
 * replaces the decorative "DiskRims" tori that were duplicated in both files.
 *
 * What it draws (per drum section, ONE merged geometry = ONE draw call):
 *   - at each rotor station, a machined DISK cross-section revolved about the
 *     engine axis with createLatheAlongX: a heavy BORE ring hugging the owning
 *     shaft (LP 0.13 / HP 0.23 — see ROTOR.boreInner), a thin WEB, and a wide
 *     RIM meeting the drum surface at that station (the caller passes the drum
 *     radius + lip so the rim stands just proud, like the old rims did);
 *   - optional CONE ARMS (drive cones): thin closed conical shells connecting
 *     an end disk's bore down to its shaft, so drum + disks + shaft read as
 *     ONE connected rotating structure.
 *
 * Rotation: this component renders INERT geometry. Parent it inside the
 * existing spinning drum group (the one whose rotation.x is written from the
 * live spool angle in useFrame) — it adds NO useFrame loop of its own.
 *
 * View modes: deliberately none here. The disks are internal rotating
 * machinery, exactly like the drums they ride: EngineModel3D shifts the whole
 * module along X in 'exploded', and the museum cutaway only cuts CASING
 * shells, so the full-360° disks render in all four modes — the same policy
 * the drums and blade rows already follow.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROTOR } from '../data/engineLayout';
import { createLatheAlongX } from '../geometry/annularSection';

/** Proportions of the machined disk profile (defaults = core disks, ROTOR). */
export interface DiskProportions {
  /** Radial depth of the heavy bore ring [m]. */
  boreRadial: number;
  /** Axial HALF-thickness of the bore ring [m]. */
  boreHalf: number;
  /** Axial HALF-thickness of the thin web [m]. */
  webHalf: number;
  /** Axial HALF-thickness of the wide rim [m]. */
  rimHalf: number;
  /** How far the rim reaches down below its outer radius [m]. */
  rimDepth: number;
}

/** A drive cone from one disk's bore down to its shaft. */
export interface ConeArmSpec {
  /** Axial station of the disk the cone leaves from [m]. */
  diskX: number;
  /** Axial station where the cone lands on the shaft [m]. */
  shaftX: number;
  /** Radius of the shaft it lands on [m] (ROTOR.shaftR.lp / .hp). */
  shaftR: number;
}

/**
 * Ensure a closed lathe outline is wound counter-clockwise in the
 * (radius, axis) plane, so LatheGeometry's normals face OUT of the solid and
 * the front-side drum materials shade correctly (same convention the Spinner
 * ogive and the casings rely on).
 */
function ensureCCW(profile: Array<[number, number]>): Array<[number, number]> {
  let area = 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const [x1, r1] = profile[i];
    const [x2, r2] = profile[i + 1];
    area += r1 * x2 - r2 * x1; // shoelace with (x = radius, y = axis)
  }
  return area >= 0 ? profile : profile.slice().reverse();
}

/**
 * One machined disk at axial station x0: a closed bore/web/rim outline
 * revolved about +X. Exported so Fan.tsx can build its (beefier) fan disk
 * from the same profile family.
 */
export function createDiskGeometry(
  x0: number,
  rimRadius: number,
  boreInner: number,
  p: DiskProportions = ROTOR,
): THREE.BufferGeometry {
  const boreOuter = boreInner + p.boreRadial;
  // Never let the rim underside reach down into the bore ring on small disks.
  const rimInner = Math.max(rimRadius - p.rimDepth, boreOuter + 0.01);
  const profile: Array<[number, number]> = [
    [x0 - p.boreHalf, boreInner], // up the bore front face …
    [x0 - p.boreHalf, boreOuter],
    [x0 - p.webHalf, boreOuter], // … step in to the thin web …
    [x0 - p.webHalf, rimInner],
    [x0 - p.rimHalf, rimInner], // … out under the rim overhang …
    [x0 - p.rimHalf, rimRadius],
    [x0 + p.rimHalf, rimRadius], // … across the rim top (drum surface) …
    [x0 + p.rimHalf, rimInner],
    [x0 + p.webHalf, rimInner], // … and back down the aft side …
    [x0 + p.webHalf, boreOuter],
    [x0 + p.boreHalf, boreOuter],
    [x0 + p.boreHalf, boreInner],
    [x0 - p.boreHalf, boreInner], // close along the bore inner cylinder
  ];
  return createLatheAlongX(ensureCCW(profile), { segments: 64 });
}

/**
 * A drive cone: a thin closed conical shell from a disk's bore ring down to
 * the shaft. The root is tucked 1 cm INSIDE the bore ring so no surface is
 * coplanar with it (no z-fighting); the landing sleeve rides
 * ROTOR.coneLanding above the shaft skin for the same reason.
 */
export function createConeArmGeometry(arm: ConeArmSpec, boreInner: number): THREE.BufferGeometry {
  const rAttach = boreInner + ROTOR.boreRadial - 0.01;
  const rLand = arm.shaftR + ROTOR.coneLanding;
  // Offset the second face AWAY from the disk so the shell thickens into free
  // space (aft for an aft-running cone, forward for a forward-running one).
  const t = ROTOR.coneThickness * Math.sign(arm.shaftX - arm.diskX);
  const profile: Array<[number, number]> = [
    [arm.diskX, rAttach],
    [arm.diskX + t, rAttach],
    [arm.shaftX + t, rLand],
    [arm.shaftX, rLand],
    [arm.diskX, rAttach], // close
  ];
  return createLatheAlongX(ensureCCW(profile), { segments: 64 });
}

export interface RotorDisksProps {
  /** Axial stations of the rotor disks [m] (one disk per rotor row). */
  xs: number[];
  /** Rim outer radius at each station [m] — drum radius + lip, per caller. */
  rimRadii: number[];
  /** Bore inner radius for this spool [m] — ROTOR.boreInner.lp / .hp. */
  boreInner: number;
  /** Optional drive cones tying this drum section to its shaft. */
  coneArms?: ConeArmSpec[];
  /** Shared drum material, so live emissive tweaks reach the disks too. */
  material: THREE.Material;
}

/** Stable default so an omitted prop never invalidates the useMemo below. */
const NO_ARMS: ConeArmSpec[] = [];

export function RotorDisks({
  xs,
  rimRadii,
  boreInner,
  coneArms = NO_ARMS,
  material,
}: RotorDisksProps) {
  // Disks differ per station, so we merge the per-station lathes (plus the
  // cone arms — same material) into ONE geometry: one draw call per section,
  // the same budget as the instanced rim tori this replaces.
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < xs.length; i++) {
      parts.push(createDiskGeometry(xs[i], rimRadii[i], boreInner));
    }
    for (const arm of coneArms) {
      parts.push(createConeArmGeometry(arm, boreInner));
    }
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    return merged;
  }, [xs, rimRadii, boreInner, coneArms]);

  return <mesh geometry={geometry} material={material} castShadow={false} frustumCulled={false} />;
}

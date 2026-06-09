/**
 * Spinner — the fan nose cone: a smoothly tapered near-black OGIVE with the
 * classic white "safety spiral" painted on it.
 *
 * The spiral is a real ground-crew safety cue: when the fan turns, the painted
 * curve smears into a bright ring/strobe so you can see at a glance that the
 * engine is running and the inlet is live. Here the cone AND the spiral are
 * rendered inside the Fan's LP-spool group, so they spin together with N1.
 *
 * Geometry is authored in absolute engine coordinates (tip forward of the fan
 * plane), so it needs no extra positioning at the call site. Self-contained:
 * one <Spinner /> line in Fan.tsx, revertable by deleting this file + that line.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { AXIS, RADII } from '../data/engineLayout';
import { createLatheAlongX } from '../geometry/annularSection';

/** Spinner length [m]; its forward tip and aft base on the engine axis. */
const SPINNER_LENGTH = 0.6;
const TIP_X = AXIS.fanPlane - SPINNER_LENGTH; // forward point
const BASE_R = RADII.fanHub; // 0.35 at the fan plane

/** Ogive fullness: r = BASE_R * t^OGIVE_POW (sharp tip, gently convex flanks). */
const OGIVE_POW = 0.62;
/** Turns the safety spiral sweeps from near the tip out to the base. */
const SPIRAL_TURNS = 1.35;

const ogiveR = (t: number) => BASE_R * Math.pow(THREE.MathUtils.clamp(t, 0, 1), OGIVE_POW);

export function Spinner() {
  // --- Ogive nose cone (surface of revolution) ----------------------------
  const coneGeo = useMemo(() => {
    const profile: Array<[number, number]> = [];
    const N = 32;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      profile.push([TIP_X + t * SPINNER_LENGTH, ogiveR(t)]);
    }
    return createLatheAlongX(profile, { segments: 96 });
  }, []);

  const coneMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#16181c'), // near-black painted spinner
        metalness: 0.35,
        roughness: 0.42,
      }),
    [],
  );

  // --- White safety spiral: a thin tube riding just proud of the surface ---
  const spiralGeo = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const N = 280;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const t = THREE.MathUtils.lerp(0.1, 0.97, s); // from near the tip to the base
      const r = ogiveR(t) + 0.009; // ride a hair above the cone skin
      const x = TIP_X + t * SPINNER_LENGTH;
      const th = SPIRAL_TURNS * Math.PI * 2 * s;
      pts.push(new THREE.Vector3(x, Math.cos(th) * r, Math.sin(th) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    return new THREE.TubeGeometry(curve, 360, 0.012, 10, false);
  }, []);

  const spiralMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#eef0f2'),
        metalness: 0.0,
        roughness: 0.55,
        emissive: new THREE.Color('#242424'), // faint lift so the paint reads on black
        emissiveIntensity: 1.0,
      }),
    [],
  );

  return (
    <group>
      <mesh geometry={coneGeo} material={coneMat} castShadow />
      <mesh geometry={spiralGeo} material={spiralMat} />
    </group>
  );
}

/**
 * CompressorBleedSystems.tsx — the VARIABLE-GEOMETRY hardware that makes the
 * forward HPC case look busy on a real GE90-115B, with live animation:
 *
 *  - VSV (Variable Stator Vane) system: four unison rings wrapping the forward
 *    HPC case (IGV + stages 1–3), each ringed by ~24 small vane lever arms, all
 *    driven by two fueldraulic actuators (clock 4 and 8 ALF) through master
 *    torsion links. The rings twist a few degrees about the engine axis with
 *    operating point: vanes CLOSED (ring twisted) at/below idle, easing open
 *    toward takeoff N2.
 *  - VBV (Variable Bleed Valve) system: ten pivoting bleed doors on the
 *    gooseneck between booster exit and HPC inlet. During start ALL TEN swing
 *    open ~35° and dump booster air into the fan duct (real GE90 behavior),
 *    then modulate closed as N2 climbs through idle. A louvered exit grille
 *    rings the inner bypass wall just outboard of the doors, plus a pneumatic
 *    sense line running aft along the case.
 *
 * Performance: 9 draw calls — merged ring/link mesh, one InstancedMesh each
 * for lever arms / bleed doors / louver slats, merged actuator bodies, merged
 * actuator rods, merged fuel lines, the VBV collar lathe, and the sense line.
 * Door matrices are rebuilt per frame (10 instances — cheap); everything else
 * is static. Live values are read NON-reactively via useSimStore.getState().
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimStore } from '../../store/useSimStore';
import {
  EXTERNALS,
  TUBE_COLORS,
  clockToYZ,
  coreCaseRadiusAt,
  visibleInCutaway,
} from '../../data/engineLayout';
import { CUTAWAY, createLatheAlongX } from '../../geometry/annularSection';

// --- Angular conventions ----------------------------------------------------
/** Instance slot rotation about +X that carries a part at +Y to ALF clock h. */
const phiOfClock = (h: number) => -(h / 12) * Math.PI * 2;
/** Inverse: the ALF clock hour of a slot rotation phi (for cutaway tests). */
const hourOfPhi = (phi: number) => ((((-phi * 12) / (Math.PI * 2)) % 12) + 12) % 12;

// (VSV/VBV schedules now come from the FADEC model — store.actuation — so the
// hardware, the audio, and the gauges always agree. See src/sim/actuation.ts.)

// --- VSV constants ----------------------------------------------------------
const ARMS_PER_RING = 24;
const ARM_COUNT = EXTERNALS.vsvRings.xs.length * ARMS_PER_RING;
/** Ring twist at/below idle [rad] — vanes closed; eases to 0 at takeoff N2. */
const VSV_CLOSED_ANGLE = 0.06;
/** Master torsion link: spans all four rings with a little overhang. */
const LINK_LEN = 0.62;
const LINK_X = (EXTERNALS.vsvRings.xs[0] + EXTERNALS.vsvRings.xs[3]) / 2;

/** Unison-ring radius at axial station x (case radius + standoff). */
const ringRadiusAt = (x: number) => coreCaseRadiusAt(x) + EXTERNALS.vsvRings.rOffset;
const LINK_R = (ringRadiusAt(EXTERNALS.vsvRings.xs[0]) + ringRadiusAt(EXTERNALS.vsvRings.xs[3])) / 2;

// --- VBV constants ----------------------------------------------------------
const MAX_DOOR_OPEN = (35 * Math.PI) / 180;
/** Door length chosen so a fully-open tip reaches exactly EXTERNALS.vbv.rOuter. */
const DOOR_LEN = (EXTERNALS.vbv.rOuter - EXTERNALS.vbv.rInner) / Math.sin(MAX_DOOR_OPEN);
const DOOR_HINGE_X = EXTERNALS.vbv.x - DOOR_LEN / 2; // hinged at the forward edge
const DOOR_HINGE_R = EXTERNALS.vbv.rInner + 0.005; // just proud of the collar
const LOUVER_COUNT = 36;
const LOUVER_R = 0.715; // inner bypass wall, just outboard of the open door tips

// Scratch matrices reused for all per-instance composition (no per-frame GC).
const mSlot = new THREE.Matrix4();
const mLocal = new THREE.Matrix4();

export function CompressorBleedSystems() {
  // Only the view mode changes the render output reactively.
  const viewMode = useSimStore((s) => s.viewMode);

  const ringsGroup = useRef<THREE.Group>(null!);
  const armsRef = useRef<THREE.InstancedMesh>(null!);
  const doorsRef = useRef<THREE.InstancedMesh>(null!);
  const louversRef = useRef<THREE.InstancedMesh>(null!);

  // --- Materials (created once) --------------------------------------------
  const mats = useMemo(
    () => ({
      steel: new THREE.MeshStandardMaterial({ color: '#b8c0cc', metalness: 0.8, roughness: 0.35 }),
      bracket: new THREE.MeshStandardMaterial({ color: '#8a9099', metalness: 0.7, roughness: 0.45 }),
      gold: new THREE.MeshStandardMaterial({ color: '#c9a96a', metalness: 0.9, roughness: 0.3 }),
      caseMetal: new THREE.MeshStandardMaterial({ color: '#aab3bf', metalness: 0.85, roughness: 0.45 }),
      fuel: new THREE.MeshStandardMaterial({ color: TUBE_COLORS.fuel, metalness: 0.4, roughness: 0.5 }),
      pneumatic: new THREE.MeshStandardMaterial({ color: TUBE_COLORS.pneumatic, metalness: 0.4, roughness: 0.5 }),
    }),
    [],
  );

  // --- VSV unison rings + master torsion links (full + cutaway variants) ----
  // All four rings and both links merge into ONE geometry: they rotate together
  // as a single rigid "unison" assembly, so one mesh in one rotating group.
  const ringGeos = useMemo(() => {
    const build = (cut: boolean) => {
      const parts: THREE.BufferGeometry[] = [];
      for (const x of EXTERNALS.vsvRings.xs) {
        const R = ringRadiusAt(x);
        // Torus axis starts on +Z; align the partial arc to the lathe cutaway
        // convention (torus angle a = lathe theta + PI), then swing axis to +X.
        const g = cut
          ? new THREE.TorusGeometry(R, 0.012, 8, 48, CUTAWAY.thetaLength)
          : new THREE.TorusGeometry(R, 0.012, 8, 64);
        if (cut) g.rotateZ(Math.PI + CUTAWAY.thetaStart);
        g.rotateY(Math.PI / 2);
        g.translate(x, 0, 0);
        parts.push(g);
      }
      // Master torsion links tie the rings together at clock 4 and clock 8.
      for (const act of EXTERNALS.vsvActuators) {
        const link = new THREE.BoxGeometry(LINK_LEN, 0.018, 0.03);
        link.rotateX(phiOfClock(act.clock));
        const { y, z } = clockToYZ(act.clock, LINK_R);
        link.translate(LINK_X, y, z);
        parts.push(link);
      }
      return mergeGeometries(parts)!;
    };
    return { full: build(false), cut: build(true) };
  }, []);

  // Tiny vane lever arm: radial box from the case surface up to its ring.
  const armGeo = useMemo(() => new THREE.BoxGeometry(0.014, 0.06, 0.02), []);

  // --- VSV actuators (clock 4 / clock 8): body + mount + clevis, gold rod ---
  const actuatorGeos = useMemo(() => {
    const steel: THREE.BufferGeometry[] = [];
    const gold: THREE.BufferGeometry[] = [];
    for (const act of EXTERNALS.vsvActuators) {
      const rMount = coreCaseRadiusAt(act.x) + 0.065;
      // Local frame: barrel along X, nose tipped slightly inboard so the rod
      // end lands on the torsion-link radius; then rotate to the clock slot.
      const place = (g: THREE.BufferGeometry) => {
        g.rotateZ(0.12);
        g.rotateX(phiOfClock(act.clock));
        const { y, z } = clockToYZ(act.clock, rMount);
        g.translate(act.x + 0.04, y, z);
        return g;
      };
      const body = new THREE.CylinderGeometry(0.032, 0.032, 0.2, 16);
      body.rotateZ(Math.PI / 2); // cylinder +Y → engine +X
      steel.push(place(body));
      const mount = new THREE.BoxGeometry(0.12, 0.05, 0.06); // case foot
      mount.translate(0.02, -0.045, 0);
      steel.push(place(mount));
      const clevis = new THREE.BoxGeometry(0.05, 0.046, 0.04); // grabs the link
      clevis.translate(-0.26, 0, 0);
      steel.push(place(clevis));
      const rod = new THREE.CylinderGeometry(0.011, 0.011, 0.16, 10);
      rod.rotateZ(Math.PI / 2);
      rod.translate(-0.18, 0, 0);
      gold.push(place(rod));
    }
    return { steel: mergeGeometries(steel)!, gold: mergeGeometries(gold)! };
  }, []);

  // --- Fueldraulic supply lines: actuators → AGB/HMU region (~x −0.6, clk 5) -
  const fuelLineGeo = useMemo(() => {
    // Points are [x, clockHour, radial standoff above the case].
    const mk = (pts: Array<[number, number, number]>) => {
      const v = pts.map(([x, h, dr]) => {
        const { y, z } = clockToYZ(h, coreCaseRadiusAt(x) + dr);
        return new THREE.Vector3(x, y, z);
      });
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v), 24, 0.012, 8, false);
    };
    const right = mk([
      [-0.76, 4.0, 0.062], // off the clock-4 actuator aft end
      [-0.7, 4.3, 0.04],
      [-0.65, 4.7, 0.035],
      [-0.6, 5.0, 0.03], // down toward the AGB / fuel-pump stack
    ]);
    const left = mk([
      [-0.76, 8.0, 0.062], // clock-8 actuator wraps under the belly
      [-0.72, 7.2, 0.04],
      [-0.66, 6.2, 0.035],
      [-0.6, 5.4, 0.03],
    ]);
    return mergeGeometries([right, left])!;
  }, []);

  // --- VBV collar: raised bleed band the doors sit on (full + cutaway) ------
  const collarGeos = useMemo(() => {
    const { x } = EXTERNALS.vbv;
    const profile: Array<[number, number]> = [
      [x - 0.165, coreCaseRadiusAt(x - 0.165) + 0.004], // skirts down to the case
      [x - 0.125, 0.617],
      [x + 0.125, 0.617],
      [x + 0.165, coreCaseRadiusAt(x + 0.165) + 0.004],
    ];
    return {
      full: createLatheAlongX(profile, { segments: 80 }),
      cut: createLatheAlongX(profile, { ...CUTAWAY }),
    };
  }, []);

  // --- VBV door: thin wedge plate, hinge line at the local origin (fwd edge) -
  const doorGeo = useMemo(() => {
    const wFwd = 0.135; // half-width at the hinge
    const wAft = 0.152; // half-width at the free (aft) edge — the "wedge"
    const shape = new THREE.Shape();
    shape.moveTo(0, -wFwd);
    shape.lineTo(DOOR_LEN, -wAft);
    shape.lineTo(DOOR_LEN, wAft);
    shape.lineTo(0, wFwd);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
    g.rotateX(Math.PI / 2); // plate into the axial/tangential plane
    g.translate(0, 0.006, 0); // center the thickness on the hinge line
    return g;
  }, []);

  // Louver slat for the bleed-exit grille on the inner bypass wall.
  const louverGeo = useMemo(() => new THREE.BoxGeometry(0.085, 0.01, 0.105), []);

  // --- Static instance layouts (re-run when the cutaway hides clock slots) --
  // Vane lever arms: 24 per ring, radiating case → ring, with a slight crank
  // lean. They live inside the rotating rings group so they move in unison.
  useLayoutEffect(() => {
    const mesh = armsRef.current;
    if (!mesh) return;
    let i = 0;
    EXTERNALS.vsvRings.xs.forEach((x, ringIdx) => {
      const rMid = ringRadiusAt(x) - 0.018;
      for (let j = 0; j < ARMS_PER_RING; j++) {
        const phi = (j / ARMS_PER_RING) * Math.PI * 2 + ringIdx * 0.07;
        if (viewMode === 'cutaway' && !visibleInCutaway(hourOfPhi(phi))) {
          mSlot.makeScale(0, 0, 0); // hidden inside the removed wedge
        } else {
          mSlot.makeRotationX(phi);
          mLocal.makeRotationX(0.3).setPosition(x, rMid, 0); // slight crank lean
          mSlot.multiply(mLocal);
        }
        mesh.setMatrixAt(i++, mSlot);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [viewMode]);

  // Louvered exit grille: a ring of tilted slats just outboard of the doors.
  useLayoutEffect(() => {
    const mesh = louversRef.current;
    if (!mesh) return;
    for (let k = 0; k < LOUVER_COUNT; k++) {
      const phi = (k / LOUVER_COUNT) * Math.PI * 2;
      if (viewMode === 'cutaway' && !visibleInCutaway(hourOfPhi(phi))) {
        mSlot.makeScale(0, 0, 0);
      } else {
        mSlot.makeRotationX(phi);
        mLocal.makeRotationZ(-0.55).setPosition(EXTERNALS.vbv.x, LOUVER_R, 0); // pitched slat
        mSlot.multiply(mLocal);
      }
      mesh.setMatrixAt(k, mSlot);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [viewMode]);

  // --- Live animation (non-reactive store reads, no React re-render) --------
  useFrame(() => {
    const { actuation, viewMode: vm } = useSimStore.getState();

    // VSV position from the FADEC schedule: rings twisted (vanes closed) at/
    // below idle, easing to 0 (vanes open) at takeoff. Subtle but alive.
    if (ringsGroup.current) {
      ringsGroup.current.rotation.x = VSV_CLOSED_ANGLE * (1 - actuation.vsvOpenFrac);
    }

    // VBV position from the FADEC schedule: all 10 doors fully open below idle
    // (start: booster air dumps into the fan duct), closing above idle.
    const doors = doorsRef.current;
    if (!doors) return;
    const openAngle = MAX_DOOR_OPEN * actuation.vbvOpenFrac;
    for (let k = 0; k < EXTERNALS.vbv.doorCount; k++) {
      const phi = ((k + 0.5) / EXTERNALS.vbv.doorCount) * Math.PI * 2;
      if (vm === 'cutaway' && !visibleInCutaway(hourOfPhi(phi))) {
        mSlot.makeScale(0, 0, 0);
      } else {
        mSlot.makeRotationX(phi);
        // Hinge at the forward edge: positive Z-rotation lifts the aft tip out.
        mLocal.makeRotationZ(openAngle).setPosition(DOOR_HINGE_X, DOOR_HINGE_R, 0);
        mSlot.multiply(mLocal);
      }
      doors.setMatrixAt(k, mSlot);
    }
    doors.instanceMatrix.needsUpdate = true;
  });

  // --- Pneumatic start-bleed sense line: VBV collar aft along the case ------
  const senseLineGeo = useMemo(() => {
    const pts: Array<[number, number, number]> = [
      [-1.22, 4.5, 0.055], // taps the VBV collar
      [-1.0, 4.5, 0.035],
      [-0.6, 4.5, 0.03],
      [-0.2, 4.5, 0.03], // ends at the mid-HPC sense port
    ];
    const v = pts.map(([x, h, dr]) => {
      const { y, z } = clockToYZ(h, coreCaseRadiusAt(x) + dr);
      return new THREE.Vector3(x, y, z);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v), 24, 0.012, 8, false);
  }, []);

  // Exploded view separates major modules only — externals disappear.
  if (viewMode === 'exploded') return null;

  const cut = viewMode === 'cutaway';

  return (
    <group>
      {/* VSV unison rings + torsion links + lever arms: one rotating assembly */}
      <group ref={ringsGroup}>
        <mesh geometry={cut ? ringGeos.cut : ringGeos.full} material={mats.steel} castShadow={false} />
        <instancedMesh
          ref={armsRef}
          args={[armGeo, mats.bracket, ARM_COUNT]}
          frustumCulled={false}
          castShadow={false}
        />
      </group>

      {/* Two fueldraulic VSV actuators (bodies/clevises) + polished rods */}
      <mesh geometry={actuatorGeos.steel} material={mats.bracket} castShadow={false} />
      <mesh geometry={actuatorGeos.gold} material={mats.gold} castShadow={false} />

      {/* Fuel-red supply lines down toward the AGB / HMU region */}
      <mesh geometry={fuelLineGeo} material={mats.fuel} castShadow={false} />

      {/* VBV bleed band, 10 animated doors, and the louvered exit grille */}
      <mesh geometry={cut ? collarGeos.cut : collarGeos.full} material={mats.caseMetal} castShadow={false} />
      <instancedMesh
        ref={doorsRef}
        args={[doorGeo, mats.bracket, EXTERNALS.vbv.doorCount]}
        frustumCulled={false}
        castShadow={false}
      />
      <instancedMesh
        ref={louversRef}
        args={[louverGeo, mats.bracket, LOUVER_COUNT]}
        frustumCulled={false}
        castShadow={false}
      />

      {/* Pneumatic (orange) start-bleed sense line running aft along the case */}
      <mesh geometry={senseLineGeo} material={mats.pneumatic} castShadow={false} />
    </group>
  );
}

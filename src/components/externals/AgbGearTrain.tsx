/**
 * AgbGearTrain.tsx — the MOVING half of the accessory drive train. The static
 * castings (AGB box, TGB, starter housing, plumbing) stay in
 * AccessoryGearbox.tsx; everything in this component rotates:
 *
 *  - the radial "tower" shaft in the 6:00 fan-frame strut and the horizontal
 *    shaft (TGB → AGB) spin about their own long axes at towerRatio (~0.9x)
 *    and horizontalRatio (~0.8x) of N2. Each is a cylinder plus spline ridges
 *    and coupling collars so the rotation actually reads on screen. Transform
 *    order: an OUTER group carries the static orientation (clock swing /
 *    tilt), an INNER group spins about the shaft's LOCAL long axis.
 *  - six meshing spur gears sit in a shallow inspection pocket recessed into
 *    the AGB's +Z (engine-left, default-camera-side) flank. The pocket walls
 *    are part of the AccessoryGearbox housing; the dark back plate is here.
 *    Adjacent gears counter-rotate; each rate is
 *    hpAngle · horizontalRatio · (baseGearRadius / r) so pitch-line speeds
 *    match at every mesh point and the constant-pitch teeth stay in mesh.
 *  - each of the 5 accessory pads gets an exposed shaft stub + lugged drive
 *    coupling on its outboard face, spinning at its gear's rate — ONE
 *    InstancedMesh, 5 matrices rebuilt per frame (the VBV doors in
 *    CompressorBleedSystems rebuild 10/frame — the accepted budget).
 *  - the air-turbine starter's turbine wheel shows through the theta slot cut
 *    in the starter housing (see AccessoryGearbox); it spins at starterRatio
 *    (~3x) of N2 ONLY while startSeq.starterEngaged, frozen otherwise.
 *
 * Performance: 12 draw calls — tower shaft, horizontal shaft, collar pair,
 * six single-mesh gears, the stub InstancedMesh, the ATS wheel, and one dark
 * merged mesh (pocket back plate + starter slot liner). Live values are read
 * NON-reactively via useSimStore.getState(); only viewMode subscribes.
 * Everything hangs near 6:00 ALF, which the museum cutaway wedge retains.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimStore } from '../../store/useSimStore';
import {
  EXTERNALS,
  SPOOL_SPIN_SIGN,
  clockToYZ,
  coreCaseRadiusAt,
  visibleInCutaway,
} from '../../data/engineLayout';
import { PADS, padCenterY } from './AccessoryGearbox';

// --- Derived placement constants (all from EXTERNALS) ----------------------
const AGB = EXTERNALS.agb;
const GT = EXTERNALS.agbGearTrain;
const AGB_MID_X = (AGB.xStart + AGB.xEnd) / 2;
const AGB_Y = clockToYZ(AGB.clock, coreCaseRadiusAt(AGB_MID_X) + AGB.standoff).y;

/** ALF clock hour → angle around +X; positive with rotateX(-phi)/rotation-x. */
const clockPhi = (hour: number) => (hour / 12) * Math.PI * 2;

// Tower (radial) shaft: runs down the 6:00 strut from rInner to rOuter.
const RS = EXTERNALS.radialShaft;
const TOWER_LEN = RS.rOuter - RS.rInner;
const TOWER_MID = clockToYZ(RS.clock, (RS.rInner + RS.rOuter) / 2);

// Horizontal shaft TGB → AGB forward face (same math AccessoryGearbox used
// before the shaft moved here, so it lands in exactly the same place).
const HS = EXTERNALS.horizontalShaft;
const TGB_POS = clockToYZ(EXTERNALS.tgb.clock, EXTERNALS.tgb.r);
const HS_DY = AGB_Y - TGB_POS.y; // the AGB rides a touch higher than the TGB
const HS_LEN = Math.hypot(HS.xEnd - HS.xStart, HS_DY);
const HS_TILT = Math.atan2(HS_DY, HS.xEnd - HS.xStart);
const HS_MID: [number, number] = [(HS.xStart + HS.xEnd) / 2, (TGB_POS.y + AGB_Y) / 2];

// Gear row: pitch circles tangent (center gap = r_i + r_{i+1}), row centered
// on the AGB midpoint, all centers on the y = AGB_Y line inside the window.
const GEAR_XS: number[] = (() => {
  const r = GT.gearRadii;
  const spans: number[] = [0];
  for (let i = 1; i < r.length; i++) spans.push(spans[i - 1] + r[i - 1] + r[i]);
  const extent = spans[spans.length - 1] + r[0] + r[r.length - 1];
  const first = AGB_MID_X - extent / 2 + r[0];
  return spans.map((s) => first + s);
})();
/** Gear axial (z) center: just proud of the pocket back plate, teeth and hub
 *  hardware all INSIDE the flank face plane (z = AGB.width / 2) — recessed. */
const GEAR_Z = AGB.width / 2 - GT.faceRecess + 0.012 + GT.gearThickness / 2;

/** Adjacent gears counter-rotate. */
const gearSign = (i: number) => (i % 2 === 0 ? 1 : -1);
/** Rotation multiplier on hpAngle: driven off the horizontal shaft, geared by
 *  pitch radius. ω·r is identical for every gear → surfaces mesh cleanly. */
const gearRate = (i: number) =>
  GT.horizontalRatio * (GT.baseGearRadius / GT.gearRadii[i]) * gearSign(i);

// Pad → gear coupling (nearest gear by world x; the leftover gear is the
// input idler). PADS order: IDG, backup gen, lube unit, hyd pump, PMA.
const PAD_GEAR = [5, 0, 2, 3, 1] as const;
/** Stub instance y: coupling flange just below each pad's outboard face. */
const STUB_Y = PADS.map((p) => padCenterY(p.len) - p.len / 2 - 0.01);

// Air-turbine starter: wheel centered in the slotted housing (see the
// starterSlot theta gap AccessoryGearbox cuts in the housing cylinder).
const ST = EXTERNALS.starter;
const ST_POS = clockToYZ(ST.clock, coreCaseRadiusAt(ST.x) + ST.standoff);
const ST_BODY_X = ST.x + 0.07; // starter housing center (matches AccessoryGearbox)

/** One spur gear as ONE merged geometry: root disc + constant-arc-pitch tooth
 *  boxes + hub + hex collar, axis along +Z, centered at the origin. */
function buildGear(i: number): THREE.BufferGeometry {
  const r = GT.gearRadii[i];
  const t = GT.gearThickness;
  const root = r - GT.toothDepth / 2;
  // Same tooth module on every gear (n ∝ r) so meshes line up; phases put a
  // TOOTH at the +X contact point on even gears and a GAP there on odd ones.
  const n = Math.max(10, Math.round((Math.PI * 2 * r) / GT.toothPitch));
  const phase = i % 2 === 0 ? -Math.PI / 2 : Math.PI / 2 + Math.PI / n;

  const parts: THREE.BufferGeometry[] = [];
  const disc = new THREE.CylinderGeometry(root, root, t, 32);
  disc.rotateX(Math.PI / 2); // axis → +Z (the pocket's face normal)
  parts.push(disc);
  const hub = new THREE.CylinderGeometry(0.016, 0.016, t + 0.02, 12);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  const collar = new THREE.CylinderGeometry(0.019, 0.019, 0.01, 6); // hex retainer
  collar.rotateX(Math.PI / 2);
  collar.translate(0, 0, t / 2 + 0.005);
  parts.push(collar);
  for (let k = 0; k < n; k++) {
    // Tooth tips reach r + ~toothDepth/2, so adjacent teeth interleave by one
    // tooth depth at the tangent pitch circles — the faked-involute look.
    const tooth = new THREE.BoxGeometry(0.014, GT.toothDepth + 0.002, t);
    tooth.translate(0, root + (GT.toothDepth + 0.002) / 2 - 0.001, 0);
    tooth.rotateZ(phase + (k / n) * Math.PI * 2);
    parts.push(tooth);
  }
  return mergeGeometries(parts)!;
}

// Module-level scratch for the per-frame stub matrices (no per-frame GC).
const mStub = new THREE.Matrix4();

export function AgbGearTrain() {
  // Only the view mode changes the render output reactively.
  const viewMode = useSimStore((s) => s.viewMode);

  const towerRef = useRef<THREE.Group>(null);
  const horizRef = useRef<THREE.Group>(null);
  const gearRefs = useRef<Array<THREE.Group | null>>([]);
  const stubsRef = useRef<THREE.InstancedMesh>(null);
  const wheelRef = useRef<THREE.Group>(null);

  // --- Geometry (built once; merged per material) ---------------------------
  const G = useMemo(() => {
    // Tower shaft: built along its LOCAL +Y (the spin axis), centered at the
    // origin — the outer group swings it to the 6:00 strut. Spline ridges and
    // end collars are merged in so the spin is visible on a thin cylinder.
    const towerParts: THREE.BufferGeometry[] = [
      new THREE.CylinderGeometry(0.024, 0.024, TOWER_LEN, 12),
    ];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const ridge = new THREE.BoxGeometry(0.008, TOWER_LEN * 0.85, 0.008);
      ridge.translate(Math.cos(a) * 0.026, 0, Math.sin(a) * 0.026);
      towerParts.push(ridge);
    }
    for (const s of [-1, 1]) {
      const end = new THREE.CylinderGeometry(0.032, 0.032, 0.02, 12);
      end.translate(0, s * (TOWER_LEN / 2 - 0.015), 0);
      towerParts.push(end);
    }

    // Horizontal shaft: built along its LOCAL +X, centered at the origin —
    // the outer group applies the TGB→AGB tilt and placement.
    const horizCyl = new THREE.CylinderGeometry(0.034, 0.034, HS_LEN, 12);
    horizCyl.rotateZ(-Math.PI / 2); // axis → +X
    const horizParts: THREE.BufferGeometry[] = [horizCyl];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      const ridge = new THREE.BoxGeometry(HS_LEN * 0.8, 0.008, 0.008);
      ridge.translate(0, Math.cos(a) * 0.036, Math.sin(a) * 0.036);
      horizParts.push(ridge);
    }

    // Coupling collars (were static brass in AccessoryGearbox — now they spin
    // with the shaft). Bolt lugs at ±y make the rotation read.
    const collarParts: THREE.BufferGeometry[] = [];
    for (const off of [-HS_LEN / 2 + 0.07, HS_LEN / 2 - 0.07]) {
      const collar = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 16);
      collar.rotateZ(-Math.PI / 2);
      collar.translate(off, 0, 0);
      collarParts.push(collar);
      for (const s of [-1, 1]) {
        const lug = new THREE.BoxGeometry(0.052, 0.016, 0.016);
        lug.translate(off, s * 0.058, 0);
        collarParts.push(lug);
      }
    }

    // Pad shaft stub + drive coupling: unit assembly along LOCAL +Y (the pad
    // axis), flange at the origin — one InstancedMesh, five instances.
    const stubParts: THREE.BufferGeometry[] = [
      new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), // coupling flange
    ];
    const stubShaft = new THREE.CylinderGeometry(0.014, 0.014, 0.06, 10);
    stubShaft.translate(0, 0.03, 0); // pokes up into the pad face
    stubParts.push(stubShaft);
    const stubNut = new THREE.CylinderGeometry(0.018, 0.018, 0.014, 6);
    stubNut.translate(0, -0.016, 0);
    stubParts.push(stubNut);
    for (const s of [-1, 1]) {
      const lug = new THREE.BoxGeometry(0.018, 0.018, 0.016); // drive lugs
      lug.translate(s * 0.036, 0, 0);
      stubParts.push(lug);
    }

    // ATS turbine wheel: hub disc + pitched blades, axis along +X, centered
    // at the origin — placed at the housing slot by its group.
    const sw = GT.starterWheel;
    const hub = new THREE.CylinderGeometry(sw.hubRadius, sw.hubRadius, 0.035, 20);
    hub.rotateZ(Math.PI / 2); // axis → X
    const wheelParts: THREE.BufferGeometry[] = [hub];
    const bladeLen = sw.tipRadius - sw.hubRadius + 0.004;
    for (let k = 0; k < sw.blades; k++) {
      const blade = new THREE.BoxGeometry(0.028, bladeLen, 0.009);
      blade.rotateY(0.6); // pre-pitch about the radial axis — turbine, not disc
      blade.translate(0, sw.hubRadius + bladeLen / 2 - 0.004, 0);
      blade.rotateX((k / sw.blades) * Math.PI * 2);
      wheelParts.push(blade);
    }

    // Dark statics: the inspection-pocket back plate + a DoubleSide liner
    // inside the starter housing (same theta gap as the housing slot, so the
    // wheel reads against a dark interior instead of a see-through hole).
    const winW = GT.window.x1 - GT.window.x0;
    const plate = new THREE.BoxGeometry(winW + 0.01, GT.window.height + 0.01, 0.008);
    plate.translate(
      (GT.window.x0 + GT.window.x1) / 2,
      AGB_Y,
      AGB.width / 2 - GT.faceRecess + 0.004,
    );
    const liner = new THREE.CylinderGeometry(
      0.128, 0.128, 0.26, 28, 1, true,
      GT.starterSlot.thetaStart, GT.starterSlot.thetaLength,
    );
    liner.rotateZ(-Math.PI / 2); // same orientation as the housing cylinder
    liner.translate(ST_BODY_X, ST_POS.y, ST_POS.z);

    return {
      tower: mergeGeometries(towerParts)!,
      horiz: mergeGeometries(horizParts)!,
      collars: mergeGeometries(collarParts)!,
      gears: GT.gearRadii.map((_, i) => buildGear(i)),
      stub: mergeGeometries(stubParts)!,
      wheel: mergeGeometries(wheelParts)!,
      dark: mergeGeometries([plate, liner])!,
    };
  }, []);

  // --- Materials (one per draw-call group) ----------------------------------
  const M = useMemo(
    () => ({
      steel: new THREE.MeshStandardMaterial({ color: '#cdd3d9', metalness: 0.95, roughness: 0.25 }),
      gear: new THREE.MeshStandardMaterial({ color: '#9aa2ac', metalness: 0.85, roughness: 0.3 }),
      brass: new THREE.MeshStandardMaterial({ color: '#c9a96a', metalness: 0.9, roughness: 0.35 }),
      // DoubleSide so the slot liner's far interior wall shows through the gap.
      dark: new THREE.MeshStandardMaterial({
        color: '#23262b', metalness: 0.3, roughness: 0.8, side: THREE.DoubleSide,
      }),
    }),
    [],
  );

  // Initial stub layout (before the first animation frame); viewMode is a dep
  // because the mesh unmounts entirely in exploded view and remounts after.
  useLayoutEffect(() => {
    const mesh = stubsRef.current;
    if (!mesh) return;
    PADS.forEach((p, i) => {
      mStub.identity().setPosition(p.x, STUB_Y[i], p.z);
      mesh.setMatrixAt(i, mStub);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [viewMode]);

  // --- Live animation (non-reactive store reads, null-guarded refs) ---------
  useFrame(() => {
    const { spool, startSeq } = useSimStore.getState();
    const hp = SPOOL_SPIN_SIGN * spool.hpAngle;

    // Driveshafts spin about their own long axes INSIDE the oriented groups.
    if (towerRef.current) towerRef.current.rotation.y = hp * GT.towerRatio;
    if (horizRef.current) horizRef.current.rotation.x = hp * GT.horizontalRatio;

    // Gear train: adjacent gears counter-rotate at radius-matched rates.
    for (let i = 0; i < GEAR_XS.length; i++) {
      const g = gearRefs.current[i];
      if (g) g.rotation.z = hp * gearRate(i);
    }

    // Pad couplings: 5 instance matrices per frame (VBV-door precedent is 10).
    const stubs = stubsRef.current;
    if (stubs) {
      for (let i = 0; i < PADS.length; i++) {
        const p = PADS[i];
        mStub.makeRotationY(hp * gearRate(PAD_GEAR[i])).setPosition(p.x, STUB_Y[i], p.z);
        stubs.setMatrixAt(i, mStub);
      }
      stubs.instanceMatrix.needsUpdate = true;
    }

    // ATS wheel: fast crank while the starter is engaged; otherwise we stop
    // writing and it freezes at its last angle (re-engage jumps are invisible
    // on a bladed wheel with identical blades).
    if (wheelRef.current && startSeq.starterEngaged) {
      wheelRef.current.rotation.x = hp * GT.starterRatio;
    }
  });

  // Exploded view separates major modules only — externals disappear.
  if (viewMode === 'exploded') return null;

  // Whole assembly hangs near 6:00 ALF, which the museum wedge retains — but
  // guard anyway so a future wedge change can't strand floating gears.
  if (viewMode === 'cutaway' && !visibleInCutaway(AGB.clock)) return null;

  return (
    <group>
      {/* Tower shaft: outer group swings local +Y to the 6:00 strut (verified
          against clockToYZ — rotateX(-phi) maps +Y to the clock direction),
          inner group spins about the shaft's LOCAL +Y. */}
      <group
        position={[RS.x, TOWER_MID.y, TOWER_MID.z]}
        rotation-x={-clockPhi(RS.clock)}
      >
        <group ref={towerRef}>
          <mesh geometry={G.tower} material={M.steel} castShadow={false} />
        </group>
      </group>

      {/* Horizontal shaft: outer group applies the TGB→AGB tilt, inner group
          spins about the shaft's LOCAL +X. Collars ride along. */}
      <group position={[HS_MID[0], HS_MID[1], 0]} rotation-z={HS_TILT}>
        <group ref={horizRef}>
          <mesh geometry={G.horiz} material={M.steel} castShadow={false} />
          <mesh geometry={G.collars} material={M.brass} castShadow={false} />
        </group>
      </group>

      {/* Inspection-pocket back plate + starter slot liner (one dark mesh). */}
      <mesh geometry={G.dark} material={M.dark} castShadow={false} />

      {/* Six meshing spur gears — one group + one merged mesh each. */}
      {GEAR_XS.map((x, i) => (
        <group
          key={i}
          position={[x, AGB_Y, GEAR_Z]}
          ref={(el) => {
            gearRefs.current[i] = el;
          }}
        >
          <mesh geometry={G.gears[i]} material={M.gear} castShadow={false} />
        </group>
      ))}

      {/* Accessory-pad shaft stubs + drive couplings (one InstancedMesh). */}
      <instancedMesh
        ref={stubsRef}
        args={[G.stub, M.brass, PADS.length]}
        frustumCulled={false}
        castShadow={false}
      />

      {/* ATS turbine wheel, visible through the housing's theta slot. */}
      <group ref={wheelRef} position={[GT.starterWheel.x, ST_POS.y, ST_POS.z]}>
        <mesh geometry={G.wheel} material={M.steel} castShadow={false} />
      </group>
    </group>
  );
}

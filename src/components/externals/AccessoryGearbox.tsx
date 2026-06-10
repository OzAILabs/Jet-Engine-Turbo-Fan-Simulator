/**
 * AccessoryGearbox.tsx — the GE90 accessory drive train, hung under the core
 * at 6:00 (ALF). Power is tapped off the HP spool by an internal gearbox,
 * carried down the 6:00 fan-frame strut by a RADIAL driveshaft to the
 * TRANSFER gearbox, then aft along a HORIZONTAL driveshaft to the ACCESSORY
 * gearbox (AGB) — a finned cast box whose pads drive the IDG, backup
 * generator, hydraulic pump, lube unit and fuel pump, and whose aft face
 * carries the air-turbine starter (V-band clamped, fed by the starter air
 * valve). The oil tank rides separately on the fan case at ~8:30.
 *
 * Geography comes straight from EXTERNALS in engineLayout; fluid lines are
 * tinted per MIL-STD-1247 (TUBE_COLORS). Everything except the oil tank sits
 * near 6:00, which the museum cutaway wedge retains — only the tank (clock
 * 8.6 fails visibleInCutaway) hides in cutaway mode.
 *
 * Performance: all housings merge into ONE mesh per material via
 * mergeGeometries; the accessory pads are ONE InstancedMesh; each fluid line
 * is ONE TubeGeometry. Total: 10 draw calls.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
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

// --- Derived placement constants (all from EXTERNALS) ----------------------
const AGB = EXTERNALS.agb;
const AGB_MID_X = (AGB.xStart + AGB.xEnd) / 2;
const AGB_LEN = AGB.xEnd - AGB.xStart;
/** AGB box center sits `standoff` below the local core-case underside. */
const AGB_Y = clockToYZ(AGB.clock, coreCaseRadiusAt(AGB_MID_X) + AGB.standoff).y;

/** ALF clock hour → angle around +X (matches clockToYZ's convention). */
const clockPhi = (hour: number) => (hour / 12) * Math.PI * 2;

/** Scene-space point at axial x, ALF clock hour, radius r. */
const pt = (x: number, hour: number, r: number): THREE.Vector3 => {
  const { y, z } = clockToYZ(hour, r);
  return new THREE.Vector3(x, y, z);
};

// --- Accessory pads on the AGB belly (world x; +z = engine LEFT, ALF 9:00) -
// One unit cylinder instanced + scaled per pad; biggest = IDG, left-aft.
const PADS = [
  { label: 'IDG', x: -0.18, z: 0.16, r: 0.155, len: 0.22 },
  { label: 'backup generator', x: -0.86, z: 0.16, r: 0.105, len: 0.16 },
  { label: 'lube & scavenge unit', x: -0.5, z: 0.18, r: 0.1, len: 0.16 },
  { label: 'hydraulic pump', x: -0.6, z: -0.17, r: 0.09, len: 0.15 },
  { label: 'PMA alternator', x: -0.95, z: -0.15, r: 0.07, len: 0.12 },
] as const;

/** Pad center height: hang from the box underside with a little embed. */
const padCenterY = (len: number) => AGB_Y - AGB.height / 2 + 0.03 - len / 2;

const dummy = new THREE.Object3D();

export function AccessoryGearbox() {
  const viewMode = useSimStore((s) => s.viewMode);
  const padsRef = useRef<THREE.InstancedMesh>(null);

  // --- Geometry (built once; grouped by material, then merged) --------------
  const G = useMemo(() => {
    const housing: THREE.BufferGeometry[] = []; // case-gray castings
    const dark: THREE.BufferGeometry[] = []; // dark control boxes
    const brass: THREE.BufferGeometry[] = []; // clamps & couplings
    const shafts: THREE.BufferGeometry[] = []; // bright steel shafts

    // AGB main case: rectangular casting with a rounded sump belly.
    const box = new THREE.BoxGeometry(AGB_LEN, AGB.height, AGB.width);
    box.translate(AGB_MID_X, AGB_Y, 0);
    housing.push(box);
    const sump = new THREE.CylinderGeometry(0.2, 0.2, AGB_LEN * 0.9, 28);
    sump.rotateZ(Math.PI / 2); // axis → +X
    sump.translate(AGB_MID_X, AGB_Y - 0.1, 0);
    housing.push(sump);

    // Stiffening ribs: thin fins proud of the casting every ~0.2 m.
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.BoxGeometry(0.022, AGB.height + 0.05, AGB.width + 0.05);
      rib.translate(AGB_MID_X - 0.42 + i * 0.21, AGB_Y - 0.01, 0);
      housing.push(rib);
    }

    // Transfer gearbox: small box at the bottom of the 6:00 fan-frame strut.
    const tgbPos = clockToYZ(EXTERNALS.tgb.clock, EXTERNALS.tgb.r);
    const tgb = new THREE.BoxGeometry(0.24, 0.2, 0.22);
    tgb.translate(EXTERNALS.tgb.x, tgbPos.y, tgbPos.z);
    housing.push(tgb);

    // Radial driveshaft inside the 6:00 strut (IGB → TGB), thin steel.
    const rs = EXTERNALS.radialShaft;
    const radial = new THREE.CylinderGeometry(0.024, 0.024, rs.rOuter - rs.rInner, 12);
    radial.translate(0, (rs.rInner + rs.rOuter) / 2, 0); // built along radial +Y
    radial.rotateX(-clockPhi(rs.clock)); // swing to the strut's clock
    radial.translate(rs.x, 0, 0);
    shafts.push(radial);

    // Horizontal driveshaft TGB → AGB forward face, with two coupling collars.
    const hs = EXTERNALS.horizontalShaft;
    const dY = AGB_Y - tgbPos.y; // AGB rides a touch higher than the TGB
    const hsLen = Math.hypot(hs.xEnd - hs.xStart, dY);
    const tilt = Math.atan2(dY, hs.xEnd - hs.xStart);
    const hsMid: [number, number] = [(hs.xStart + hs.xEnd) / 2, (tgbPos.y + AGB_Y) / 2];
    const horiz = new THREE.CylinderGeometry(0.034, 0.034, hsLen, 12);
    horiz.rotateZ(-Math.PI / 2); // axis → +X
    horiz.rotateZ(tilt);
    horiz.translate(hsMid[0], hsMid[1], 0);
    shafts.push(horiz);
    for (const off of [-hsLen / 2 + 0.07, hsLen / 2 - 0.07]) {
      const collar = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 16);
      collar.rotateZ(-Math.PI / 2);
      collar.translate(off, 0, 0);
      collar.rotateZ(tilt);
      collar.translate(hsMid[0], hsMid[1], 0);
      brass.push(collar);
    }

    // Air-turbine starter on the AGB aft face: mount adapter, fat body,
    // V-band clamp ring, and the starter air valve block just aft.
    const st = EXTERNALS.starter;
    const stPos = clockToYZ(st.clock, coreCaseRadiusAt(st.x) + st.standoff);
    const adapter = new THREE.CylinderGeometry(0.1, 0.1, 0.09, 20);
    adapter.rotateZ(-Math.PI / 2);
    adapter.translate(AGB.xEnd + 0.04, stPos.y, stPos.z);
    housing.push(adapter);
    const starterBody = new THREE.CylinderGeometry(0.135, 0.135, 0.28, 28);
    starterBody.rotateZ(-Math.PI / 2);
    starterBody.translate(st.x + 0.07, stPos.y, stPos.z);
    housing.push(starterBody);
    const vband = new THREE.TorusGeometry(0.142, 0.02, 8, 36);
    vband.rotateY(Math.PI / 2); // ring plane ⟂ engine axis
    vband.translate(AGB.xEnd + 0.06, stPos.y, stPos.z);
    brass.push(vband);
    const valve = new THREE.BoxGeometry(0.12, 0.1, 0.1);
    valve.rotateX(0.45); // canted, like the real angle-bodied SAV
    valve.translate(0.43, stPos.y + 0.02, stPos.z - 0.05);
    dark.push(valve);

    // Fuel pump + HMU stack at ~4:30 on the right flank of the AGB:
    // two stacked cylinders + the dark HMU block, plus a mount bracket.
    const fp = EXTERNALS.fuelPumpHmu;
    const fpPhi = clockPhi(fp.clock);
    const r0 = coreCaseRadiusAt(fp.x) + fp.standoff;
    const bracket = new THREE.BoxGeometry(0.18, 0.08, 0.26);
    bracket.translate(0, r0 - 0.13, 0);
    const pumpMain = new THREE.CylinderGeometry(0.105, 0.105, 0.17, 24);
    pumpMain.translate(0, r0, 0);
    const pumpBoost = new THREE.CylinderGeometry(0.08, 0.08, 0.13, 20);
    pumpBoost.translate(0, r0 + 0.15, 0);
    const hmu = new THREE.BoxGeometry(0.2, 0.13, 0.16);
    hmu.translate(0, r0 + 0.28, 0);
    for (const g of [bracket, pumpMain, pumpBoost]) {
      g.rotateX(-fpPhi); // local +Y → radial at clock 4.5
      g.translate(fp.x, 0, 0);
      housing.push(g);
    }
    hmu.rotateX(-fpPhi);
    hmu.translate(fp.x, 0, 0);
    dark.push(hmu);

    // Metered-fuel supply: ONE red line from the HMU up the right side of the
    // core to the combustor-manifold region (x ≈ 0.18, clock 3).
    const fuelCurve = new THREE.CatmullRomCurve3([
      pt(fp.x, fp.clock, r0 + 0.34),
      pt(-0.38, 4.1, 0.82),
      pt(-0.15, 3.6, 0.68),
      pt(0.05, 3.2, 0.64),
      pt(0.18, 3.0, coreCaseRadiusAt(0.18) + 0.07),
    ]);
    const fuelLine = new THREE.TubeGeometry(fuelCurve, 40, 0.028, 8);

    // Starter air duct: from the starter aft face, aft then up toward the
    // pylon feed, hugging the core case (ends x ≈ 0.8, clock 5.5).
    const ductCurve = new THREE.CatmullRomCurve3([
      pt(st.x + 0.2, st.clock, coreCaseRadiusAt(st.x) + st.standoff),
      pt(0.46, 5.9, 0.71),
      pt(0.62, 5.7, 0.66),
      pt(0.8, 5.5, coreCaseRadiusAt(0.8) + 0.08),
    ]);
    const airDuct = new THREE.TubeGeometry(ductCurve, 28, 0.045, 10);

    // Oil tank: capsule tangent to the fan case at clock 8.6 + filler cap.
    const ot = EXTERNALS.oilTank;
    const otPhi = clockPhi(ot.clock);
    const tank = new THREE.CapsuleGeometry(ot.radius, ot.length - 2 * ot.radius, 6, 20);
    tank.rotateZ(Math.PI / 2); // long axis → X (axial, lying along the case)
    tank.translate(0, ot.r, 0);
    tank.rotateX(-otPhi);
    tank.translate(ot.x, 0, 0);
    const cap = new THREE.CylinderGeometry(0.045, 0.05, 0.06, 16);
    cap.translate(-0.12, ot.r + ot.radius + 0.015, 0); // proud of the outboard face
    cap.rotateX(-otPhi);
    cap.translate(ot.x, 0, 0);

    // Oil supply: ONE yellow line, tank aft end down across the bypass duct
    // to the lube & scavenge unit pad on the AGB.
    const lube = PADS[2];
    const oilCurve = new THREE.CatmullRomCurve3([
      pt(ot.x + ot.length / 2 - 0.05, ot.clock, ot.r - 0.02),
      pt(-2.1, 8.0, 1.25),
      pt(-1.85, 7.3, 0.85),
      pt(-1.45, 6.8, 0.72),
      new THREE.Vector3(lube.x - 0.05, padCenterY(lube.len) + 0.04, lube.z + lube.r + 0.03),
    ]);
    const oilLine = new THREE.TubeGeometry(oilCurve, 48, 0.024, 8);

    return {
      housing: mergeGeometries(housing),
      dark: mergeGeometries(dark),
      brass: mergeGeometries(brass),
      shafts: mergeGeometries(shafts),
      fuelLine,
      airDuct,
      tank,
      cap,
      oilLine,
      pad: new THREE.CylinderGeometry(1, 1, 1, 24), // unit pad, scaled per instance
    };
  }, []);

  // --- Materials (one per merged group; flat aerospace palette) -------------
  const M = useMemo(
    () => ({
      casing: new THREE.MeshStandardMaterial({ color: '#aab3bf', metalness: 0.8, roughness: 0.5 }),
      bracket: new THREE.MeshStandardMaterial({ color: '#8a9099', metalness: 0.7, roughness: 0.55 }),
      dark: new THREE.MeshStandardMaterial({ color: '#3a3f47', metalness: 0.4, roughness: 0.6 }),
      brass: new THREE.MeshStandardMaterial({ color: '#c9a96a', metalness: 0.9, roughness: 0.35 }),
      steel: new THREE.MeshStandardMaterial({ color: '#cdd3d9', metalness: 0.95, roughness: 0.25 }),
      fuel: new THREE.MeshStandardMaterial({ color: TUBE_COLORS.fuel, metalness: 0.6, roughness: 0.45 }),
      oil: new THREE.MeshStandardMaterial({ color: TUBE_COLORS.oil, metalness: 0.6, roughness: 0.45 }),
      pneumatic: new THREE.MeshStandardMaterial({ color: TUBE_COLORS.pneumatic, metalness: 0.6, roughness: 0.45 }),
    }),
    [],
  );

  // Lay out the accessory pads once per (re)mount of the instanced mesh.
  // viewMode is a dep because the mesh unmounts entirely in exploded view.
  useLayoutEffect(() => {
    const mesh = padsRef.current;
    if (!mesh) return;
    PADS.forEach((p, i) => {
      dummy.position.set(p.x, padCenterY(p.len), p.z);
      dummy.rotation.set(0, 0, 0); // axis already points down (cylinder = +Y)
      dummy.scale.set(p.r, p.len, p.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [viewMode]);

  // Exploded view: accessories stay attached to nothing — hide entirely.
  if (viewMode === 'exploded') return null;

  // The 6:00 drive train survives the cutaway wedge; the oil tank does not.
  const showTank = viewMode !== 'cutaway' || visibleInCutaway(EXTERNALS.oilTank.clock);

  return (
    <group>
      {/* Cast housings: AGB + ribs + TGB + starter + fuel-pump stack. */}
      <mesh geometry={G.housing} material={M.casing} castShadow={false} />
      {/* Accessory drive pads (IDG, gen, pumps) — one instanced cylinder. */}
      <instancedMesh
        ref={padsRef}
        args={[G.pad, M.bracket, PADS.length]}
        frustumCulled={false}
        castShadow={false}
      />
      {/* Dark control boxes: HMU + starter air valve. */}
      <mesh geometry={G.dark} material={M.dark} castShadow={false} />
      {/* Brass details: V-band clamp + driveshaft coupling collars. */}
      <mesh geometry={G.brass} material={M.brass} castShadow={false} />
      {/* Radial + horizontal driveshafts. */}
      <mesh geometry={G.shafts} material={M.steel} castShadow={false} />
      {/* Metered fuel to the combustor manifolds (red, MIL-STD-1247). */}
      <mesh geometry={G.fuelLine} material={M.fuel} castShadow={false} />
      {/* Starter air duct (orange). */}
      <mesh geometry={G.airDuct} material={M.pneumatic} castShadow={false} />
      {/* Oil tank + filler cap + supply line — hidden by the cutaway wedge. */}
      {showTank && (
        <group>
          <mesh geometry={G.tank} material={M.casing} castShadow={false} />
          <mesh geometry={G.cap} material={M.brass} castShadow={false} />
          <mesh geometry={G.oilLine} material={M.oil} castShadow={false} />
        </group>
      )}
    </group>
  );
}

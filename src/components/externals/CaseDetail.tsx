/**
 * CaseDetail.tsx — the fastener-level detail that turns the smooth lathe
 * casings into assembled hardware: bolted case flanges with full bolt circles,
 * brass borescope-port bosses (the plugs a mechanic pulls to inspect blades),
 * axial stiffening ribs on the fan-frame and turbine-frame cases, and the
 * drain mast hanging under the fan cowl.
 *
 * Everything is positioned from EXTERNALS in engineLayout.ts and sits on
 * coreCaseRadiusAt(x), so it tracks the CutawayShell profile exactly. In
 * cutaway mode the flanges are rebuilt with the CUTAWAY arc and any instance
 * whose clock position falls inside the removed wedge is skipped.
 *
 * Draw calls: 6 total — merged flanges (1), all bolts (1 InstancedMesh),
 * borescope bosses (1), borescope hex plugs (1), case ribs (1), drain mast (1).
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimStore } from '../../store/useSimStore';
import { CUTAWAY, createLatheAlongX } from '../../geometry/annularSection';
import {
  EXTERNALS,
  RADII,
  clockToYZ,
  coreCaseRadiusAt,
  visibleInCutaway,
} from '../../data/engineLayout';
import { createCastingMaterial, createMachinedMaterial } from '../../materials/hardware';

// --- Flange / bolt proportions (meters) ------------------------------------
const FLANGE_LEN = 0.035; // axial width of the bolted rim
const FLANGE_LIP = 0.022; // how far the rim stands proud of the case skin
const BOLT_RADIUS = 0.018; // hex head across-corners radius
const BOLT_LEN = 0.025;

// --- Borescope boss proportions ---------------------------------------------
const BOSS_RADIUS = 0.035;
const BOSS_HEIGHT = 0.06; // half-buried so ~0.04 stands proud of the skin
const PLUG_RADIUS = 0.02;
const PLUG_HEIGHT = 0.02;

// --- Case ribs ---------------------------------------------------------------
const RIB_CLOCKS = [4, 5, 6, 7, 8]; // lower half only — survives the cutaway
const RIB_H = 0.03;
const RIB_W = 0.045;
const RIB_MARGIN = 0.08; // keep rib ends clear of the flange rims

// Shared scratch objects (BladeRow pattern) — never allocated per frame.
const dummy = new THREE.Object3D();
const qClock = new THREE.Quaternion();
const qSlope = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** All flange rims merged into ONE geometry (optionally as the cutaway arc). */
function buildFlangeGeometry(arc?: { thetaStart: number; thetaLength: number }): THREE.BufferGeometry {
  const parts = EXTERNALS.flanges.map(({ x }) => {
    const rCase = coreCaseRadiusAt(x);
    const rIn = rCase - 0.012; // sink the root into the casing — no seam
    const rOut = rCase + FLANGE_LIP;
    const x0 = x - FLANGE_LEN / 2;
    const x1 = x + FLANGE_LEN / 2;
    // Closed rim: forward annular face, outer band, aft annular face.
    return createLatheAlongX(
      [
        [x0, rIn],
        [x0, rOut],
        [x1, rOut],
        [x1, rIn],
      ],
      { ...arc },
    );
  });
  const merged = mergeGeometries(parts, false) ?? parts[0];
  parts.forEach((g) => g !== merged && g.dispose());
  return merged;
}

export function CaseDetail() {
  const viewMode = useSimStore((s) => s.viewMode);
  const cutaway = viewMode === 'cutaway';

  const boltsRef = useRef<THREE.InstancedMesh>(null!);
  const bossesRef = useRef<THREE.InstancedMesh>(null!);
  const plugsRef = useRef<THREE.InstancedMesh>(null!);
  const ribsRef = useRef<THREE.InstancedMesh>(null!);

  // --- Geometries (built once) ----------------------------------------------
  const flangeFullGeo = useMemo(() => buildFlangeGeometry(), []);
  const flangeCutGeo = useMemo(() => buildFlangeGeometry(CUTAWAY), []);

  // Hex bolt along +X (CylinderGeometry's 6 radial segments = the hex head).
  const boltGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(BOLT_RADIUS, BOLT_RADIUS, BOLT_LEN, 6);
    g.rotateZ(-Math.PI / 2); // +Y → +X, matching the engine axis
    return g;
  }, []);

  // Borescope boss (round) + hex plug cap, both along +Y → oriented radially per instance.
  const bossGeo = useMemo(() => new THREE.CylinderGeometry(BOSS_RADIUS, BOSS_RADIUS, BOSS_HEIGHT, 16), []);
  const plugGeo = useMemo(() => new THREE.CylinderGeometry(PLUG_RADIUS, PLUG_RADIUS, PLUG_HEIGHT, 6), []);

  // Unit-length rib box; each instance is scaled along X to its span.
  const ribGeo = useMemo(() => new THREE.BoxGeometry(1, RIB_H, RIB_W), []);

  // Drain mast: a thin elliptical strut (scaled cylinder = streamlined section).
  const mastGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.09, 0.075, 0.3, 24); // chord tapers toward the tip
    g.scale(1, 1, 0.22); // squash laterally → airfoil-ish cross-section
    return g;
  }, []);

  // --- Materials -------------------------------------------------------------
  const flangeMat = useMemo(
    // Flanges are turned rings and bolt heads are formed/ground — machined
    // relief. The drain mast and brackets are castings. Palette unchanged.
    () =>
      createMachinedMaterial({
        color: '#9aa3ae',
        metalness: 0.85,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const boltMat = useMemo(
    () => createMachinedMaterial({ color: '#5b6168', metalness: 0.7, roughness: 0.5 }),
    [],
  );
  const brassMat = useMemo(
    () => createMachinedMaterial({ color: '#c9a96a', metalness: 0.8, roughness: 0.35 }),
    [],
  );
  const bracketMat = useMemo(
    () => createCastingMaterial({ color: '#8a9099', metalness: 0.75, roughness: 0.45 }),
    [],
  );

  const maxBolts = useMemo(() => EXTERNALS.flanges.reduce((n, f) => n + f.boltCount, 0), []);
  const maxPorts = EXTERNALS.borescopePorts.length;
  const maxRibs = RIB_CLOCKS.length * 2; // two ribbed frame regions

  // --- Bolt circles: every flange's bolts in ONE InstancedMesh ---------------
  // Heads sit on the forward flange face, centers just proud of the rim OD so
  // the hex silhouettes read against the case.
  useLayoutEffect(() => {
    const mesh = boltsRef.current;
    if (!mesh) return; // unmounted (exploded view) — refs are null
    let i = 0;
    dummy.scale.set(1, 1, 1);
    for (const { x, boltCount } of EXTERNALS.flanges) {
      const rBolt = coreCaseRadiusAt(x) + FLANGE_LIP - 0.004;
      for (let k = 0; k < boltCount; k++) {
        const hour = (k / boltCount) * 12;
        if (cutaway && !visibleInCutaway(hour)) continue; // wedge removed it
        const { y, z } = clockToYZ(hour, rBolt);
        dummy.position.set(x - FLANGE_LEN / 2, y, z);
        dummy.rotation.set(-(hour / 12) * Math.PI * 2, 0, 0); // align hex flats radially
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }, [cutaway]);

  // --- Borescope ports: boss + hex plug, standing radially proud of the case -
  useLayoutEffect(() => {
    const bosses = bossesRef.current;
    const plugs = plugsRef.current;
    if (!bosses || !plugs) return; // unmounted (exploded view)
    let i = 0;
    dummy.scale.set(1, 1, 1);
    for (const { x, clock } of EXTERNALS.borescopePorts) {
      if (cutaway && !visibleInCutaway(clock)) continue;
      const rCase = coreCaseRadiusAt(x);
      const phi = (clock / 12) * Math.PI * 2;
      dummy.rotation.set(-phi, 0, 0); // local +Y → radial direction at this clock

      // Boss: half-buried in the skin so it meets the conical case cleanly.
      const boss = clockToYZ(clock, rCase + BOSS_HEIGHT / 2 - 0.02);
      dummy.position.set(x, boss.y, boss.z);
      dummy.updateMatrix();
      bosses.setMatrixAt(i, dummy.matrix);

      // Hex plug cap sits on the boss face.
      const plug = clockToYZ(clock, rCase + BOSS_HEIGHT - 0.02 + PLUG_HEIGHT / 2);
      dummy.position.set(x, plug.y, plug.z);
      dummy.updateMatrix();
      plugs.setMatrixAt(i, dummy.matrix);
      i++;
    }
    bosses.count = i;
    plugs.count = i;
    bosses.instanceMatrix.needsUpdate = true;
    plugs.instanceMatrix.needsUpdate = true;
  }, [cutaway]);

  // --- Axial stiffening ribs: fan-frame and turbine-frame case bays ----------
  // Each rib follows the local cone slope (both bays are single linear segments
  // of the coreCaseRadiusAt profile, so a pitched straight box lies flush).
  useLayoutEffect(() => {
    const mesh = ribsRef.current;
    if (!mesh) return; // unmounted (exploded view)
    const fx = EXTERNALS.flanges.map((f) => f.x);
    const bays = [
      { x0: fx[0] + RIB_MARGIN, x1: fx[1] - RIB_MARGIN }, // fan frame / LPC case
      { x0: fx[fx.length - 2] + RIB_MARGIN, x1: fx[fx.length - 1] - RIB_MARGIN }, // LPT case
    ];
    let i = 0;
    for (const { x0, x1 } of bays) {
      const len = x1 - x0;
      const xMid = (x0 + x1) / 2;
      const r0 = coreCaseRadiusAt(x0);
      const r1 = coreCaseRadiusAt(x1);
      const rMid = (r0 + r1) / 2 + RIB_H / 2 - 0.008; // half-buried in the skin
      qSlope.setFromAxisAngle(Z_AXIS, Math.atan2(r1 - r0, len)); // pitch onto the cone
      for (const hour of RIB_CLOCKS) {
        if (cutaway && !visibleInCutaway(hour)) continue;
        qClock.setFromAxisAngle(X_AXIS, -(hour / 12) * Math.PI * 2); // +Y → radial
        const { y, z } = clockToYZ(hour, rMid);
        dummy.position.set(xMid, y, z);
        dummy.quaternion.copy(qClock).multiply(qSlope);
        dummy.scale.set(len, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
  }, [cutaway]);

  // Hidden in exploded view, like the casings these details belong to.
  if (viewMode === 'exploded') return null;

  return (
    <group>
      {/* Bolted case flanges — match the cut casings' retained arc in cutaway. */}
      <mesh geometry={cutaway ? flangeCutGeo : flangeFullGeo} material={flangeMat} />

      {/* One bolt circle InstancedMesh for ALL flanges. */}
      <instancedMesh
        ref={boltsRef}
        args={[boltGeo, boltMat, maxBolts]}
        castShadow={false}
        frustumCulled={false}
      />

      {/* Borescope bosses + hex plugs — brass, so students can spot the ports. */}
      <instancedMesh
        ref={bossesRef}
        args={[bossGeo, brassMat, maxPorts]}
        castShadow={false}
        frustumCulled={false}
      />
      <instancedMesh
        ref={plugsRef}
        args={[plugGeo, brassMat, maxPorts]}
        castShadow={false}
        frustumCulled={false}
      />

      {/* Axial case ribs on the fan-frame and turbine-frame bays (lower half). */}
      <instancedMesh
        ref={ribsRef}
        args={[ribGeo, bracketMat, maxRibs]}
        castShadow={false}
        frustumCulled={false}
      />

      {/* Drain mast under the fan cowl at 6:00 — raked aft like the real one. */}
      <mesh
        geometry={mastGeo}
        material={bracketMat}
        position={[-2.55, -(RADII.nacelleOuter + 0.1), 0]}
        rotation={[0, 0, 0.2]}
        castShadow={false}
      />
    </group>
  );
}

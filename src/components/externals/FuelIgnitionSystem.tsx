/**
 * FuelIgnitionSystem.tsx — the combustor-case fuel + ignition hardware:
 * the two staged DAC fuel-manifold rings (pilot + main) wrapping the case,
 * 30 fuel-nozzle pigtails dropping from the rings onto their nozzle-stem
 * flanges, the staging-valve block where the HMU supply line tees into both
 * rings, and the ignition chain — two exciter boxes on the lower-left core
 * feeding shielded leads aft to the two igniter plugs on the combustor case.
 *
 * Everything is positioned from EXTERNALS in engineLayout.ts and sits on
 * coreCaseRadiusAt(x), so it tracks the CutawayShell profile exactly. Tubes
 * are fully tinted per MIL-STD-1247 (fuel = red). In cutaway mode the
 * manifold tori are rebuilt as partial arcs whose gap matches the CUTAWAY
 * wedge, and any per-clock item that fails visibleInCutaway is skipped
 * (this is lower-half hardware, so almost all of it survives).
 *
 * LIVE: the fuel-red plumbing glows softly whenever fuel is actually flowing
 * (emissive on the shared fuel material tracks instruments.fuelFlowKgs), and
 * the two igniter-plug tips strobe an electric blue-white spark at ~6 Hz —
 * matching the audio's igniter click rate — gated on startSeq.ignitionOn and
 * honouring the A/B/BOTH igniter selection per start attempt.
 *
 * Draw calls: 10 total — merged manifold rings (1), pigtails (1 InstancedMesh),
 * nozzle-stem flanges (1 InstancedMesh), exciter boxes (1 InstancedMesh),
 * merged igniter leads (1), igniter plugs (1 InstancedMesh), 2 tiny spark
 * glows, staging-valve
 * block (1), merged tee/supply tubes (1).
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useSimStore } from '../../store/useSimStore';
import { CUTAWAY } from '../../geometry/annularSection';
import {
  EXTERNALS,
  TUBE_COLORS,
  clockToYZ,
  coreCaseRadiusAt,
  visibleInCutaway,
} from '../../data/engineLayout';

// --- Proportions (meters) ---------------------------------------------------
const MANIFOLD_TUBE_R = 0.025; // manifold ring tube radius
const PIGTAIL_TUBE_R = 0.012; // nozzle pigtail tube radius
const LEAD_TUBE_R = 0.018; // shielded igniter-lead radius
const STEM_X = 0.12; // fuel-nozzle stem flange station
const STEM_H = 0.05; // stem flange height above the case skin
const VALVE_X = 0.28; // staging valve sits between the two rings
const VALVE_CLOCK = 4.5; // lower right, where the HMU supply arrives
const EXCITER_SPREAD = 0.25; // the two exciter boxes sit side by side (± clock)

/** Igniter spark strobe rate [Hz] — matches the audio's 6 Hz igniter clicks. */
const SPARK_HZ = 6;
/** Takeoff fuel flow [kg/s] used to normalize the plumbing glow. */
const FUEL_FLOW_REF = 4.7;

// Shared scratch object (BladeRow pattern) — never allocated per frame.
const dummy = new THREE.Object3D();

/** Convenience: [x, r] pairs at a fixed clock → CatmullRom tube geometry. */
function tubeAtClock(
  hour: number,
  pts: Array<[number, number]>,
  tubeR: number,
  segments = 16,
): THREE.BufferGeometry {
  const v = pts.map(([x, r]) => {
    const { y, z } = clockToYZ(hour, r);
    return new THREE.Vector3(x, y, z);
  });
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v), segments, tubeR, 6, false);
}

/**
 * One InstancedMesh whose canonical geometry is built at clock 12 (radial = +Y)
 * with its axial x baked in; each instance is just a rotation about +X to its
 * clock hour. Stationary hardware — no per-frame work.
 */
function ClockInstances({
  geometry,
  material,
  hours,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  hours: number[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null!);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return; // unmounted (exploded view) — the parent rendered null
    hours.forEach((hour, k) => {
      const phi = (hour / 12) * Math.PI * 2;
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(-phi, 0, 0); // maps +Y → ALF clock position
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [hours]);

  return (
    <instancedMesh
      key={hours.length} // count is fixed at construction — remount when the cutaway filter changes it
      ref={ref}
      args={[geometry, material, hours.length]}
      frustumCulled={false}
      castShadow={false}
    />
  );
}

export function FuelIgnitionSystem() {
  const viewMode = useSimStore((s) => s.viewMode);
  const cutaway = viewMode === 'cutaway';

  // --- Manifold ring radii (track the case profile) -------------------------
  const [pilot, main] = EXTERNALS.fuelManifolds;
  const rPilot = coreCaseRadiusAt(pilot.x) + pilot.rOffset;
  const rMain = coreCaseRadiusAt(main.x) + main.rOffset;

  // --- Materials -------------------------------------------------------------
  const fuelMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: TUBE_COLORS.fuel,
        metalness: 0.55,
        roughness: 0.45,
        // Lights up when fuel actually flows (intensity mutated per frame).
        emissive: new THREE.Color('#ff4a26'),
        emissiveIntensity: 0,
      }),
    [],
  );
  const steelMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#8a9099', metalness: 0.8, roughness: 0.4 }),
    [],
  );
  const darkBoxMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#3a3f47', metalness: 0.5, roughness: 0.6 }),
    [],
  );
  const leadMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#4a4a50', metalness: 0.4, roughness: 0.55 }),
    [],
  );
  const brassMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#c9a96a', metalness: 0.85, roughness: 0.35 }),
    [],
  );

  // --- Fuel manifold rings (pilot + main tori, merged → one draw call) ------
  // A torus lies in X-Y around +Z; rotateY(π/2) puts it in the Y-Z plane around
  // +X. Its arc parameter u then maps to the lathe theta as θ = u − π, so for
  // the cutaway we build the CUTAWAY arc length and rotate by π + thetaStart to
  // line the gap up with the casing wedge.
  const manifoldGeoFull = useMemo(() => {
    const parts = EXTERNALS.fuelManifolds.map((m) => {
      const g = new THREE.TorusGeometry(coreCaseRadiusAt(m.x) + m.rOffset, MANIFOLD_TUBE_R, 10, 96);
      g.rotateY(Math.PI / 2);
      g.translate(m.x, 0, 0);
      return g;
    });
    return mergeGeometries(parts) ?? parts[0];
  }, []);
  const manifoldGeoCut = useMemo(() => {
    const parts = EXTERNALS.fuelManifolds.map((m) => {
      const g = new THREE.TorusGeometry(
        coreCaseRadiusAt(m.x) + m.rOffset,
        MANIFOLD_TUBE_R,
        10,
        80,
        CUTAWAY.thetaLength,
      );
      g.rotateY(Math.PI / 2);
      g.rotateX(Math.PI + CUTAWAY.thetaStart); // align the ring gap with the cutaway wedge
      g.translate(m.x, 0, 0);
      return g;
    });
    return mergeGeometries(parts) ?? parts[0];
  }, []);

  // --- Fuel-nozzle pigtails + stem flanges (30 around, fewer in cutaway) ----
  // Clock slots are offset half a pitch so none sits exactly on the cut edge.
  const nozzleHours = useMemo(() => {
    const pitch = 12 / EXTERNALS.fuelNozzleCount;
    const out: number[] = [];
    for (let k = 0; k < EXTERNALS.fuelNozzleCount; k++) {
      const hour = (k + 0.5) * pitch;
      if (cutaway && !visibleInCutaway(hour)) continue;
      out.push(hour);
    }
    return out;
  }, [cutaway]);

  // Canonical pigtail at clock 12: leaves the main ring, kisses the pilot ring
  // (each DAC nozzle takes both feeds), then dives into the stem flange.
  const pigtailGeo = useMemo(() => {
    const rStemTop = coreCaseRadiusAt(STEM_X) + STEM_H;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(main.x, rMain, 0),
      new THREE.Vector3((main.x + pilot.x) / 2, rMain + 0.018, 0),
      new THREE.Vector3(pilot.x, rPilot, 0),
      new THREE.Vector3(STEM_X + 0.02, (rPilot + rStemTop) / 2 + 0.01, 0),
      new THREE.Vector3(STEM_X, rStemTop, 0),
    ]);
    return new THREE.TubeGeometry(curve, 24, PIGTAIL_TUBE_R, 6, false);
  }, [main.x, pilot.x, rMain, rPilot]);

  // Nozzle-stem flange: a slightly tapered cylinder flush with the case skin.
  const stemGeo = useMemo(() => {
    const rCase = coreCaseRadiusAt(STEM_X);
    const g = new THREE.CylinderGeometry(0.028, 0.036, STEM_H, 12);
    g.translate(STEM_X, rCase + STEM_H / 2, 0);
    return g;
  }, []);

  // --- Ignition exciters (two ribbed boxes side by side near the fan frame) -
  const exciterHours = useMemo(() => {
    const all = [EXTERNALS.exciters.clock - EXCITER_SPREAD, EXTERNALS.exciters.clock + EXCITER_SPREAD];
    return cutaway ? all.filter(visibleInCutaway) : all;
  }, [cutaway]);

  // Canonical exciter at clock 12: mount foot + body + cooling fins, merged.
  const exciterGeo = useMemo(() => {
    const e = EXTERNALS.exciters;
    const rCase = coreCaseRadiusAt(e.x);
    const rCenter = rCase + e.standoff * 0.55;
    const parts: THREE.BufferGeometry[] = [];
    const foot = new THREE.BoxGeometry(0.14, e.standoff, 0.05);
    foot.translate(e.x, rCase + e.standoff / 2, 0);
    parts.push(foot);
    const body = new THREE.BoxGeometry(0.2, 0.1, 0.13);
    body.translate(e.x, rCenter, 0);
    parts.push(body);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.BoxGeometry(0.012, 0.115, 0.145);
      fin.translate(e.x - 0.066 + i * 0.044, rCenter, 0);
      parts.push(fin);
    }
    return mergeGeometries(parts) ?? parts[0];
  }, []);

  // --- Igniter plugs (hex body + round collar) on the combustor case --------
  const plugHours = useMemo(() => {
    const all = EXTERNALS.igniterPlugs.map((p) => p.clock);
    return cutaway ? all.filter(visibleInCutaway) : all;
  }, [cutaway]);

  const plugGeo = useMemo(() => {
    const x = EXTERNALS.igniterPlugs[0].x; // both plugs share the axial station
    const rCase = coreCaseRadiusAt(x);
    const body = new THREE.CylinderGeometry(0.024, 0.024, 0.075, 6); // hex
    body.translate(x, rCase + 0.055, 0);
    const collar = new THREE.CylinderGeometry(0.04, 0.04, 0.022, 12);
    collar.translate(x, rCase + 0.013, 0);
    return mergeGeometries([body, collar]) ?? body;
  }, []);

  // --- Igniter spark glows: a tiny strobing point at each plug tip ----------
  const sparkPts = useMemo(
    () =>
      EXTERNALS.igniterPlugs.map((p) => {
        const { y, z } = clockToYZ(p.clock, coreCaseRadiusAt(p.x) + 0.095);
        return { x: p.x, y, z };
      }),
    [],
  );
  const sparkMats = useMemo(
    () =>
      EXTERNALS.igniterPlugs.map(() => {
        const m = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          // HDR electric blue-white: > 1.0 so the bloom pass picks it up and
          // the spark reads as a real arc flash, not a lit ping-pong ball.
          toneMapped: false,
        });
        m.color.setRGB(2.2, 2.8, 3.6);
        return m;
      }),
    [],
  );
  const sparkA = useRef<THREE.Mesh>(null!);
  const sparkB = useRef<THREE.Mesh>(null!);

  // --- Live animation (non-reactive store reads, no React re-render) --------
  useFrame(({ clock }) => {
    const { startSeq, instruments } = useSimStore.getState();
    const t = clock.elapsedTime;

    // Fuel plumbing glows softly while fuel actually flows, with a faint
    // pulse so the flow reads as motion rather than a painted-on tint.
    const flow = Math.min(1, Math.max(0, instruments.fuelFlowKgs / FUEL_FLOW_REF));
    fuelMat.emissiveIntensity =
      flow > 0.002 ? (0.1 + 0.45 * flow) * (0.85 + 0.15 * Math.sin(t * 9)) : 0;

    // Igniter sparks: sharp ~6 Hz strobe at the active plug tip(s) only.
    // Plug index 0 is igniter A, index 1 is igniter B (alternated per start
    // attempt by the EEC; BOTH on autostart retry 3).
    const refs = [sparkA, sparkB];
    for (let i = 0; i < refs.length; i++) {
      const mesh = refs[i].current;
      if (!mesh) continue;
      const on =
        startSeq.ignitionOn &&
        (startSeq.activeIgniter === 'BOTH' || startSeq.activeIgniter === (i === 0 ? 'A' : 'B'));
      mesh.visible = on;
      if (!on) continue;
      const phase = (t * SPARK_HZ + i * 0.5) % 1;
      const flash = phase < 0.15 ? 1 : 0.06; // snap, then faint residual
      sparkMats[i].opacity = flash;
      mesh.scale.setScalar(0.75 + 0.5 * flash);
    }
  });

  // --- Shielded igniter leads: exciter aft faces → plug tops, hugging the case
  const leadsGeo = useMemo(() => {
    const e = EXTERNALS.exciters;
    const parts: THREE.BufferGeometry[] = [];
    EXTERNALS.igniterPlugs.forEach((plug, i) => {
      if (cutaway && !visibleInCutaway(plug.clock)) return;
      const hourStart = e.clock + (i === 0 ? -EXCITER_SPREAD : EXCITER_SPREAD);
      const x0 = e.x + 0.1; // off the exciter aft face
      const x1 = plug.x - 0.12; // approach along the case, then rise to the plug
      const pts: THREE.Vector3[] = [];
      const N = 8;
      for (let s = 0; s <= N; s++) {
        const t = s / N;
        const x = x0 + (x1 - x0) * t;
        const hour = hourStart + (plug.clock - hourStart) * t * t * (3 - 2 * t); // smooth clock drift
        const { y, z } = clockToYZ(hour, coreCaseRadiusAt(x) + 0.05);
        pts.push(new THREE.Vector3(x, y, z));
      }
      const rCase = coreCaseRadiusAt(plug.x);
      const near = clockToYZ(plug.clock, rCase + 0.07);
      pts.push(new THREE.Vector3(plug.x - 0.04, near.y, near.z));
      const top = clockToYZ(plug.clock, rCase + 0.095);
      pts.push(new THREE.Vector3(plug.x, top.y, top.z));
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, LEAD_TUBE_R, 8, false));
    });
    return parts.length ? mergeGeometries(parts) ?? parts[0] : null;
  }, [cutaway]);

  // --- Staging valve + tee tubes: HMU supply splits into pilot/main rings ---
  const valveVisible = !cutaway || visibleInCutaway(VALVE_CLOCK); // lower right — always survives
  const rValve = Math.max(rPilot, rMain) + 0.018; // just proud of both rings

  const teeGeo = useMemo(() => {
    const parts = [
      // forward branch → pilot ring
      tubeAtClock(VALVE_CLOCK, [[VALVE_X - 0.03, rValve], [(VALVE_X + pilot.x) / 2, rValve - 0.004], [pilot.x, rPilot]], 0.016),
      // aft branch → main ring
      tubeAtClock(VALVE_CLOCK, [[VALVE_X + 0.03, rValve], [(VALVE_X + main.x) / 2, rValve - 0.002], [main.x, rMain]], 0.016),
      // supply stub climbing the HPC-exit ramp from the pump/HMU stack
      tubeAtClock(VALVE_CLOCK, [[-0.05, coreCaseRadiusAt(-0.05) + 0.03], [0.05, coreCaseRadiusAt(0.05) + 0.04], [0.17, rValve - 0.015], [VALVE_X - 0.045, rValve]], 0.02, 24),
    ];
    return mergeGeometries(parts) ?? parts[0];
  }, [pilot.x, main.x, rPilot, rMain, rValve]);

  const valveYZ = clockToYZ(VALVE_CLOCK, rValve);
  const valvePhi = (VALVE_CLOCK / 12) * Math.PI * 2;

  // Hidden in exploded view — the separated modules are shown bare.
  if (viewMode === 'exploded') return null;

  return (
    <group>
      {/* Staged fuel manifolds (pilot + main rings) */}
      <mesh geometry={cutaway ? manifoldGeoCut : manifoldGeoFull} material={fuelMat} castShadow={false} />

      {/* 30 fuel-nozzle pigtails + their stem flanges */}
      <ClockInstances geometry={pigtailGeo} material={fuelMat} hours={nozzleHours} />
      <ClockInstances geometry={stemGeo} material={steelMat} hours={nozzleHours} />

      {/* Ignition exciter boxes */}
      <ClockInstances geometry={exciterGeo} material={darkBoxMat} hours={exciterHours} />

      {/* Shielded igniter leads (none survive → skip the mesh entirely) */}
      {leadsGeo && <mesh geometry={leadsGeo} material={leadMat} castShadow={false} />}

      {/* Igniter plugs */}
      {plugHours.length > 0 && <ClockInstances geometry={plugGeo} material={brassMat} hours={plugHours} />}

      {/* Igniter spark glows — strobed in useFrame while ignition is on. */}
      {sparkPts.map((p, i) =>
        !cutaway || visibleInCutaway(EXTERNALS.igniterPlugs[i].clock) ? (
          <mesh
            key={`spark-${i}`}
            ref={i === 0 ? sparkA : sparkB}
            position={[p.x, p.y, p.z]}
            visible={false}
            castShadow={false}
          >
            <sphereGeometry args={[0.02, 10, 10]} />
            <primitive object={sparkMats[i]} attach="material" />
          </mesh>
        ) : null,
      )}

      {/* Staging valve block + tee/supply tubes */}
      {valveVisible && (
        <>
          <mesh
            position={[VALVE_X, valveYZ.y, valveYZ.z]}
            rotation={[-valvePhi, 0, 0]}
            material={darkBoxMat}
            castShadow={false}
          >
            <boxGeometry args={[0.1, 0.07, 0.08]} />
          </mesh>
          <mesh geometry={teeGeo} material={fuelMat} castShadow={false} />
        </>
      )}
    </group>
  );
}

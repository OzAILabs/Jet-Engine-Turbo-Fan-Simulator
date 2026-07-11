/**
 * Nacelle.tsx
 *
 * The outer cowl (nacelle) of the engine plus the inner bypass-duct wall and a
 * rounded inlet lip. This is a STATIONARY shell: it never spins. Its job is to
 * react to the current view mode so students can "peel back" the casing and see
 * the rotating machinery inside.
 *
 * View modes (see the project's VIEW MODE BEHAVIOR notes):
 *   full        -> solid metal cowl, fully opaque.
 *   transparent -> ghosted, very faint so internals show through.
 *   cutaway     -> a partial ring (a wedge removed) so you can look straight in.
 *   exploded    -> faint AND lifted up on +Y so the parts separate vertically.
 *
 * All geometry is built centered at the local origin and oriented along +X by
 * the geometry helpers, so we can render the meshes without extra positioning.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  createNacelleShell,
  createNacelleChevrons,
  createBypassDuctInner,
  createNacelleCutFaces,
  createNacelleCloseouts,
  createNacelleShellDoorsOff,
  createFanCowlDoors,
  createDoorShreds,
  createNacelleShellBurstHole,
  createBurstFragments,
  createBayLiner,
  createBayInnards,
  CUTAWAY_KEPT,
  FAN_COWL,
  BURST_BAY,
} from '../geometry/nacelleGeometry';
import { clockToTheta } from '../data/engineLayout';
import { CUTAWAY } from '../geometry/annularSection';
import { createPaintedNacelleMaterial } from '../materials/coldSection';
import { createNacelleSkinMaterial } from '../materials/nacelleSkin';
import { CutawayEdges } from './CutawayEdges';
import { NacelleFurniture } from './NacelleFurniture';
import { useSimStore } from '../store/useSimStore';

export function Nacelle() {
  // Only the view mode changes how this shell is drawn, so subscribe to just
  // that slice reactively (cheap, re-renders only when the mode changes).
  const viewMode = useSimStore((s) => s.viewMode);
  // Catastrophic-failure aftermath: 'doors' = the fan-cowl doors have
  // DEPARTED (fbo); 'hole' = disk fragments tore the aft cowl open (burst).
  // The string flips once per event (rud.t crosses doorsDepartT), not per tick.
  const aftermath = useSimStore((s) =>
    s.rud !== null && s.rud.t >= s.rud.doorsDepartT
      ? s.rud.variant === 'fbo'
        ? 'doors'
        : 'hole'
      : 'none',
  );
  const doorsGone = aftermath === 'doors';
  const holeOpen = aftermath === 'hole';

  const root = useRef<THREE.Group>(null!);

  // --- Geometries (created once) -------------------------------------------
  // We keep two variants of each shell: a full 360-degree surface and a partial
  // ("cutaway") surface that has a wedge removed. The full one is reused for the
  // full / transparent / exploded modes; the partial one is only for cutaway.
  const shellFull = useMemo(() => createNacelleShell(), []);
  const shellCut = useMemo(
    () => createNacelleShell({ thetaStart: CUTAWAY.thetaStart, thetaLength: CUTAWAY.thetaLength }),
    [],
  );
  const ductFull = useMemo(() => createBypassDuctInner(), []);
  const ductCut = useMemo(
    () => createBypassDuctInner({ thetaStart: CUTAWAY.thetaStart, thetaLength: CUTAWAY.thetaLength }),
    [],
  );
  // Sawtooth chevron band on the bypass-nozzle trailing edge; the sawtooth
  // phase is a function of absolute theta, so full and cut variants align.
  const chevFull = useMemo(() => createNacelleChevrons(), []);
  const chevCut = useMemo(
    () => createNacelleChevrons({ thetaStart: CUTAWAY.thetaStart, thetaLength: CUTAWAY.thetaLength }),
    [],
  );
  // Wall-thickness pieces: closeout rings seal the shell↔duct cavity at both
  // ends in every mode; panel bands at the cutaway planes give each skin
  // ~3.5 cm of sandwich thickness while the cavity between stays hollow.
  const closeoutFull = useMemo(() => createNacelleCloseouts(), []);
  const closeoutCut = useMemo(
    () => createNacelleCloseouts({ thetaStart: CUTAWAY.thetaStart, thetaLength: CUTAWAY.thetaLength }),
    [],
  );
  const cutFaces = useMemo(
    () => createNacelleCutFaces(CUTAWAY.thetaStart, CUTAWAY.thetaLength),
    [],
  );
  // Aftermath geometry, built lazily the first time skin departs: either the
  // door-bay-open shell + two door panels (fbo) or the burst-hole shell + two
  // torn fragments (burst) — all still wearing the painted skin.
  const damagedShell = useMemo(
    () =>
      doorsGone ? createNacelleShellDoorsOff() : holeOpen ? createNacelleShellBurstHole() : null,
    [doorsGone, holeOpen],
  );
  // Damage-aware CUTAWAY shell: same torn geometry, intersected with the
  // wedge's kept window — the cutaway shows the event too, live and after.
  const damagedShellCut = useMemo(
    () =>
      doorsGone
        ? createNacelleShellDoorsOff(CUTAWAY_KEPT)
        : holeOpen
          ? createNacelleShellBurstHole(CUTAWAY_KEPT)
          : null,
    [doorsGone, holeOpen],
  );
  // Wreckage strewn through the opened cavity (bent ribs, sagging cables) —
  // in front of the charred liner, behind the torn skin line.
  const innards = useMemo(
    () => (doorsGone ? createBayInnards('doors') : holeOpen ? createBayInnards('hole') : null),
    [doorsGone, holeOpen],
  );
  const innardsCut = useMemo(
    () =>
      doorsGone
        ? createBayInnards('doors', CUTAWAY_KEPT)
        : holeOpen
          ? createBayInnards('hole', CUTAWAY_KEPT)
          : null,
    [doorsGone, holeOpen],
  );
  // fbo: the two doors PEEL for half a second, then shatter into shreds.
  // burst: the punched-out skin flies as two ragged fragments immediately.
  const doors = useMemo(() => (doorsGone ? createFanCowlDoors() : null), [doorsGone]);
  const flying = useMemo(
    () => (doorsGone ? createDoorShreds() : holeOpen ? createBurstFragments() : null),
    [doorsGone, holeOpen],
  );
  // Charred liner on the cavity floor so the wound reads black behind the
  // wreckage, not light duct wall tone-on-tone behind a light skin.
  const bayLiner = useMemo(
    () =>
      doorsGone
        ? createBayLiner(FAN_COWL.x0, FAN_COWL.x1)
        : holeOpen
          ? createBayLiner(BURST_BAY.x0 - 0.08, BURST_BAY.x1 + 0.08, {
              thetaStart: clockToTheta(BURST_BAY.clock) - BURST_BAY.half - 0.12,
              thetaLength: 2 * (BURST_BAY.half + 0.12),
            })
          : null,
    [doorsGone, holeOpen],
  );
  const bayLinerCut = useMemo(() => {
    if (doorsGone) {
      return createBayLiner(FAN_COWL.x0, FAN_COWL.x1, {
        thetaStart: CUTAWAY_KEPT[0],
        thetaLength: CUTAWAY_KEPT[1] - CUTAWAY_KEPT[0],
      });
    }
    if (holeOpen) {
      const lo = Math.max(clockToTheta(BURST_BAY.clock) - BURST_BAY.half - 0.12, CUTAWAY_KEPT[0]);
      const hi = Math.min(clockToTheta(BURST_BAY.clock) + BURST_BAY.half + 0.12, CUTAWAY_KEPT[1]);
      return hi > lo
        ? createBayLiner(BURST_BAY.x0 - 0.08, BURST_BAY.x1 + 0.08, {
            thetaStart: lo,
            thetaLength: hi - lo,
          })
        : null;
    }
    return null;
  }, [doorsGone, holeOpen]);
  const bayMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#141518',
        metalness: 0.25,
        roughness: 0.95,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const doorRefs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const flyRefs = useRef<(THREE.Group | null)[]>([]);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  /** Doors peel this long, then explode into the shreds. */
  const PEEL_END = 0.55;
  /** Deterministic per-shred hash in [0,1). */
  const h = (i: number, k: number) => (((i * 37 + k * 61) % 23) / 23 + ((i * 13) % 5) / 5) / 2;
  useFrame(() => {
    const rud = useSimStore.getState().rud;
    if (!rud) return;
    const t = Math.max(0, rud.t - rud.doorsDepartT);

    // --- Phase 1 (fbo): the doors shudder and PEEL about the 12:00 hinge. --
    if (doors) {
      doorRefs.forEach((ref, i) => {
        const g = ref.current;
        if (!g) return;
        if (t >= PEEL_END) {
          g.visible = false; // it just exploded — the shreds take over
          return;
        }
        g.visible = true;
        const sign = i === 0 ? 1 : -1;
        const peel = t / PEEL_END;
        const ang = sign * (0.55 * peel * peel + 0.18 * Math.sin(43 * t) * peel * (1 - peel));
        const hr = 1.81; // outer skin radius over the bay (the 12:00 hinge line)
        const d = doors[i];
        scratch.set(0, d.center.y - hr, d.center.z);
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        g.position.set(
          d.center.x,
          hr + scratch.y * cos - scratch.z * sin,
          scratch.y * sin + scratch.z * cos,
        );
        g.rotation.set(ang, 0, 0);
      });
    }

    // --- Flying skin: fbo shreds after the peel, burst fragments at once. --
    if (flying) {
      const t0 = rud.variant === 'fbo' ? PEEL_END : 0;
      const ts = t - t0;
      flyRefs.current.forEach((g, i) => {
        if (!g) return;
        const d = flying[i];
        if (!d || ts <= 0 || ts > 4 + 8 * h(i, 4)) {
          g.visible = false;
          return;
        }
        g.visible = true;
        // Violent, scattered: every shred gets its own speed, drift and spin
        // — confetti in a hurricane, not synchronized swimming.
        const vOut = rud.variant === 'fbo' ? 2.5 + 7 * h(i, 1) : 8 + 8 * h(i, 1);
        const vAft = 1.5 + 5 * h(i, 2);
        const grav = 1.2 + 2.5 * h(i, 3);
        const s1 = (3 + 11 * h(i, 5)) * (h(i, 6) > 0.5 ? 1 : -1);
        const s2 = (2 + 8 * h(i, 7)) * (h(i, 8) > 0.5 ? 1 : -1);
        g.position.set(
          d.center.x + vAft * ts + 0.4 * Math.sin(3 * ts + i),
          d.center.y + d.outward.y * vOut * ts - 0.5 * grav * ts * ts,
          d.center.z + d.outward.z * vOut * ts,
        );
        g.rotation.set(s1 * ts, s2 * ts, (s1 - s2) * 0.5 * ts);
      });
    }
  });
  // Cut faces read as sectioned structure: flat, non-shiny, slightly darker
  // than the paint (museum-cutaway style). Only shown in cutaway (opaque),
  // so it never needs the transparency mutations the skin/duct get.
  const cutFaceMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#9ba2a9',
        metalness: 0.3,
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // --- Materials (created once, tweaked per view mode) ---------------------
  // The outer cowl wears the full painted SKIN (panel seams, rivets, access
  // doors, markings, bare-metal lip, grime — see materials/nacelleSkin.ts);
  // the bypass-duct inner wall keeps the plain mottled paint so cowl markings
  // don't smear across it. Both stay single shared MeshStandardMaterials: the
  // view-mode switch below mutates transparency flags on BOTH in lockstep.
  const skinMat = useMemo(() => createNacelleSkinMaterial(), []);
  const ductMat = useMemo(() => createPaintedNacelleMaterial(), []);
  // Decide which geometry and material settings to use for the current mode.
  // We mutate the shared materials' transparency flags directly inside this
  // memo so they stay in sync with viewMode without creating new materials.
  const { shellGeo, ductGeo } = useMemo(() => {
    const apply = (transparent: boolean, opacity: number) => {
      for (const material of [skinMat, ductMat]) {
        material.transparent = transparent;
        material.opacity = opacity;
        material.depthWrite = !transparent;
        material.side = THREE.DoubleSide;
      }
    };
    switch (viewMode) {
      case 'transparent':
        // Very faint: the cowl (DoubleSide) and the bypass-duct inner wall
        // stack with the core casing — so keep each layer low or they
        // composite into a milky, near-opaque shell.
        apply(true, 0.07);
        return { shellGeo: shellFull, ductGeo: ductFull };

      case 'cutaway':
        // The remaining cowl is solid metal; only the removed wedge exposes
        // the internals. Show both faces so the cut edge/interior wall reads.
        apply(false, 1);
        return { shellGeo: shellCut, ductGeo: ductCut };

      case 'full':
      default:
        // Solid opaque metal.
        apply(false, 1);
        return { shellGeo: shellFull, ductGeo: ductFull };
    }
  }, [viewMode, skinMat, ductMat, shellFull, shellCut, ductFull, ductCut]);

  // In exploded view the cowl is hidden entirely so the separated internal
  // modules are fully visible (and there is no faint floating shell). Same in
  // the Internals drive-train view — no shells at all.
  if (viewMode === 'exploded' || viewMode === 'internals') return null;

  return (
    <group ref={root}>
      {/* Outer cowl shell. After a catastrophic failure the skin is TORN in
          EVERY view: full/transparent swap to the open-bay shell, cutaway to
          the same damage intersected with its kept wedge. */}
      <mesh
        geometry={
          viewMode === 'cutaway'
            ? (damagedShellCut ?? shellGeo)
            : (damagedShell ?? shellGeo)
        }
        material={skinMat}
      />

      {/* Charred bay liner + wreckage strewn through the opened cavity. */}
      {(viewMode === 'cutaway' ? bayLinerCut : bayLiner) && (
        <mesh geometry={(viewMode === 'cutaway' ? bayLinerCut : bayLiner)!} material={bayMat} />
      )}
      {(() => {
        const inn = viewMode === 'cutaway' ? innardsCut : innards;
        if (!inn) return null;
        return (
          <>
            {inn.dark && <mesh geometry={inn.dark} material={bayMat} castShadow={false} />}
            {inn.steel && <mesh geometry={inn.steel} material={cutFaceMat} castShadow={false} />}
          </>
        );
      })()}

      {/* Departed skin: the peeling doors (first half-second, fbo)... */}
      {doors && (
        <>
          {doors.map((d, i) => (
            <group key={`door-${i}`} ref={doorRefs[i]} position={d.center.toArray()}>
              <mesh geometry={d.geometry} material={skinMat} />
            </group>
          ))}
        </>
      )}
      {/* ...then the ragged shreds / burst fragments, scattering violently. */}
      {flying && (
        <>
          {flying.map((d, i) => (
            <group
              key={`shred-${i}`}
              ref={(el) => {
                flyRefs.current[i] = el;
              }}
              position={d.center.toArray()}
              visible={false}
            >
              <mesh geometry={d.geometry} material={skinMat} />
            </group>
          ))}
        </>
      )}

      {/* Chevron serrations continuing the trailing edge (same skin paint). */}
      <mesh geometry={viewMode === 'cutaway' ? chevCut : chevFull} material={skinMat} />

      {/* Inner bypass-duct wall */}
      <mesh geometry={ductGeo} material={ductMat} />

      {/* Closeout rings sealing the shell↔duct cavity fore and aft. */}
      <mesh
        geometry={viewMode === 'cutaway' ? closeoutCut : closeoutFull}
        material={ductMat}
      />

      {/* Panel-band cut faces at the wedge planes (cutaway only): each skin
          shows honeycomb-sandwich thickness; the cavity between stays open. */}
      {viewMode === 'cutaway' && <mesh geometry={cutFaces} material={cutFaceMat} />}

      {/* Cowl hardware: latch handles, T2 probe, crisp placard decals
          (hides itself outside full/cutaway). */}
      <NacelleFurniture />

      {/* GE-style blue outline on the cut edges (cutaway mode only). */}
      {viewMode === 'cutaway' && (
        <>
          <CutawayEdges geometry={damagedShellCut ?? shellCut} />
          <CutawayEdges geometry={ductCut} />
        </>
      )}
    </group>
  );
}

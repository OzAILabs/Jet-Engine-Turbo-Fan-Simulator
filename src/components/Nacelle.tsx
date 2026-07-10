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
  createNacelleShellBurstHole,
  createBurstFragments,
  createBayLiner,
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
  const flying = useMemo(
    () => (doorsGone ? createFanCowlDoors() : holeOpen ? createBurstFragments() : null),
    [doorsGone, holeOpen],
  );
  // Charred liner behind the opening so the wound reads BLACK, not the
  // light duct wall tone-on-tone behind a light skin.
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
  const flyRefs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const scratch = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!flying) return;
    const rud = useSimStore.getState().rud;
    if (!rud) return;
    const t = Math.max(0, rud.t - rud.doorsDepartT);
    flyRefs.forEach((ref, i) => {
      const g = ref.current;
      if (!g) return;
      const d = flying[i];
      const sign = i === 0 ? 1 : -1;
      if (rud.variant === 'fbo') {
        // TWO-PHASE departure. Phase 1 (0–0.8 s): the door PEELS about its
        // 12:00 hinge line, shuddering, so the tearing is watchable. Phase 2:
        // it lets go — swept aft, floating outward, tumbling, ~10 s on stage.
        if (t > 14) {
          g.visible = false;
          return;
        }
        g.visible = true;
        const peel = Math.min(t / 0.8, 1);
        const ang =
          sign * (1.05 * peel * peel + 0.05 * Math.sin(38 * t) * peel * (1 - peel) * 4);
        // Hinge pivot: the 12:00 line over the door bay's mid-length.
        const hx = (FAN_COWL.x0 + FAN_COWL.x1) / 2;
        const hr = 1.81; // outer skin radius over the bay
        scratch.set(d.center.x - hx, d.center.y - hr, d.center.z); // center − pivot
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const ry = scratch.y * cos - scratch.z * sin;
        const rz = scratch.y * sin + scratch.z * cos;
        const tf = Math.max(0, t - 0.8);
        // Slow, fluttering panels (they have huge drag): drift aft and out,
        // sinking gently — in frame for ~10 s, watchable, not a blink.
        g.position.set(
          d.center.x + 1.2 * tf,
          hr + ry + d.outward.y * (1.3 * tf + 0.2 * tf * tf) - 0.35 * tf * tf,
          rz + d.outward.z * (1.3 * tf + 0.2 * tf * tf),
        );
        g.rotation.set(ang + sign * 1.7 * tf, sign * 0.7 * tf, -1.1 * tf);
      } else {
        // Burst fragments: violent, fast, radial — shrapnel, not doors.
        if (t > 5) {
          g.visible = false;
          return;
        }
        g.visible = true;
        g.position.set(
          d.center.x + 3 * t,
          d.center.y + d.outward.y * (11 * t) - 4.9 * t * t,
          d.center.z + d.outward.z * (11 * t),
        );
        g.rotation.set(sign * 9 * t, 2.5 * t, sign * 5 * t);
      }
    });
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
      {/* Outer cowl shell. After a catastrophic failure the skin is TORN:
          fbo swaps to the open-door-bay shell, burst to the punched-hole
          shell (the cutaway keeps its normal cut shell — an analysis view). */}
      <mesh
        geometry={damagedShell && viewMode !== 'cutaway' ? damagedShell : shellGeo}
        material={skinMat}
      />

      {/* Charred bay liner behind any opened skin. */}
      {bayLiner && viewMode !== 'cutaway' && <mesh geometry={bayLiner} material={bayMat} />}

      {/* Departed skin — peeling/tumbling doors or blasted fragments. */}
      {flying && viewMode !== 'cutaway' && (
        <>
          {flying.map((d, i) => (
            <group key={i} ref={flyRefs[i]} position={d.center.toArray()}>
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
          <CutawayEdges geometry={shellCut} />
          <CutawayEdges geometry={ductCut} />
        </>
      )}
    </group>
  );
}

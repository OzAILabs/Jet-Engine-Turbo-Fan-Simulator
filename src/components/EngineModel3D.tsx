/**
 * EngineModel3D — composes every 3D part of the engine in one group.
 *
 * Each child reads what it needs from the store directly, so this file is just
 * a clean assembly: structure (nacelle, casing), rotating machinery (fan,
 * compressor, combustor, turbine, shafts, nozzles), flow visualization
 * (particles, plume), and the educational overlays (stations, section labels).
 *
 * In EXPLODED mode we pull the major modules apart along the axis (using the
 * shared explodeShiftX map so markers/labels stay consistent), hide the shells
 * and the flow effects, and let students see each module separated.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { AXIS, explodeShiftX } from '../data/engineLayout';
import { Nacelle } from './Nacelle';
import { CutawayShell } from './CutawayShell';
import { BypassStruts } from './BypassStruts';
import { Fan } from './Fan';
import { Compressor } from './Compressor';
import { Combustor } from './Combustor';
import { Turbine } from './Turbine';
import { Shafts } from './Shafts';
import { Bearings } from './Bearings';
import { Nozzles } from './Nozzles';
import { FlowParticles } from './FlowParticles';
import { ExhaustPlume } from './ExhaustPlume';
import { StationMarkers } from './StationMarkers';
import { SectionLabels } from './SectionLabel';
import { VelocityVectors } from './VelocityVectors';
import { AccessoryGearbox } from './externals/AccessoryGearbox';
import { AgbGearTrain } from './externals/AgbGearTrain';
import { FuelIgnitionSystem } from './externals/FuelIgnitionSystem';
import { CompressorBleedSystems } from './externals/CompressorBleedSystems';
import { CaseDetail } from './externals/CaseDetail';
import { HarnessAndSensors } from './externals/HarnessAndSensors';
import { SecondaryFlows } from './SecondaryFlows';

/** Axial center of each major module, used to spread them in exploded view. */
const MODULE_CENTERS = {
  fan: AXIS.fanPlane,
  compressor: (AXIS.lpcStart + AXIS.hpcEnd) / 2,
  combustor: (AXIS.combustorStart + AXIS.combustorEnd) / 2,
  turbine: (AXIS.hptStart + AXIS.lptEnd) / 2,
  nozzles: (AXIS.coreNozzleStart + AXIS.plugEnd) / 2,
};

export function EngineModel3D() {
  const root = useRef<THREE.Group>(null!);
  const debugMode = useSimStore((s) => s.debugMode);
  const exploded = useSimStore((s) => s.viewMode === 'exploded');
  // Drive-train X-ray: hide the gas-path machinery so the shafts, bearings
  // and accessory drive get the stage to themselves.
  const internals = useSimStore((s) => s.viewMode === 'internals');
  // Per-system layer gates — AND-ed with the mode logic. Object identity only
  // changes on a user toggle, so this re-render is rare and user-driven.
  const layers = useSimStore((s) => s.layers);

  const off = (center: number): [number, number, number] => [exploded ? explodeShiftX(center) : 0, 0, 0];

  useEffect(() => {
    root.current.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
  }, [exploded]);

  // The externals layer manages its own shadow flags (hundreds of greebles
  // opt out of shadow casting for performance) — keep it OUTSIDE the blanket
  // shadow traverse above by mounting it in a sibling group.

  return (
    <>
      <group ref={root}>
      {/* Two-spool shafts run the length of the engine; hide them when the
          modules are pulled apart so they don't dangle in the gaps. */}
      {!exploded && layers.rotors && <Shafts />}

      {/* Rotating machinery & static internals (spread apart when exploded).
          Fan/Compressor/Turbine stay mounted in the Internals view — they hide
          their own BLADE ROWS there but keep the spinning drums, machined
          disks and drive cones on stage with the shafts and bearings. */}
      <group position={off(MODULE_CENTERS.fan)}>
        <Fan />
      </group>
      <group position={off(MODULE_CENTERS.compressor)}>
        <Compressor />
      </group>
      <group position={off(MODULE_CENTERS.turbine)}>
        <Turbine />
      </group>
      {/* The combustor can + nozzles are pure gas path — nothing rotates, so
          the Internals drive-train view drops them entirely. */}
      {!internals && (
        <>
          {layers.combustor && (
            <group position={off(MODULE_CENTERS.combustor)}>
              <Combustor />
            </group>
          )}
          {layers.nozzles && (
            <group position={off(MODULE_CENTERS.nozzles)}>
              <Nozzles />
            </group>
          )}
        </>
      )}

      {/* Casings / shells (transparency & cutaway handled inside; they hide
          themselves in exploded mode so there is no floating "ghost" shell). */}
      {layers.nacelle && <CutawayShell />}
      {/* Fan-frame structural struts spanning the bypass duct, aft of the OGVs. */}
      {layers.structure && <BypassStruts />}
      {layers.nacelle && <Nacelle />}

      {/* Flow visualization follows the assembled engine, so hide it when
          exploded (the modules no longer line up with the flow paths) and in
          the Internals view (there is no visible gas path to follow). */}
      {!exploded && !internals && (
        <>
          <FlowParticles />
          <ExhaustPlume />
          <VelocityVectors />
        </>
      )}

      {/* Educational overlays (these shift with the modules in exploded view). */}
      <StationMarkers />
      <SectionLabels />

      {debugMode && <axesHelper args={[3]} />}
    </group>

      {/* External hardware — accessory drive, fuel/ignition plumbing, variable
          geometry, fasteners, wiring. Sibling of the shadow-traversed root so
          each greeble keeps its own castShadow=false; every component handles
          the four view modes itself (and returns null when exploded). */}
      <group>
        {/* Live main-shaft bearings (spinning races, roller cages, oil jets).
            Internals, but mounted here — outside the blanket shadow traverse —
            so their castShadow=false sticks; they handle all four view modes
            themselves (null in 'full' and 'exploded'). */}
        {layers.bearings && <Bearings />}
        {layers.accessoryDrive && (
          <>
            <AccessoryGearbox />
            <AgbGearTrain />
          </>
        )}
        {layers.fuelSystem && <FuelIgnitionSystem />}
        {layers.airBleed && <CompressorBleedSystems />}
        {layers.caseDetail && <CaseDetail />}
        {layers.electrical && <HarnessAndSensors />}
        {/* Oil circuit / VBV dump / cooling-air particle runs (overlay-toggled;
            gates its own layers internally, hides itself when exploded). */}
        <SecondaryFlows />
      </group>
    </>
  );
}

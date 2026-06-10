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
import { Nozzles } from './Nozzles';
import { FlowParticles } from './FlowParticles';
import { ExhaustPlume } from './ExhaustPlume';
import { StationMarkers } from './StationMarkers';
import { SectionLabels } from './SectionLabel';
import { VelocityVectors } from './VelocityVectors';
import { AccessoryGearbox } from './externals/AccessoryGearbox';
import { FuelIgnitionSystem } from './externals/FuelIgnitionSystem';
import { CompressorBleedSystems } from './externals/CompressorBleedSystems';
import { CaseDetail } from './externals/CaseDetail';
import { HarnessAndSensors } from './externals/HarnessAndSensors';

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
      {!exploded && <Shafts />}

      {/* Rotating machinery & static internals (spread apart when exploded). */}
      <group position={off(MODULE_CENTERS.fan)}>
        <Fan />
      </group>
      <group position={off(MODULE_CENTERS.compressor)}>
        <Compressor />
      </group>
      <group position={off(MODULE_CENTERS.combustor)}>
        <Combustor />
      </group>
      <group position={off(MODULE_CENTERS.turbine)}>
        <Turbine />
      </group>
      <group position={off(MODULE_CENTERS.nozzles)}>
        <Nozzles />
      </group>

      {/* Casings / shells (transparency & cutaway handled inside; they hide
          themselves in exploded mode so there is no floating "ghost" shell). */}
      <CutawayShell />
      {/* Fan-frame structural struts spanning the bypass duct, aft of the OGVs. */}
      <BypassStruts />
      <Nacelle />

      {/* Flow visualization follows the assembled engine, so hide it when
          exploded (the modules no longer line up with the flow paths). */}
      {!exploded && (
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
        <AccessoryGearbox />
        <FuelIgnitionSystem />
        <CompressorBleedSystems />
        <CaseDetail />
        <HarnessAndSensors />
      </group>
    </>
  );
}

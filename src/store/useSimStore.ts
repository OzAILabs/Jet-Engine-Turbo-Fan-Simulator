/**
 * Central application state (Zustand).
 *
 * Holds: the user inputs, the recomputed steady-state engine solution, the
 * live (animated) spool state, and all view/UI toggles. Components subscribe to
 * just the slices they need, so a slider re-render never forces the 3D scene to
 * rebuild.
 */
import { create } from 'zustand';
import { computeEngineState, equilibriumDynamics } from '../sim/engineModel';
import { advanceSpools, transientSurgePenalty } from '../sim/spoolDynamics';
import { defaultEngineConfig } from '../data/defaultEngineConfig';
import type { EngineConfig, EngineInputs, EngineState, SpoolState, StationId } from '../sim/types';
import { clamp } from '../sim/units';

// --- View enums -----------------------------------------------------------
export type ViewMode = 'full' | 'transparent' | 'cutaway' | 'exploded';
export type CameraMode = 'orthographic' | 'perspective';
/** Exhaust rendering style: realistic translucent gas vs. dramatic bright plume. */
export type ExhaustStyle = 'volumetric' | 'shader';
export type CameraPreset = 'iso' | 'fan' | 'compressor' | 'combustor' | 'exhaust' | 'top';

export interface CameraCommand {
  /** What kind of camera move was last requested. */
  kind: 'preset' | 'focus' | 'reset';
  preset: CameraPreset;
  /** Explicit target point (used by 'focus'); null means "use the preset's target". */
  focusPoint: [number, number, number] | null;
  /** Monotonic counter so effects re-run even when the target is unchanged. */
  nonce: number;
}

const config: EngineConfig = defaultEngineConfig;

const INITIAL_INPUTS: EngineInputs = {
  throttle: 85,
  altitudeFt: 0,
  mach: 0,
  isaTempOffsetC: 0,
};

const TAKEOFF_INPUTS: EngineInputs = { throttle: 100, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };
const CRUISE_INPUTS: EngineInputs = { throttle: 85, altitudeFt: 35000, mach: 0.85, isaTempOffsetC: 0 };

export interface SimStore {
  config: EngineConfig;

  // Physics
  inputs: EngineInputs;
  engine: EngineState;
  spool: SpoolState;
  /** Live surge margin (steady margin minus any throttle-transient penalty). */
  surgeMargin: number;
  transientActive: boolean;

  // View / UI toggles
  viewMode: ViewMode;
  exhaustStyle: ExhaustStyle;
  cameraMode: CameraMode;
  cameraCommand: CameraCommand;
  paused: boolean;
  debugMode: boolean;
  showStationLabels: boolean;
  showSectionLabels: boolean;
  showFlowParticles: boolean;
  showTempColors: boolean;
  showVelocityVectors: boolean;

  // Selection
  selectedStation: StationId | null;
  selectedSection: string | null;

  // --- Actions ---
  setInputs: (partial: Partial<EngineInputs>) => void;
  setThrottle: (v: number) => void;
  setAltitude: (v: number) => void;
  setMach: (v: number) => void;
  setIsaOffset: (v: number) => void;

  tick: (dt: number) => void;

  setViewMode: (m: ViewMode) => void;
  setExhaustStyle: (s: ExhaustStyle) => void;
  setCameraMode: (m: CameraMode) => void;
  setCameraPreset: (p: CameraPreset) => void;
  focusOn: (point: [number, number, number]) => void;
  resetCamera: () => void;
  togglePaused: () => void;
  toggleDebug: () => void;
  toggle: (key: ToggleKey) => void;

  selectStation: (id: StationId | null) => void;
  selectSection: (id: string | null) => void;

  resetToTakeoff: () => void;
  resetToCruise: () => void;
}

type ToggleKey =
  | 'showStationLabels'
  | 'showSectionLabels'
  | 'showFlowParticles'
  | 'showTempColors'
  | 'showVelocityVectors';

const initialSpool = equilibriumDynamics(INITIAL_INPUTS, config);
const initialEngine = computeEngineState(INITIAL_INPUTS, config, initialSpool);

export const useSimStore = create<SimStore>((set, get) => ({
  config,

  inputs: INITIAL_INPUTS,
  engine: initialEngine,
  spool: initialSpool,
  surgeMargin: initialEngine.surgeMarginSteady,
  transientActive: false,

  viewMode: 'cutaway',
  exhaustStyle: 'volumetric',
  cameraMode: 'orthographic',
  cameraCommand: { kind: 'reset', preset: 'iso', focusPoint: null, nonce: 0 },
  paused: false,
  debugMode: false,
  showStationLabels: true,
  showSectionLabels: true,
  showFlowParticles: true,
  showTempColors: true,
  showVelocityVectors: false,

  selectedStation: null,
  selectedSection: null,

  setInputs: (partial) => {
    const inputs = { ...get().inputs, ...partial };
    // Recompute the displayed state at the CURRENT (lagged) dynamic state, so
    // moving the throttle changes the *targets* without teleporting the engine;
    // the spools/temperatures then chase those targets over the next ticks.
    // Flight-condition changes (altitude/Mach) still take effect immediately.
    set({ inputs, engine: computeEngineState(inputs, get().config, get().spool) });
  },
  setThrottle: (v) => get().setInputs({ throttle: clamp(v, 0, 100) }),
  setAltitude: (v) => get().setInputs({ altitudeFt: clamp(v, 0, 40000) }),
  setMach: (v) => get().setInputs({ mach: clamp(v, 0, 0.85) }),
  setIsaOffset: (v) => get().setInputs({ isaTempOffsetC: clamp(v, -20, 20) }),

  tick: (dt) => {
    const { paused, spool, engine, inputs, config: cfg } = get();
    if (paused) return;
    const dtClamped = clamp(dt, 0, 0.1); // guard against tab-switch hitches
    // Integrate the slow states (spools + hot-section temp) toward their
    // targets, then re-evaluate the whole cycle at the new dynamic state. This
    // is what makes pressures, flows, temperatures and thrust evolve gradually.
    const nextSpool = advanceSpools(spool, engine.targetN1, engine.targetN2, engine.tt4Steady, dtClamped, cfg);
    const nextEngine = computeEngineState(inputs, cfg, nextSpool);
    const penalty = transientSurgePenalty(nextEngine.targetN2, nextSpool.n2);
    const surgeMargin = clamp(nextEngine.surgeMarginSteady - penalty, 0, 100);
    set({ spool: nextSpool, engine: nextEngine, surgeMargin, transientActive: penalty > 8 });
  },

  setViewMode: (m) => set({ viewMode: m }),
  setExhaustStyle: (s) => set({ exhaustStyle: s }),
  setCameraMode: (m) => set({ cameraMode: m }),
  setCameraPreset: (p) =>
    set((s) => ({
      cameraCommand: { kind: 'preset', preset: p, focusPoint: null, nonce: s.cameraCommand.nonce + 1 },
    })),
  focusOn: (point) =>
    set((s) => ({
      cameraCommand: { kind: 'focus', preset: s.cameraCommand.preset, focusPoint: point, nonce: s.cameraCommand.nonce + 1 },
    })),
  resetCamera: () =>
    set((s) => ({
      cameraCommand: { kind: 'reset', preset: 'iso', focusPoint: null, nonce: s.cameraCommand.nonce + 1 },
    })),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  toggleDebug: () => set((s) => ({ debugMode: !s.debugMode })),
  toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SimStore>),

  selectStation: (id) => set({ selectedStation: id, selectedSection: null }),
  selectSection: (id) => set({ selectedSection: id, selectedStation: null }),

  resetToTakeoff: () => {
    // Snap the dynamic state to the settled takeoff point (no spool-up wait).
    const spool = equilibriumDynamics(TAKEOFF_INPUTS, get().config);
    const engine = computeEngineState(TAKEOFF_INPUTS, get().config, spool);
    set({ inputs: TAKEOFF_INPUTS, engine, spool, surgeMargin: engine.surgeMarginSteady });
  },
  resetToCruise: () => {
    const spool = equilibriumDynamics(CRUISE_INPUTS, get().config);
    const engine = computeEngineState(CRUISE_INPUTS, get().config, spool);
    set({ inputs: CRUISE_INPUTS, engine, spool, surgeMargin: engine.surgeMarginSteady });
  },
}));

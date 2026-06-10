/**
 * Central application state (Zustand).
 *
 * Holds: the user inputs, the recomputed steady-state engine solution, the
 * live (animated) spool state, the engine start/shutdown sequence, and all
 * view/UI toggles. Components subscribe to just the slices they need, so a
 * slider re-render never forces the 3D scene to rebuild.
 *
 * The engine boots COLD AND DARK. Two regimes share the tick:
 *  • Sub-idle (off/start/shutdown): startSequence.ts integrates the spools
 *    from a starter/combustion/drag torque balance and owns the displayed
 *    fuel flow + EGT (the EEC schedule).
 *  • Running (at/above idle): the classic first-order spool lags chase the
 *    throttle-commanded targets (spoolDynamics.ts).
 */
import { create } from 'zustand';
import { computeEngineState, equilibriumDynamics } from '../sim/engineModel';
import { advanceSpools, transientSurgePenalty } from '../sim/spoolDynamics';
import {
  advanceStartSequence,
  beginShutdown,
  createOffSequence,
  createRunningSequence,
  isSequenceActive,
  type StartControls,
  type StartSequenceState,
} from '../sim/startSequence';
import { defaultEngineConfig } from '../data/defaultEngineConfig';
import type { EngineConfig, EngineInputs, EngineState, SpoolState, StationId } from '../sim/types';
import { clamp } from '../sim/units';

// --- View enums -----------------------------------------------------------
export type ViewMode = 'full' | 'transparent' | 'cutaway' | 'exploded';
export type CameraMode = 'orthographic' | 'perspective';
/** Exhaust rendering style: realistic translucent gas vs. dramatic bright plume. */
export type ExhaustStyle = 'volumetric' | 'shader';
export type CameraPreset = 'iso' | 'fan' | 'compressor' | 'combustor' | 'exhaust' | 'top';

export type StartSelectorPos = 'NORM' | 'START' | 'CON';
export type FuelControlPos = 'RUN' | 'CUTOFF';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  /** Orthographic zoom (px per scene unit). */
  zoom: number;
}

export interface CameraCommand {
  /** What kind of camera move was last requested. */
  kind: 'preset' | 'focus' | 'reset' | 'pose';
  preset: CameraPreset;
  /** Explicit target point (used by 'focus'); null means "use the preset's target". */
  focusPoint: [number, number, number] | null;
  /** Fully explicit camera placement (used by 'pose' — capture scripting). */
  pose?: CameraPose | null;
  /** Snap instantly instead of animating (deterministic captures/scripting). */
  instant?: boolean;
  /** Monotonic counter so effects re-run even when the target is unchanged. */
  nonce: number;
}

/** The values the cockpit gauges show, valid in BOTH regimes (start + running). */
export interface Instruments {
  n1Pct: number;
  n2Pct: number;
  n1Rpm: number;
  n2Rpm: number;
  egtC: number;
  fuelFlowKgs: number;
  oilPressurePsi: number;
}

const config: EngineConfig = defaultEngineConfig;

const INITIAL_INPUTS: EngineInputs = {
  throttle: 0,
  altitudeFt: 0,
  mach: 0,
  isaTempOffsetC: 0,
};

const TAKEOFF_INPUTS: EngineInputs = { throttle: 100, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };
const CRUISE_INPUTS: EngineInputs = { throttle: 85, altitudeFt: 35000, mach: 0.85, isaTempOffsetC: 0 };

/** APU bleed pressure when running [psi] (starter needs ≥ 25). */
const APU_BLEED_PSI = 38;

export interface SimStore {
  config: EngineConfig;

  // Physics
  inputs: EngineInputs;
  engine: EngineState;
  spool: SpoolState;
  /** Live surge margin (steady margin minus any throttle-transient penalty). */
  surgeMargin: number;
  transientActive: boolean;

  // Start sequence / engine controls (777-style)
  startSeq: StartSequenceState;
  startSelector: StartSelectorPos;
  fuelControl: FuelControlPos;
  autostart: boolean;
  apuRunning: boolean;
  apuBleedPsi: number;
  /** Training scenario: igniters spark but nothing lights (forces an autostart abort/retry). */
  igniterFailure: boolean;
  instruments: Instruments;

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
  soundEnabled: boolean;
  soundVolume: number;

  // Selection
  selectedStation: StationId | null;
  selectedSection: string | null;

  // --- Actions ---
  setInputs: (partial: Partial<EngineInputs>) => void;
  setThrottle: (v: number) => void;
  setAltitude: (v: number) => void;
  setMach: (v: number) => void;
  setIsaOffset: (v: number) => void;

  setStartSelector: (p: StartSelectorPos) => void;
  setFuelControl: (p: FuelControlPos) => void;
  setAutostart: (on: boolean) => void;
  setApuRunning: (on: boolean) => void;
  setIgniterFailure: (on: boolean) => void;

  tick: (dt: number) => void;

  setViewMode: (m: ViewMode) => void;
  setExhaustStyle: (s: ExhaustStyle) => void;
  setCameraMode: (m: CameraMode) => void;
  setCameraPreset: (p: CameraPreset) => void;
  /** Place the camera at a preset INSTANTLY (capture/scripting affordance). */
  snapCamera: (p: CameraPreset) => void;
  /** Place the camera at an arbitrary pose INSTANTLY (capture scripting). */
  poseCamera: (pose: CameraPose) => void;
  focusOn: (point: [number, number, number]) => void;
  resetCamera: () => void;
  togglePaused: () => void;
  toggleDebug: () => void;
  toggle: (key: ToggleKey) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSoundVolume: (volume: number) => void;

  selectStation: (id: StationId | null) => void;
  selectSection: (id: string | null) => void;

  resetToTakeoff: () => void;
  resetToCruise: () => void;
  resetToColdDark: () => void;
}

type ToggleKey =
  | 'showStationLabels'
  | 'showSectionLabels'
  | 'showFlowParticles'
  | 'showTempColors'
  | 'showVelocityVectors';

// Cold-and-dark boot state.
const initialSpool: SpoolState = { n1: 0, n2: 0, lpAngle: 0, hpAngle: 0, tt4: 288.15 };
const initialEngine = computeEngineState(INITIAL_INPUTS, config, initialSpool);
const initialSeq = createOffSequence(15);

function buildInstruments(
  cfg: EngineConfig,
  spool: SpoolState,
  engine: EngineState,
  seq: StartSequenceState,
): Instruments {
  const subIdle = isSequenceActive(seq.runState);
  return {
    n1Pct: spool.n1 * 100,
    n2Pct: spool.n2 * 100,
    n1Rpm: spool.n1 * cfg.n1RatedRpm,
    n2Rpm: spool.n2 * cfg.n2RatedRpm,
    // Below idle the EEC schedule owns FF and the lagged start EGT is the truth;
    // at/above idle the thermodynamic cycle's values take over (they're
    // calibrated to meet at the idle point, so the gauges never jump).
    egtC: subIdle ? seq.egtC : engine.egtC,
    fuelFlowKgs: subIdle ? seq.fuelFlow : engine.fuelFlow,
    oilPressurePsi: seq.oilPressurePsi,
  };
}

export const useSimStore = create<SimStore>((set, get) => ({
  config,

  inputs: INITIAL_INPUTS,
  engine: initialEngine,
  spool: initialSpool,
  surgeMargin: initialEngine.surgeMarginSteady,
  transientActive: false,

  startSeq: initialSeq,
  startSelector: 'NORM',
  fuelControl: 'CUTOFF',
  autostart: true,
  apuRunning: false,
  apuBleedPsi: 0,
  igniterFailure: false,
  instruments: buildInstruments(config, initialSpool, initialEngine, initialSeq),

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
  soundEnabled: false,
  soundVolume: 0.55,

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

  setStartSelector: (p) => set({ startSelector: p }),
  setFuelControl: (p) => set({ fuelControl: p }),
  setAutostart: (on) => set({ autostart: on }),
  setApuRunning: (on) => set({ apuRunning: on }),
  setIgniterFailure: (on) => set({ igniterFailure: on }),

  tick: (dt) => {
    const state = get();
    if (state.paused) return;
    const dtClamped = clamp(dt, 0, 0.1); // guard against tab-switch hitches
    const cfg = state.config;

    // APU bleed pressure spools up/down over ~10 s.
    const bleedTarget = state.apuRunning ? APU_BLEED_PSI : 0;
    const apuBleedPsi =
      state.apuBleedPsi + (bleedTarget - state.apuBleedPsi) * (1 - Math.exp(-dtClamped / 4));

    let seq = state.startSeq;

    // A fuel chop while running hands the spools back to the sequence.
    if (seq.runState === 'running' && state.fuelControl === 'CUTOFF') {
      seq = beginShutdown(seq);
    }

    if (seq.runState === 'running') {
      // --- Running regime: first-order lags toward the throttle targets. ---
      const nextSpool = advanceSpools(
        state.spool,
        state.engine.targetN1,
        state.engine.targetN2,
        state.engine.tt4Steady,
        dtClamped,
        cfg,
      );
      const nextEngine = computeEngineState(state.inputs, cfg, nextSpool);
      const penalty = transientSurgePenalty(nextEngine.targetN2, nextSpool.n2);
      const surgeMargin = clamp(nextEngine.surgeMarginSteady - penalty, 0, 100);
      // Keep the sequence's thermal state synced so a future shutdown starts
      // from the real EGT (no gauge jump at the CUTOFF moment).
      const syncedSeq: StartSequenceState =
        seq.egtC === nextEngine.egtC && seq.fuelFlow === nextEngine.fuelFlow
          ? seq
          : { ...seq, egtC: nextEngine.egtC, fuelFlow: nextEngine.fuelFlow, oilPressurePsi: 10 + 120 * Math.pow(nextSpool.n2, 1.3) };
      set({
        spool: nextSpool,
        engine: nextEngine,
        surgeMargin,
        transientActive: penalty > 4,
        apuBleedPsi,
        startSeq: syncedSeq,
        instruments: buildInstruments(cfg, nextSpool, nextEngine, syncedSeq),
      });
      return;
    }

    // --- Sub-idle regime: the start/shutdown sequence owns the spools. ---
    const controls: StartControls = {
      startSelector: state.startSelector,
      fuelControl: state.fuelControl,
      autostart: state.autostart,
      bleedPsi: apuBleedPsi,
      igniterFailure: state.igniterFailure,
    };
    const { seq: nextSeq, spool: nextSpool } = advanceStartSequence(
      seq,
      state.spool,
      controls,
      state.inputs,
      cfg,
      dtClamped,
    );
    const nextEngine = computeEngineState(state.inputs, cfg, nextSpool);
    // The EEC releases the latched START selector at starter cutout.
    const startSelector =
      nextSeq.selectorRelease && state.startSelector === 'START' ? 'NORM' : state.startSelector;
    set({
      spool: nextSpool,
      engine: nextEngine,
      surgeMargin: nextEngine.surgeMarginSteady,
      transientActive: false,
      apuBleedPsi,
      startSeq: nextSeq,
      startSelector,
      instruments: buildInstruments(cfg, nextSpool, nextEngine, nextSeq),
    });
  },

  setViewMode: (m) => set({ viewMode: m }),
  setExhaustStyle: (s) => set({ exhaustStyle: s }),
  setCameraMode: (m) => set({ cameraMode: m }),
  setCameraPreset: (p) =>
    set((s) => ({
      cameraCommand: { kind: 'preset', preset: p, focusPoint: null, nonce: s.cameraCommand.nonce + 1 },
    })),
  snapCamera: (p) =>
    set((s) => ({
      cameraCommand: { kind: 'preset', preset: p, focusPoint: null, instant: true, nonce: s.cameraCommand.nonce + 1 },
    })),
  poseCamera: (pose) =>
    set((s) => ({
      cameraCommand: {
        kind: 'pose',
        preset: s.cameraCommand.preset,
        focusPoint: null,
        pose,
        instant: true,
        nonce: s.cameraCommand.nonce + 1,
      },
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
  setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
  setSoundVolume: (volume) => set({ soundVolume: clamp(volume, 0, 1) }),

  selectStation: (id) => set({ selectedStation: id, selectedSection: null }),
  selectSection: (id) => set({ selectedSection: id, selectedStation: null }),

  resetToTakeoff: () => {
    // Snap the dynamic state to the settled takeoff point (no spool-up wait).
    const spool = equilibriumDynamics(TAKEOFF_INPUTS, get().config);
    const engine = computeEngineState(TAKEOFF_INPUTS, get().config, spool);
    const startSeq = createRunningSequence(engine.egtC);
    set({
      inputs: TAKEOFF_INPUTS,
      engine,
      spool,
      surgeMargin: engine.surgeMarginSteady,
      startSeq,
      fuelControl: 'RUN',
      startSelector: 'NORM',
      instruments: buildInstruments(get().config, spool, engine, startSeq),
    });
  },
  resetToCruise: () => {
    const spool = equilibriumDynamics(CRUISE_INPUTS, get().config);
    const engine = computeEngineState(CRUISE_INPUTS, get().config, spool);
    const startSeq = createRunningSequence(engine.egtC);
    set({
      inputs: CRUISE_INPUTS,
      engine,
      spool,
      surgeMargin: engine.surgeMarginSteady,
      startSeq,
      fuelControl: 'RUN',
      startSelector: 'NORM',
      instruments: buildInstruments(get().config, spool, engine, startSeq),
    });
  },
  resetToColdDark: () => {
    const spool: SpoolState = { n1: 0, n2: 0, lpAngle: 0, hpAngle: 0, tt4: 288.15 };
    const inputs = { ...get().inputs, throttle: 0 };
    const engine = computeEngineState(inputs, get().config, spool);
    const startSeq = createOffSequence(15);
    set({
      inputs,
      engine,
      spool,
      surgeMargin: engine.surgeMarginSteady,
      startSeq,
      fuelControl: 'CUTOFF',
      startSelector: 'NORM',
      apuRunning: false,
      apuBleedPsi: 0,
      instruments: buildInstruments(get().config, spool, engine, startSeq),
    });
  },
}));

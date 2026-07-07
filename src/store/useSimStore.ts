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
import { computeActuation, type ActuationState } from '../sim/actuation';
import {
  advanceStartSequence,
  beginShutdown,
  createOffSequence,
  createRunningSequence,
  isSequenceActive,
  BLEED_MIN_PSI,
  STARTER_REENGAGE_MAX_N2,
  type StartControls,
  type StartSequenceState,
} from '../sim/startSequence';
import { defaultEngineConfig } from '../data/defaultEngineConfig';
import type { EngineConfig, EngineInputs, EngineState, SpoolState, StationId } from '../sim/types';
import { clamp } from '../sim/units';

// --- View enums -----------------------------------------------------------
export type ViewMode = 'full' | 'transparent' | 'cutaway' | 'exploded' | 'internals';

/**
 * Independently toggleable 3D system layers. Each is AND-gated with the
 * view-mode logic at its render site: a layer turned OFF hides that system in
 * every mode, and all-ON reproduces the classic modes exactly. Selecting a
 * view mode resets every layer ON (the modes act as presets a user then
 * subtracts from — "show me just the fuel system" style).
 */
export const LAYER_IDS = [
  'nacelle',
  'structure',
  'rotors',
  'stators',
  'combustor',
  'nozzles',
  'bearings',
  'accessoryDrive',
  'fuelSystem',
  'airBleed',
  'electrical',
  'caseDetail',
] as const;
export type LayerId = (typeof LAYER_IDS)[number];
export type LayersState = Record<LayerId, boolean>;

/** Human labels for the layers panel (kept beside the ids so they never drift). */
export const LAYER_LABELS: Record<LayerId, string> = {
  nacelle: 'Nacelle & casings',
  structure: 'Structural struts',
  rotors: 'Rotating assemblies',
  stators: 'Stators & vanes',
  combustor: 'Combustor & flame',
  nozzles: 'Exhaust nozzles',
  bearings: 'Bearings',
  accessoryDrive: 'Accessory drive',
  fuelSystem: 'Fuel & ignition',
  airBleed: 'Air & bleed (VSV/VBV)',
  electrical: 'Electrical & FADEC',
  caseDetail: 'Case detail (flanges, bolts)',
};

const allLayersOn = (): LayersState =>
  Object.fromEntries(LAYER_IDS.map((id) => [id, true])) as LayersState;
export type CameraMode = 'orthographic' | 'perspective';
/** Exhaust rendering style: realistic translucent gas vs. dramatic bright plume. */
export type ExhaustStyle = 'volumetric' | 'shader';
export type CameraPreset =
  | 'iso' | 'fan' | 'compressor' | 'combustor' | 'exhaust' | 'top'
  // Cinematic beauty poses — composed for the perspective camera.
  | 'hero' | 'intake' | 'exhaust-low';

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
  /** One-touch autostart macro in progress (orchestrated inside tick). */
  autoStartActive: boolean;
  apuRunning: boolean;
  apuBleedPsi: number;
  /** Training scenario: igniters spark but nothing lights (forces an autostart abort/retry). */
  igniterFailure: boolean;
  instruments: Instruments;
  /** FADEC variable-geometry positions (VSV/VBV) — single source of truth for
   *  the 3D hardware, the audio, and any gauges. Computed each tick from N2. */
  actuation: ActuationState;

  // View / UI toggles
  viewMode: ViewMode;
  /** Per-system 3D visibility, AND-gated with the view-mode logic. */
  layers: LayersState;
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
  /** Presentation mode: overlays + floor grid hidden AT THEIR RENDER SITES,
   *  side panels collapsed to hover-reveal edge tabs (CSS `is-presentation`),
   *  perspective projection forced. The individual show* overlay booleans are
   *  deliberately left untouched so the user's choices survive a round trip. */
  presentationMode: boolean;
  /** Projection to restore when presentation mode is toggled back off. */
  presentationReturnCameraMode: CameraMode;

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
  /** Kick off the one-touch autostart procedure (APU → bleed → crank → idle). */
  runAutostart: () => void;
  setApuRunning: (on: boolean) => void;
  setIgniterFailure: (on: boolean) => void;

  tick: (dt: number) => void;

  setViewMode: (m: ViewMode) => void;
  toggleLayer: (id: LayerId) => void;
  setAllLayers: (on: boolean) => void;
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
  setPresentationMode: (on: boolean) => void;

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
  autoStartActive: false,
  apuRunning: false,
  apuBleedPsi: 0,
  igniterFailure: false,
  instruments: buildInstruments(config, initialSpool, initialEngine, initialSeq),
  actuation: computeActuation(initialSpool.n2),

  viewMode: 'cutaway',
  layers: allLayersOn(),
  exhaustStyle: 'shader', // 'Dramatic' bright plume by default
  cameraMode: 'orthographic',
  cameraCommand: { kind: 'reset', preset: 'iso', focusPoint: null, nonce: 0 },
  paused: false,
  debugMode: false,
  showStationLabels: true,
  showSectionLabels: true,
  showFlowParticles: true,
  showTempColors: true,
  showVelocityVectors: false,
  // Sound defaults ON; the actual AudioContext can only start after the first
  // user gesture (browser autoplay policy), which EngineAudio arms on mount.
  soundEnabled: true,
  soundVolume: 0.55,
  presentationMode: false,
  presentationReturnCameraMode: 'orthographic',

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
  // One-touch start: arm the EEC + spin up the APU, then let the tick
  // orchestration command START/RUN once bleed pressure is up and carry the
  // engine all the way to idle. No-op if it's already running.
  runAutostart: () => {
    if (get().startSeq.runState === 'running') return;
    set({ autoStartActive: true, autostart: true, apuRunning: true });
  },
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
        autoStartActive: false, // reached idle/running — macro is done
        instruments: buildInstruments(cfg, nextSpool, nextEngine, syncedSeq),
        // Pass the commanded N2 so a throttle chop transiently re-opens the
        // VBVs (booster-stall protection) while the core is still spinning down.
        actuation: computeActuation(nextSpool.n2, nextEngine.targetN2),
      });
      return;
    }

    // --- One-touch autostart orchestration --------------------------------
    // runAutostart() turned on the APU + armed the EEC; here we WAIT for bleed
    // pressure to build, then command START + RUN. Selecting START dry (bleed
    // < 25 psi) would trip a noBleed abort and spring the selector back, which
    // is exactly why a true one-click start has to be sequenced, not mashed.
    // Once cranking, the EEC owns the rest; we just clear the flag at idle
    // (success) or when it falls back to off after exhausting its retries.
    let cmdSelector = state.startSelector;
    let cmdFuel = state.fuelControl;
    let autoStartActive = state.autoStartActive;
    if (autoStartActive) {
      const stalled = seq.runState === 'off' || seq.runState === 'spooldown';
      if (
        stalled &&
        cmdSelector !== 'START' &&
        apuBleedPsi >= BLEED_MIN_PSI &&
        state.spool.n2 <= STARTER_REENGAGE_MAX_N2
      ) {
        cmdSelector = 'START';
        cmdFuel = 'RUN';
      }
    }

    // --- Sub-idle regime: the start/shutdown sequence owns the spools. ---
    const controls: StartControls = {
      startSelector: cmdSelector,
      fuelControl: cmdFuel,
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
      nextSeq.selectorRelease && cmdSelector === 'START' ? 'NORM' : cmdSelector;

    if (autoStartActive) {
      if (nextSeq.runState === 'running') autoStartActive = false; // idle handoff
      else if (nextSeq.fault && nextSeq.runState === 'off') autoStartActive = false; // gave up
    }

    set({
      spool: nextSpool,
      engine: nextEngine,
      surgeMargin: nextEngine.surgeMarginSteady,
      transientActive: false,
      apuBleedPsi,
      startSeq: nextSeq,
      startSelector,
      fuelControl: cmdFuel,
      autoStartActive,
      instruments: buildInstruments(cfg, nextSpool, nextEngine, nextSeq),
      actuation: computeActuation(nextSpool.n2),
    });
  },

  // Selecting a mode resets the layers — the modes are presets users subtract from.
  setViewMode: (m) => set({ viewMode: m, layers: allLayersOn() }),
  toggleLayer: (id) =>
    set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
  setAllLayers: (on) =>
    set(() => ({
      layers: Object.fromEntries(LAYER_IDS.map((id) => [id, on])) as LayersState,
    })),
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
  setPresentationMode: (on) =>
    set((s) => {
      if (on === s.presentationMode) return {};
      if (on) {
        // Remember the user's projection, force perspective (cinematic), and
        // fly to the hero pose so entering the mode is itself a camera beat.
        // The show* overlay toggles are NOT touched — components gate on
        // presentationMode at their render sites, so the user's overlay
        // choices survive a round trip through presentation mode.
        return {
          presentationMode: true,
          presentationReturnCameraMode: s.cameraMode,
          cameraMode: 'perspective',
          cameraCommand: {
            kind: 'preset',
            preset: 'hero',
            focusPoint: null,
            nonce: s.cameraCommand.nonce + 1,
          },
        };
      }
      // Restore the projection; leave the camera where the presenter put it.
      return { presentationMode: false, cameraMode: s.presentationReturnCameraMode };
    }),

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
      actuation: computeActuation(spool.n2),
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
      actuation: computeActuation(spool.n2),
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
      autoStartActive: false,
      instruments: buildInstruments(get().config, spool, engine, startSeq),
      actuation: computeActuation(spool.n2),
    });
  },
}));

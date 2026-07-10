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
import { advanceSpools, advanceSpoolsTorque, transientSurgePenalty } from '../sim/spoolDynamics';
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
import {
  advanceRud,
  createRudState,
  pullRudFireHandle,
  RUD_FLAMEOUT_T,
  type RudState,
  type RudVariant,
} from '../sim/rudEvent';
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

/**
 * Audience tiers — progressive disclosure of the UI:
 *  'explore'     high-school / museum: 3D + throttle + start + EICAS, no charts
 *  'course'      college propulsion: + readouts, charts, compressor map, trends
 *  'engineering' practicing engineers: everything (incl. future dev panels)
 * The 3D scene itself is never gated — only the analytical panel density.
 */
export type LearningMode = 'explore' | 'course' | 'engineering';
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
  /** Training scenario: VBV doors failed CLOSED — the booster can't dump air
   *  at low N2, so surge margin collapses where the doors should be open.
   *  Accelerate hard from idle and the compressor WILL surge. */
  vbvFailClosed: boolean;
  /** Live surge event (bang, thrust oscillation, EGT spike, EICAS latch). */
  surgeActive: boolean;
  /** Seconds since surge onset (drives the decaying oscillation). */
  surgeT: number;
  /** Seconds since a bird strike (null = none): thrust ripple + EGT spike +
   *  vibration caution, decaying over ~30 s as the debris clears. */
  birdStrikeT: number | null;
  /** Catastrophic failure (fan blade off / uncontained disk burst) — null
   *  while the engine is intact. While set, the event OWNS the spools and
   *  gauges; only the scenario resets clear it (no in-flight repair). */
  rud: RudState | null;
  /** Service age 0–1: blade erosion + deposits. An old engine makes the same
   *  thrust HOTTER — this eats the EGT margin exactly like real time-on-wing. */
  deterioration: number;
  instruments: Instruments;
  /** FADEC variable-geometry positions (VSV/VBV) — single source of truth for
   *  the 3D hardware, the audio, and any gauges. Computed each tick from N2. */
  actuation: ActuationState;

  // View / UI toggles
  viewMode: ViewMode;
  /** Per-system 3D visibility, AND-gated with the view-mode logic. */
  layers: LayersState;
  /** Audience tier (progressive disclosure of the analytical panels). */
  learningMode: LearningMode;
  /**
   * Above-idle spool integrator: 'torque' = temperature-surplus torque balance
   * (Tt4 is a real state in the loop; the spool visibly accelerates);
   * 'lag' = the classic first-order lags (legacy fallback).
   */
  spoolModel: 'torque' | 'lag';
  /**
   * Section cut: a single renderer-level clipping plane (applies to every
   * material — no per-material wiring). Axis picks the cut orientation
   * (x = transverse disc, y = horizontal, z = the classic vertical
   * half-section), offset slides it along that axis, flip keeps the other
   * side. Composes freely with view modes and layers.
   */
  sectionCut: { enabled: boolean; axis: 'x' | 'y' | 'z'; offset: number; flip: boolean };
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
  /** Secondary flows: oil circuit, VBV dump air, HPT cooling air. */
  showSecondaryFlows: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  /** Presentation mode: overlays hidden AT THEIR RENDER SITES, side panels
   *  collapsed to hover-reveal edge tabs (CSS `is-presentation`), perspective
   *  projection forced. The individual show* overlay booleans are deliberately
   *  left untouched so the user's choices survive a round trip. */
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
  setVbvFailClosed: (on: boolean) => void;
  /** Inject a bird strike NOW (running engine only; self-clears in ~30 s). */
  triggerBirdStrike: () => void;
  /** Release a fan blade ('fbo') or burst a rotor disk ('burst') NOW —
   *  running engine only; permanent until a scenario reset. */
  triggerRud: (variant: RudVariant) => void;
  /** Pull the ENG FIRE handle: fuel + hydraulics shut off, bottle armed. */
  pullFireHandle: () => void;
  setDeterioration: (frac: number) => void;

  tick: (dt: number) => void;

  setViewMode: (m: ViewMode) => void;
  toggleLayer: (id: LayerId) => void;
  setAllLayers: (on: boolean) => void;
  setLearningMode: (m: LearningMode) => void;
  setSpoolModel: (m: 'torque' | 'lag') => void;
  setSectionCut: (partial: Partial<{ enabled: boolean; axis: 'x' | 'y' | 'z'; offset: number; flip: boolean }>) => void;
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
  | 'showVelocityVectors'
  | 'showSecondaryFlows';

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
  vbvFailClosed: false,
  surgeActive: false,
  surgeT: 0,
  birdStrikeT: null,
  rud: null,
  deterioration: 0,
  instruments: buildInstruments(config, initialSpool, initialEngine, initialSeq),
  actuation: computeActuation(initialSpool.n2),

  viewMode: 'cutaway',
  layers: allLayersOn(),
  // Engineering by default: existing users keep the full panel set; the
  // audience picker makes the lighter tiers discoverable.
  learningMode: 'engineering',
  spoolModel: 'torque',
  sectionCut: { enabled: false, axis: 'z', offset: 0, flip: false },
  exhaustStyle: 'shader', // 'Dramatic' bright plume by default
  cameraMode: 'orthographic',
  cameraCommand: { kind: 'reset', preset: 'iso', focusPoint: null, nonce: 0 },
  paused: false,
  debugMode: false,
  // Off by default for a clean opening view; both re-enable from the overlay
  // toggles in ControlPanel ("Station labels" / "Section labels").
  showStationLabels: false,
  showSectionLabels: false,
  showFlowParticles: true,
  showTempColors: true,
  showVelocityVectors: false,
  // On by default: the oil circuit / VBV dump / cooling-air runs are the
  // teaching payoff of the externals layer (owner request 2026-07).
  showSecondaryFlows: true,
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
  setVbvFailClosed: (on) => set({ vbvFailClosed: on, surgeActive: false, surgeT: 0 }),
  triggerBirdStrike: () =>
    set((s) => (s.startSeq.runState === 'running' ? { birdStrikeT: 0 } : {})),
  triggerRud: (variant) =>
    set((s) =>
      s.startSeq.runState === 'running' && !s.rud
        ? {
            rud: createRudState(
              variant,
              s.spool,
              s.engine.egtC,
              // Same oil-pressure law the running branch feeds the gauges.
              10 + 120 * Math.pow(s.spool.n2, 1.3),
              s.inputs.mach,
              s.engine.netThrust,
            ),
          }
        : {},
    ),
  pullFireHandle: () =>
    set((s) => (s.rud ? { rud: pullRudFireHandle(s.rud), fuelControl: 'CUTOFF' } : {})),
  setDeterioration: (frac) => set({ deterioration: clamp(frac, 0, 1) }),

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

    // --- Catastrophic failure: the RUD event owns the engine entirely. -----
    // Runs BEFORE the fuel-chop handoff (pulling the fire handle sets CUTOFF,
    // but a destroyed engine never returns to the start sequence) and before
    // both regimes — normal spool dynamics are meaningless mid-event.
    if (state.rud) {
      const rud = advanceRud(state.rud, dtClamped);
      const lpOmega = rud.n1 * cfg.n1RatedRpm * ((Math.PI * 2) / 60);
      const hpOmega = rud.n2 * cfg.n2RatedRpm * ((Math.PI * 2) / 60);
      const nextSpool: SpoolState = {
        ...state.spool,
        n1: rud.n1,
        n2: rud.n2,
        lpAngle: state.spool.lpAngle + lpOmega * dtClamped,
        hpAngle: state.spool.hpAngle + hpOmega * dtClamped,
      };
      // Thermodynamic backdrop of a dead, windmilling engine (throttle to
      // idle); every gauge the event owns is overridden below.
      const base = computeEngineState({ ...state.inputs, throttle: 0 }, cfg, nextSpool);
      const flamedOut = rud.t >= RUD_FLAMEOUT_T[rud.variant];
      const engineOut: EngineState = {
        ...base,
        netThrust: rud.thrustAtRelease * rud.thrustFactor,
        coreThrust: 0,
        egtC: rud.egtC,
        fuelFlow: flamedOut || rud.fireHandlePulled ? 0 : base.fuelFlow,
        warnings: [
          {
            id: 'eng-fail',
            severity: 'critical',
            message:
              rud.variant === 'fbo'
                ? 'ENG FAIL — fan blade released; containment held'
                : 'ENG FAIL — uncontained rotor failure',
          },
          ...(rud.fire > 0.1
            ? [
                {
                  id: 'eng-fire',
                  severity: 'critical' as const,
                  message: 'ENG FIRE — pull the fire handle',
                },
              ]
            : []),
          ...(rud.oilPsi < 13
            ? [
                {
                  id: 'oil-press',
                  severity: 'caution' as const,
                  message: 'ENG OIL PRESS — oil system lost',
                },
              ]
            : []),
          ...(rud.vibe > 0.15
            ? [
                {
                  id: 'eng-vibration',
                  severity: 'caution' as const,
                  message: 'ENG VIBRATION — severe rotor imbalance',
                },
              ]
            : []),
        ],
      };
      // Reuse the surge machine for the cascade bangs (audio/flash/EICAS all
      // already listen to it); each forced pop decays like a natural one.
      let surgeActive = state.surgeActive;
      let surgeT = state.surgeT + dtClamped;
      if (rud.surgePop) {
        surgeActive = true;
        surgeT = 0;
      } else if (surgeActive && surgeT > 1.2) {
        surgeActive = false;
      }
      const syncedSeq: StartSequenceState = {
        ...seq,
        egtC: engineOut.egtC,
        fuelFlow: engineOut.fuelFlow,
        oilPressurePsi: rud.oilPsi,
      };
      set({
        rud,
        spool: nextSpool,
        engine: engineOut,
        surgeMargin: 0,
        surgeActive,
        surgeT,
        birdStrikeT: null,
        transientActive: false,
        apuBleedPsi,
        startSeq: syncedSeq,
        autoStartActive: false,
        instruments: buildInstruments(cfg, nextSpool, engineOut, syncedSeq),
        actuation: computeActuation(rud.n2),
      });
      return;
    }

    // A fuel chop while running hands the spools back to the sequence.
    if (seq.runState === 'running' && state.fuelControl === 'CUTOFF') {
      seq = beginShutdown(seq);
    }

    if (seq.runState === 'running') {
      // --- Running regime: torque balance (default) or the classic lags. ---
      const nextSpool =
        state.spoolModel === 'torque'
          ? advanceSpoolsTorque(
              state.spool,
              state.engine.targetN1,
              state.engine.targetN2,
              dtClamped,
              cfg,
              state.inputs.isaTempOffsetC,
            )
          : advanceSpools(
              state.spool,
              state.engine.targetN1,
              state.engine.targetN2,
              state.engine.tt4Steady,
              dtClamped,
              cfg,
            );
      const nextEngine = computeEngineState(state.inputs, cfg, nextSpool);
      const penalty = transientSurgePenalty(nextEngine.targetN2, nextSpool.n2);

      // --- Surge margin + surge event state machine -----------------------
      // Base margin = steady schedule − accel transient bite − the training
      // scenario where the VBV doors are failed CLOSED exactly where the
      // schedule wants them open (the classic way real compressors surge).
      // The stuck-door penalty has two PHYSICAL parts, neither keyed to the
      // lever: the steady door schedule at the current N2, plus a booster-
      // overfeed term that builds with the ACTUAL deceleration rate (the LP
      // side keeps delivering air the slowing core can't swallow). A chop
      // therefore surges seconds in — as the decel develops and N2 falls
      // into the door band — never at the instant the lever moves.
      const scheduled = computeActuation(nextSpool.n2, nextEngine.targetN2);
      const decelRate = Math.max(0, (state.spool.n2 - nextSpool.n2) / Math.max(dtClamped, 1e-6));
      // Fully developed by ~0.025/s N2 decay — the rate a committed chop
      // sustains through the door band under the torque model (measured).
      const decelOverfeed = clamp((decelRate - 0.005) / 0.02, 0, 1);
      const vbvStuckPenalty = state.vbvFailClosed
        ? computeActuation(nextSpool.n2).vbvOpenFrac * 25 + decelOverfeed * 12
        : 0;
      const surgeMargin = clamp(nextEngine.surgeMarginSteady - penalty - vbvStuckPenalty, -25, 100);

      // In this model the margin can only cross zero via the VBV failure
      // scenario (steady floor 21% vs max transient bite 18%) — an honest
      // limitation until deterioration/inlet-distortion effects land. The
      // event clears once the margin has been back above the line for a
      // couple of seconds, and RE-ARMS (fresh bang + pops) if the point is
      // still pinned past the line — a stuck-door compressor pops repeatedly.
      let surgeActive = state.surgeActive;
      let surgeT = state.surgeT + dtClamped;
      if (!surgeActive && surgeMargin <= 0) {
        surgeActive = true; // the line is crossed — BANG
        surgeT = 0;
      } else if (surgeActive && surgeMargin <= 0 && surgeT > 1.5) {
        surgeT = 0; // still past the line: the next pop of a repeating surge
      } else if (surgeActive && surgeMargin > 2 && surgeT > 2) {
        surgeActive = false;
      }

      // While surging: decaying ~1.6 Hz thrust pops + an EGT spike (reversed
      // flow re-ingests hot gas), plus the latched EICAS warning.
      let engineOut = nextEngine;
      if (surgeActive) {
        const pulse = Math.max(0, Math.sin(2 * Math.PI * 1.6 * surgeT));
        const damp = Math.exp(-surgeT / 2.5);
        const thrustFactor = 1 - 0.4 * damp * pulse;
        engineOut = {
          ...nextEngine,
          netThrust: nextEngine.netThrust * thrustFactor,
          coreThrust: nextEngine.coreThrust * thrustFactor,
          egtC: nextEngine.egtC + 70 * damp,
          warnings: [
            {
              id: 'eng-surge',
              severity: 'critical',
              message: 'ENG SURGE — compressor stall, airflow reversal in the core',
            },
            ...nextEngine.warnings,
          ],
        };
      }

      // EICAS surge-margin escalation must track the LIVE margin (the cycle
      // only knows the steady schedule, whose floor of ~21% would make the
      // <12/<7 warnings dead code against the transient and stuck-door
      // penalties the student actually sees on the map).
      {
        const kept = engineOut.warnings.filter(
          (w) => w.id !== 'surge-low' && w.id !== 'surge-critical',
        );
        if (!surgeActive && surgeMargin < 7) {
          kept.push({
            id: 'surge-critical',
            severity: 'critical',
            message: `Compressor surge margin critically low (${Math.round(surgeMargin)}%)`,
          });
        } else if (!surgeActive && surgeMargin < 12) {
          kept.push({
            id: 'surge-low',
            severity: 'caution',
            message: `Compressor surge margin low (${Math.round(surgeMargin)}%)`,
          });
        }
        if (kept.length !== engineOut.warnings.length || kept.some((w, i) => w !== engineOut.warnings[i])) {
          engineOut = { ...engineOut, warnings: kept };
        }
      }

      // --- Injected failures ----------------------------------------------
      // Bird strike: fan imbalance → rippling thrust + an EGT spike, decaying
      // over ~30 s as the debris clears; EICAS vibration caution while live.
      let birdStrikeT = state.birdStrikeT;
      if (birdStrikeT !== null) {
        birdStrikeT += dtClamped;
        if (birdStrikeT > 30) birdStrikeT = null;
      }
      if (birdStrikeT !== null) {
        const damp = Math.exp(-birdStrikeT / 9);
        const ripple = 1 - 0.12 * damp * (0.6 + 0.4 * Math.sin(2 * Math.PI * 2.3 * birdStrikeT));
        engineOut = {
          ...engineOut,
          netThrust: engineOut.netThrust * ripple,
          coreThrust: engineOut.coreThrust * ripple,
          egtC: engineOut.egtC + 55 * damp,
          warnings: [
            {
              id: 'eng-vibration',
              severity: 'caution',
              message: 'ENG VIBRATION — fan imbalance after foreign-object strike',
            },
            ...engineOut.warnings,
          ],
        };
      }
      // Service age: an eroded, deposit-coated engine makes the SAME thrust
      // hotter (the FADEC feeds more fuel to hold speed) — the classic
      // time-on-wing EGT-margin loss, up to +45 °C at full deterioration.
      if (state.deterioration > 0.001) {
        engineOut = { ...engineOut, egtC: engineOut.egtC + state.deterioration * 45 };
      }
      // The cycle's own EGT-limit warnings were built BEFORE these additions —
      // re-check the displayed value against the certified limits.
      if (
        engineOut.egtC > cfg.egtTakeoffLimitC &&
        !engineOut.warnings.some((w) => w.id === 'egt-redline')
      ) {
        engineOut = {
          ...engineOut,
          warnings: [
            {
              id: 'egt-redline',
              severity: 'critical',
              message: `EGT ${Math.round(engineOut.egtC)} °C exceeds the ${cfg.egtTakeoffLimitC} °C takeoff limit`,
            },
            ...engineOut.warnings,
          ],
        };
      } else if (
        engineOut.egtC > cfg.egtMaxContinuousC &&
        !engineOut.warnings.some((w) => w.id === 'egt-mct' || w.id === 'egt-redline')
      ) {
        engineOut = {
          ...engineOut,
          warnings: [
            {
              id: 'egt-mct',
              severity: 'caution',
              message: `EGT ${Math.round(engineOut.egtC)} °C above the ${cfg.egtMaxContinuousC} °C max-continuous limit (5-min takeoff window)`,
            },
            ...engineOut.warnings,
          ],
        };
      }

      // VBV command: failed-closed pins the doors — there is no healthy-door
      // surge path in this model, so no door-snap recovery branch exists.
      const actuation: ActuationState = state.vbvFailClosed
        ? { ...scheduled, vbvOpenFrac: 0 }
        : scheduled;

      // Keep the sequence's thermal state synced so a future shutdown starts
      // from the real EGT (no gauge jump at the CUTOFF moment).
      const syncedSeq: StartSequenceState =
        seq.egtC === engineOut.egtC && seq.fuelFlow === engineOut.fuelFlow
          ? seq
          : { ...seq, egtC: engineOut.egtC, fuelFlow: engineOut.fuelFlow, oilPressurePsi: 10 + 120 * Math.pow(nextSpool.n2, 1.3) };
      set({
        spool: nextSpool,
        engine: engineOut,
        surgeMargin,
        surgeActive,
        surgeT,
        birdStrikeT,
        transientActive: penalty > 4,
        apuBleedPsi,
        startSeq: syncedSeq,
        autoStartActive: false, // reached idle/running — macro is done
        instruments: buildInstruments(cfg, nextSpool, engineOut, syncedSeq),
        actuation,
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
      // Sub-idle surge is start-sequence territory — clear any latched event.
      surgeActive: false,
      surgeT: 0,
      birdStrikeT: null,
      transientActive: false,
      apuBleedPsi,
      startSeq: nextSeq,
      startSelector,
      fuelControl: cmdFuel,
      autoStartActive,
      instruments: buildInstruments(cfg, nextSpool, nextEngine, nextSeq),
      // The stuck-doors scenario must hold through the whole start too — the
      // sub-idle schedule would otherwise show the doors open (with the VBV
      // groan playing) for the exact hardware the scenario declares failed.
      actuation: state.vbvFailClosed
        ? { ...computeActuation(nextSpool.n2), vbvOpenFrac: 0 }
        : computeActuation(nextSpool.n2),
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
  setLearningMode: (m) => set({ learningMode: m }),
  setSpoolModel: (m) => set({ spoolModel: m }),
  setSectionCut: (partial) => set((s) => ({ sectionCut: { ...s.sectionCut, ...partial } })),
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
      surgeActive: false,
      surgeT: 0,
      birdStrikeT: null,
      rud: null,
      transientActive: false,
      startSeq,
      fuelControl: 'RUN',
      startSelector: 'NORM',
      instruments: buildInstruments(get().config, spool, engine, startSeq),
      actuation: get().vbvFailClosed
        ? { ...computeActuation(spool.n2), vbvOpenFrac: 0 }
        : computeActuation(spool.n2),
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
      surgeActive: false,
      surgeT: 0,
      birdStrikeT: null,
      rud: null,
      transientActive: false,
      startSeq,
      fuelControl: 'RUN',
      startSelector: 'NORM',
      instruments: buildInstruments(get().config, spool, engine, startSeq),
      actuation: get().vbvFailClosed
        ? { ...computeActuation(spool.n2), vbvOpenFrac: 0 }
        : computeActuation(spool.n2),
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
      surgeActive: false,
      surgeT: 0,
      birdStrikeT: null,
      rud: null,
      transientActive: false,
      startSeq,
      fuelControl: 'CUTOFF',
      startSelector: 'NORM',
      apuRunning: false,
      apuBleedPsi: 0,
      autoStartActive: false,
      instruments: buildInstruments(get().config, spool, engine, startSeq),
      actuation: get().vbvFailClosed
        ? { ...computeActuation(spool.n2), vbvOpenFrac: 0 }
        : computeActuation(spool.n2),
    });
  },
}));

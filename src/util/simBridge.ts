/**
 * simBridge — the deterministic scripting/capture API exposed on window.__sim.
 *
 * Purpose: let an automation tool (or a curious student in the console) put
 * the simulator into a NAMED, REPRODUCIBLE state and take a keyed screenshot
 * in one call — instead of fiddling with orbit/zoom and waiting for the right
 * moment. See .claude/CAPTURE.md for recipes.
 *
 * applyScenario() advances the start-sequence physics OFFLINE (fixed dt loop,
 * frame-rate independent), then installs the resulting state in the store; the
 * live render loop simply continues from there.
 */
import { useSimStore, type CameraPose, type CameraPreset } from '../store/useSimStore';
import {
  advanceStartSequence,
  beginShutdown,
  createOffSequence,
  type StartControls,
  type StartSequenceState,
} from '../sim/startSequence';
import { computeEngineState } from '../sim/engineModel';
import type { SpoolState } from '../sim/types';

export type ScenarioName =
  | 'off' // cold and dark
  | 'motoring' // dry crank, ~18% N2, oil pressure rising
  | 'lightoff' // flame just established, EGT jumping
  | 'accel' // mid-start, ~45% N2, EGT near its peak
  | 'idle' // start complete, stable ground idle
  | 'takeoff' // settled 100% throttle SLS
  | 'cruise' // settled 85% throttle, FL350 M0.85
  | 'shutdown'; // fuel just cut from idle, spooling down

const APU_CONTROLS: StartControls = {
  startSelector: 'START',
  fuelControl: 'RUN',
  autostart: true,
  bleedPsi: 38,
};

const GROUND = { throttle: 0, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };

/** Run the start sequence offline until `done` says stop (or 240 s pass). */
function advanceUntil(
  done: (seq: StartSequenceState, spool: SpoolState) => boolean,
  controls: StartControls = APU_CONTROLS,
  fromSeq?: StartSequenceState,
  fromSpool?: SpoolState,
): { seq: StartSequenceState; spool: SpoolState } {
  const cfg = useSimStore.getState().config;
  let seq = fromSeq ?? createOffSequence(15);
  let spool: SpoolState = fromSpool ?? { n1: 0, n2: 0, lpAngle: 0, hpAngle: 0, tt4: 288.15 };
  for (let t = 0; t < 240; t += 0.05) {
    if (done(seq, spool) || seq.runState === 'running') break;
    const r = advanceStartSequence(seq, spool, controls, GROUND, cfg, 0.05);
    seq = r.seq;
    spool = r.spool;
  }
  return { seq, spool };
}

/** Install a sub-idle sequence state into the live store. */
function installSequence(seq: StartSequenceState, spool: SpoolState): void {
  const s = useSimStore.getState();
  const inputs = { ...s.inputs, throttle: 0, altitudeFt: 0, mach: 0 };
  const engine = computeEngineState(inputs, s.config, spool);
  useSimStore.setState({
    inputs,
    spool,
    engine,
    startSeq: seq,
    apuRunning: true,
    apuBleedPsi: 38,
    startSelector: seq.starterAirValveOpen ? 'START' : 'NORM',
    fuelControl: seq.fuelValveOpen || seq.lit ? 'RUN' : 'CUTOFF',
  });
}

export function applyScenario(name: ScenarioName): void {
  const s = useSimStore.getState();
  switch (name) {
    case 'off':
      s.resetToColdDark();
      break;
    case 'motoring': {
      const r = advanceUntil((seq, spool) => seq.runState === 'motoring' && spool.n2 >= 0.17);
      installSequence(r.seq, r.spool);
      break;
    }
    case 'lightoff': {
      let sawLight = -1;
      const r = advanceUntil((seq) => {
        if (seq.lit && sawLight < 0) sawLight = seq.startElapsed;
        return sawLight > 0 && seq.startElapsed - sawLight > 1.5; // 1.5 s after light-off
      });
      installSequence(r.seq, r.spool);
      break;
    }
    case 'accel': {
      const r = advanceUntil((_, spool) => spool.n2 >= 0.45);
      installSequence(r.seq, r.spool);
      break;
    }
    case 'idle': {
      // Run the full start, then let the store's running regime take over.
      const r = advanceUntil(() => false); // runs until runState === 'running'
      installSequence(r.seq, r.spool);
      useSimStore.setState({ startSelector: 'NORM', fuelControl: 'RUN' });
      break;
    }
    case 'takeoff':
      s.resetToTakeoff();
      break;
    case 'cruise':
      s.resetToCruise();
      break;
    case 'shutdown': {
      // Start from settled idle, chop the fuel, coast 6 s in.
      const idleStart = advanceUntil(() => false);
      let seq = beginShutdown(idleStart.seq);
      let spool = idleStart.spool;
      const cfg = useSimStore.getState().config;
      const off: StartControls = { startSelector: 'NORM', fuelControl: 'CUTOFF', autostart: true, bleedPsi: 38 };
      for (let t = 0; t < 6; t += 0.05) {
        const r = advanceStartSequence(seq, spool, off, GROUND, cfg, 0.05);
        seq = r.seq;
        spool = r.spool;
      }
      installSequence(seq, spool);
      useSimStore.setState({ fuelControl: 'CUTOFF' });
      break;
    }
  }
}

export interface SimBridge {
  store: typeof useSimStore;
  applyScenario: (name: ScenarioName) => void;
  snapCamera: (preset: CameraPreset) => void;
  /** Arbitrary instant camera placement: position, target, ortho zoom. */
  poseCamera: (pose: CameraPose) => void;
  /** Set by CaptureBridge inside the Canvas once the GL context exists. */
  capture?: (opts?: { preset?: CameraPreset; scenario?: ScenarioName }) => Promise<string>;
}

declare global {
  interface Window {
    __sim?: SimBridge;
  }
}

/** Install the bridge (idempotent). Called from App. */
export function installSimBridge(): SimBridge {
  const bridge: SimBridge = window.__sim ?? {
    store: useSimStore,
    applyScenario,
    snapCamera: (p) => useSimStore.getState().snapCamera(p),
    poseCamera: (pose) => useSimStore.getState().poseCamera(pose),
  };
  window.__sim = bridge;
  return bridge;
}

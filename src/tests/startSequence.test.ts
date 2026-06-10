import { describe, it, expect } from 'vitest';
import {
  advanceStartSequence,
  beginShutdown,
  createOffSequence,
  createRunningSequence,
  type StartControls,
  type StartSequenceState,
} from '../sim/startSequence';
import { equilibriumDynamics, computeEngineState } from '../sim/engineModel';
import { defaultEngineConfig as cfg } from '../data/defaultEngineConfig';
import type { EngineInputs, SpoolState } from '../sim/types';

const ground: EngineInputs = { throttle: 0, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };
const coldSpool: SpoolState = { n1: 0, n2: 0, lpAngle: 0, hpAngle: 0, tt4: 288.15 };

const APU: StartControls = {
  startSelector: 'START',
  fuelControl: 'RUN',
  autostart: true,
  bleedPsi: 38,
};

interface TraceSample {
  t: number;
  n1: number;
  n2: number;
  egtC: number;
  fuelFlow: number;
  runState: string;
  starter: boolean;
  ignition: boolean;
}

/** Run the sequence for `seconds`, returning the final state plus a trace. */
function run(
  seq: StartSequenceState,
  spool: SpoolState,
  controls: StartControls | ((t: number, seq: StartSequenceState) => StartControls),
  seconds: number,
  inputs: EngineInputs = ground,
  dt = 0.05,
): { seq: StartSequenceState; spool: SpoolState; trace: TraceSample[] } {
  const trace: TraceSample[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const c = typeof controls === 'function' ? controls(t, seq) : controls;
    if (seq.runState === 'running') break; // handoff point — sequence done
    const r = advanceStartSequence(seq, spool, c, inputs, cfg, dt);
    seq = r.seq;
    spool = r.spool;
    trace.push({
      t,
      n1: spool.n1,
      n2: spool.n2,
      egtC: seq.egtC,
      fuelFlow: seq.fuelFlow,
      runState: seq.runState,
      starter: seq.starterEngaged,
      ignition: seq.ignitionOn,
    });
  }
  return { seq, spool, trace };
}

describe('autostart — normal ground start timeline (GE90/777 FCOM anchors)', () => {
  const { seq, spool, trace } = run(createOffSequence(15), coldSpool, APU, 180);

  it('reaches stable idle (RUNNING) in 50–110 s', () => {
    expect(seq.runState).toBe('running');
    const idleSample = trace[trace.length - 1];
    expect(idleSample.t).toBeGreaterThan(50);
    expect(idleSample.t).toBeLessThan(110);
  });

  it('introduces fuel near max motoring (~20–26% N2), not before', () => {
    const fuelOn = trace.find((s) => s.fuelFlow > 0.01)!;
    expect(fuelOn.n2).toBeGreaterThan(0.19);
    expect(fuelOn.n2).toBeLessThan(0.27);
    // Dry crank takes roughly 15–35 s to get there.
    expect(fuelOn.t).toBeGreaterThan(12);
    expect(fuelOn.t).toBeLessThan(40);
  });

  it('EGT rises after light-off, peaks ~500–700 °C (under the 750 °C limit), then settles', () => {
    const peak = Math.max(...trace.map((s) => s.egtC));
    expect(peak).toBeGreaterThan(480);
    expect(peak).toBeLessThan(cfg.egtStartLimitGroundC);
    // Settles near idle EGT at the end.
    const end = trace[trace.length - 1];
    expect(end.egtC).toBeGreaterThan(380);
    expect(end.egtC).toBeLessThan(520);
  });

  it('cuts ignition at ~56% N2 and the starter at ~63% N2 (near idle — GE90 behavior)', () => {
    const ignOff = trace.find((s) => s.n2 > 0.2 && !s.ignition && s.runState !== 'motoring')!;
    expect(ignOff.n2).toBeGreaterThan(0.54);
    const starterOff = trace.find((s) => s.n2 > 0.3 && !s.starter)!;
    expect(starterOff.n2).toBeGreaterThan(0.61);
    expect(starterOff.n2).toBeLessThan(0.67);
  });

  it('N1 is rotating well before 50% N2 and lags far behind during the crank', () => {
    const at50 = trace.find((s) => s.n2 >= 0.5)!;
    expect(at50.n1).toBeGreaterThan(0.02);
    expect(at50.n1).toBeLessThan(0.2);
    const at22 = trace.find((s) => s.n2 >= 0.22)!;
    expect(at22.n1).toBeLessThan(0.03); // fan barely turning during dry crank
  });

  it('hands off to the running regime continuously (idle N2, idle-ish EGT)', () => {
    expect(spool.n2).toBeGreaterThan(0.64);
    expect(spool.n2).toBeLessThan(0.68);
    const idleCycle = computeEngineState(ground, cfg, equilibriumDynamics(ground, cfg));
    expect(Math.abs(seq.egtC - idleCycle.egtC)).toBeLessThan(80); // no big gauge jump at handoff
  });
});

describe('shutdown and windmilling', () => {
  it('a fuel chop from idle stops the core in ~45–120 s; the fan keeps windmilling', () => {
    const idleEq = equilibriumDynamics(ground, cfg);
    let seq = beginShutdown(createRunningSequence(440));
    let spool: SpoolState = { ...idleEq };
    const off: StartControls = { startSelector: 'NORM', fuelControl: 'CUTOFF', autostart: true, bleedPsi: 0 };
    let coreStopT = -1;
    for (let t = 0; t < 240; t += 0.1) {
      const r = advanceStartSequence(seq, spool, off, ground, cfg, 0.1);
      seq = r.seq;
      spool = r.spool;
      if (coreStopT < 0 && spool.n2 < 0.03) coreStopT = t;
    }
    expect(coreStopT).toBeGreaterThan(45);
    expect(coreStopT).toBeLessThan(120);
    // After 4 minutes the fan should still be barely creeping or just stopped —
    // it outlives the core by minutes.
    expect(spool.n2).toBeLessThan(0.01);
  });

  it('in flight, the spools windmill instead of stopping after a flameout', () => {
    const flight: EngineInputs = { throttle: 0, altitudeFt: 30000, mach: 0.8, isaTempOffsetC: 0 };
    let seq = beginShutdown(createRunningSequence(440));
    let spool: SpoolState = { ...equilibriumDynamics(flight, cfg) };
    const off: StartControls = { startSelector: 'NORM', fuelControl: 'CUTOFF', autostart: true, bleedPsi: 0 };
    for (let t = 0; t < 240; t += 0.1) {
      const r = advanceStartSequence(seq, spool, off, flight, cfg, 0.1);
      seq = r.seq;
      spool = r.spool;
    }
    expect(spool.n1).toBeGreaterThan(0.15); // ram air keeps the fan turning
    expect(spool.n2).toBeGreaterThan(0.05);
  });
});

describe('start malfunctions', () => {
  it('manual start with fuel at 10% N2 (too early) runs MUCH hotter than a normal start', () => {
    // Manual mode: fuel + ignition come immediately with RUN [FCOM].
    const early = run(
      createOffSequence(15),
      coldSpool,
      (t, seq) => ({
        startSelector: seq.runState === 'off' || seq.runState === 'motoring' ? 'START' : 'NORM',
        fuelControl: seq.runState !== 'off' && t > 8 ? 'RUN' : 'CUTOFF', // ~10% N2
        autostart: false,
        bleedPsi: 38,
      }),
      60,
    );
    const normal = run(createOffSequence(15), coldSpool, APU, 180);
    const earlyPeak = Math.max(...early.trace.map((s) => s.egtC));
    const normalPeak = Math.max(...normal.trace.map((s) => s.egtC));
    expect(earlyPeak).toBeGreaterThan(normalPeak + 80);
  });

  it('no light-off (failed igniters) aborts within 20 s of fuel and retries with BOTH igniters', () => {
    const { seq, trace } = run(
      createOffSequence(15),
      coldSpool,
      { ...APU, igniterFailure: true },
      120,
    );
    // It must have latched a no-light fault at least once and escalated to BOTH.
    const sawAbort = trace.some((s) => s.runState === 'aborting');
    expect(sawAbort).toBe(true);
    expect(seq.activeIgniter).toBe('BOTH');
    expect(seq.attempt).toBeGreaterThanOrEqual(2);
    // Never lit — EGT stays cold.
    const peak = Math.max(...trace.map((s) => s.egtC));
    expect(peak).toBeLessThan(100);
  });

  it('refuses to engage the starter without bleed air (≥25 psi)', () => {
    const { seq, spool } = run(createOffSequence(15), coldSpool, { ...APU, bleedPsi: 10 }, 20);
    expect(spool.n2).toBeLessThan(0.01);
    expect(seq.fault?.kind).toBe('noBleed');
  });

  it('weak bleed (26 psi) still starts via max-motoring fuel introduction, hotter than normal', () => {
    const weak = run(createOffSequence(15), coldSpool, { ...APU, bleedPsi: 26 }, 240);
    // Start either completes or hot-aborts — both are realistic; if it completed,
    // the peak must have been hotter than a healthy start.
    if (weak.seq.runState === 'running') {
      const normal = run(createOffSequence(15), coldSpool, APU, 180);
      const weakPeak = Math.max(...weak.trace.map((s) => s.egtC));
      const normalPeak = Math.max(...normal.trace.map((s) => s.egtC));
      expect(weakPeak).toBeGreaterThan(normalPeak);
    } else {
      expect(weak.seq.fault).not.toBeNull();
    }
  });
});

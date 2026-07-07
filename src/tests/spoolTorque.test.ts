import { describe, expect, it } from 'vitest';
import {
  advanceSpoolsTorque,
  tt4Required,
} from '../sim/spoolDynamics';
import { commandedSpeeds } from '../sim/engineModel';
import { defaultEngineConfig as cfg } from '../data/defaultEngineConfig';
import type { SpoolState } from '../sim/types';

const DT = 0.05; // the same fixed test timestep the other dynamics tests use

const idleState = (): SpoolState => ({
  n1: cfg.idleN1,
  n2: cfg.idleN2,
  tt4: tt4Required(cfg.idleN2, cfg),
  lpAngle: 0,
  hpAngle: 0,
});

const run = (state: SpoolState, throttle: number, seconds: number): SpoolState[] => {
  const { targetN1, targetN2 } = commandedSpeeds({ throttle, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 }, cfg);
  const out: SpoolState[] = [];
  let s = state;
  for (let t = 0; t < seconds; t += DT) {
    s = advanceSpoolsTorque(s, targetN1, targetN2, DT, cfg);
    out.push(s);
  }
  return out;
};

describe('torque-balance spool dynamics', () => {
  it('settles at the SAME equilibrium the classic lag (and all anchors) use', () => {
    const trace = run(idleState(), 100, 60);
    const end = trace[trace.length - 1];
    expect(end.n2).toBeCloseTo(cfg.takeoffN2, 2);
    expect(end.n1).toBeCloseTo(cfg.takeoffN1, 2);
    expect(end.tt4).toBeCloseTo(tt4Required(cfg.takeoffN2, cfg), 0);
  });

  it('a full slam reaches 90% of the speed change in a realistic 5–15 s', () => {
    const trace = run(idleState(), 100, 30);
    const dN = cfg.takeoffN2 - cfg.idleN2;
    const i90 = trace.findIndex((s) => s.n2 >= cfg.idleN2 + 0.9 * dN);
    expect(i90).toBeGreaterThan(5 / DT);
    expect(i90).toBeLessThan(15 / DT);
  });

  it('temperature LEADS speed on a slam (torque builds first)', () => {
    const trace = run(idleState(), 100, 30);
    const early = trace[Math.round(1.5 / DT)];
    // 1.5 s in: Tt4 is already well above the value that merely holds the
    // current speed (that surplus IS the accelerating torque)…
    expect(early.tt4 - tt4Required(early.n2, cfg)).toBeGreaterThan(100);
    // …while the spool has barely started moving.
    expect(early.n2 - cfg.idleN2).toBeLessThan(0.35 * (cfg.takeoffN2 - cfg.idleN2));
  });

  it('never overspeeds past the redline region on a slam', () => {
    for (const s of run(idleState(), 100, 60)) {
      expect(s.n2).toBeLessThanOrEqual(cfg.takeoffN2 + 0.03 + 1e-9);
    }
  });

  it('a chop decelerates back to idle (fuel authority works both ways)', () => {
    // Settle at takeoff first…
    const takeoffEnd = run(idleState(), 100, 60).pop()!;
    // …then chop to idle.
    const trace = run(takeoffEnd, 0, 40);
    const end = trace[trace.length - 1];
    expect(end.n2).toBeCloseTo(cfg.idleN2, 1);
    // Governor floor: never sinks meaningfully below idle.
    for (const s of trace) expect(s.n2).toBeGreaterThanOrEqual(cfg.idleN2 * 0.985 - 1e-9);
  });

  it('stays finite and deterministic across the throttle range', () => {
    for (const throttle of [0, 25, 50, 75, 100]) {
      const a = run(idleState(), throttle, 20).pop()!;
      const b = run(idleState(), throttle, 20).pop()!;
      expect(Number.isFinite(a.n2 + a.n1 + a.tt4)).toBe(true);
      expect(a.n2).toBe(b.n2);
      expect(a.tt4).toBe(b.tt4);
    }
  });
});

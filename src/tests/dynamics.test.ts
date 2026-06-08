import { describe, it, expect } from 'vitest';
import { computeEngineState, equilibriumDynamics, commandedSpeeds } from '../sim/engineModel';
import { advanceSpools } from '../sim/spoolDynamics';
import { defaultEngineConfig as cfg } from '../data/defaultEngineConfig';
import type { EngineInputs, SpoolState } from '../sim/types';

const idle: EngineInputs = { throttle: 25, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };
const takeoff: EngineInputs = { throttle: 100, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };

/** Integrate the dynamic state forward `seconds` at a fixed throttle command. */
function simulate(start: SpoolState, inputs: EngineInputs, seconds: number, step = 0.1): SpoolState {
  let dyn = start;
  for (let t = 0; t < seconds; t += step) {
    const s = computeEngineState(inputs, cfg, dyn);
    dyn = advanceSpools(dyn, s.targetN1, s.targetN2, s.tt4Steady, step, cfg);
  }
  return dyn;
}

describe('transient dynamics', () => {
  it('commanded spool targets rise with throttle', () => {
    expect(commandedSpeeds(takeoff).targetN2).toBeGreaterThan(commandedSpeeds(idle).targetN2);
    expect(commandedSpeeds({ ...idle, throttle: 0 }).targetN2).toBeLessThan(0.02);
  });

  it('spools and temperature LAG a throttle slam (no instantaneous jump)', () => {
    const start = equilibriumDynamics(idle, cfg);
    const eqTakeoff = equilibriumDynamics(takeoff, cfg);

    // Command takeoff but integrate only 0.2 s.
    const s0 = computeEngineState(takeoff, cfg, start);
    const dyn = advanceSpools(start, s0.targetN1, s0.targetN2, s0.tt4Steady, 0.2, cfg);

    expect(dyn.n2).toBeGreaterThan(start.n2); // started moving
    expect(dyn.n2).toBeLessThan(eqTakeoff.n2 - 0.05); // nowhere near settled
    expect(dyn.tt4).toBeGreaterThan(start.tt4); // temp rising
    expect(dyn.tt4).toBeLessThan(eqTakeoff.tt4); // but trailing the spool target
  });

  it('the LP spool lags behind the HP spool on acceleration', () => {
    const start = equilibriumDynamics(idle, cfg);
    const dyn = simulate(start, takeoff, 2.0); // 2 seconds into the slam
    const eq = equilibriumDynamics(takeoff, cfg);
    // Both still climbing, and N1 (heavy) is a smaller fraction of its travel than N2.
    const n2Frac = (dyn.n2 - start.n2) / (eq.n2 - start.n2);
    const n1Frac = (dyn.n1 - start.n1) / (eq.n1 - start.n1);
    expect(n2Frac).toBeGreaterThan(n1Frac);
  });

  it('thrust changes gradually, not instantly, after a slam', () => {
    const start = equilibriumDynamics(idle, cfg);
    const before = computeEngineState(takeoff, cfg, start).netThrust;
    const dyn = advanceSpools(
      start,
      computeEngineState(takeoff, cfg, start).targetN1,
      computeEngineState(takeoff, cfg, start).targetN2,
      computeEngineState(takeoff, cfg, start).tt4Steady,
      0.1,
      cfg,
    );
    const after = computeEngineState(takeoff, cfg, dyn).netThrust;
    const eq = computeEngineState(takeoff, cfg).netThrust;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(before + (eq - before) * 0.2); // <20% of the way in 0.1 s
  });

  it('converges to the commanded steady state given enough time', () => {
    const start = equilibriumDynamics(idle, cfg);
    const dyn = simulate(start, takeoff, 60);
    const settled = computeEngineState(takeoff, cfg, dyn);
    const eq = computeEngineState(takeoff, cfg);
    expect(settled.netThrust).toBeGreaterThan(eq.netThrust * 0.99);
    expect(Math.abs(settled.turbineInletTemp - eq.turbineInletTemp)).toBeLessThan(6);
  });

  it('a throttle chop spools the engine down toward idle', () => {
    const start = equilibriumDynamics(takeoff, cfg);
    const dyn = simulate(start, idle, 60);
    const eqIdle = equilibriumDynamics(idle, cfg);
    expect(dyn.n2).toBeLessThan(start.n2);
    expect(Math.abs(dyn.n2 - eqIdle.n2)).toBeLessThan(0.02);
  });
});

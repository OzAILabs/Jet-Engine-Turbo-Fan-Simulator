import { describe, it, expect } from 'vitest';
import { computeEngineState } from '../sim/engineModel';
import { sweepForNonFinite } from '../sim/validation';
import type { EngineInputs } from '../sim/types';

const takeoff: EngineInputs = { throttle: 100, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };
const cruise: EngineInputs = { throttle: 85, altitudeFt: 35000, mach: 0.85, isaTempOffsetC: 0 };
const idle: EngineInputs = { throttle: 5, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };

describe('engine model — thrust', () => {
  it('produces positive thrust at sea-level takeoff', () => {
    const s = computeEngineState(takeoff);
    expect(s.netThrust).toBeGreaterThan(0);
  });

  it('is calibrated to ~513 kN at sea-level static, full throttle', () => {
    const s = computeEngineState(takeoff);
    expect(s.netThrust).toBeGreaterThan(500_000);
    expect(s.netThrust).toBeLessThan(525_000);
  });

  it('produces most thrust from the bypass stream (high-bypass behavior)', () => {
    const s = computeEngineState(takeoff);
    expect(s.bypassThrust).toBeGreaterThan(s.coreThrust);
  });

  it('thrust decreases with altitude at the same throttle', () => {
    const sl = computeEngineState({ throttle: 90, altitudeFt: 0, mach: 0.3, isaTempOffsetC: 0 });
    const alt = computeEngineState({ throttle: 90, altitudeFt: 35000, mach: 0.3, isaTempOffsetC: 0 });
    expect(alt.netThrust).toBeLessThan(sl.netThrust);
  });
});

describe('engine model — gas path trends', () => {
  it('pressure rises through the compressor (station 2 < 25 < 3)', () => {
    const s = computeEngineState(takeoff);
    expect(s.stations['25'].pressure).toBeGreaterThan(s.stations['2'].pressure);
    expect(s.stations['3'].pressure).toBeGreaterThan(s.stations['25'].pressure);
  });

  it('temperature rises through compressor and jumps in the combustor', () => {
    const s = computeEngineState(takeoff);
    expect(s.stations['25'].temperature).toBeGreaterThan(s.stations['2'].temperature);
    expect(s.stations['3'].temperature).toBeGreaterThan(s.stations['25'].temperature);
    // Combustor: big temperature jump from 3 -> 4
    expect(s.stations['4'].temperature).toBeGreaterThan(s.stations['3'].temperature + 300);
  });

  it('temperature and pressure fall through the turbines (4 > 45 > 5)', () => {
    const s = computeEngineState(takeoff);
    expect(s.stations['45'].temperature).toBeLessThan(s.stations['4'].temperature);
    expect(s.stations['5'].temperature).toBeLessThan(s.stations['45'].temperature);
    expect(s.stations['45'].pressure).toBeLessThan(s.stations['4'].pressure);
    expect(s.stations['5'].pressure).toBeLessThan(s.stations['45'].pressure);
  });

  it('reaches a high overall pressure ratio near design at full throttle', () => {
    const s = computeEngineState(takeoff);
    expect(s.overallPressureRatio).toBeGreaterThan(35);
    expect(s.overallPressureRatio).toBeLessThan(45);
  });

  it('per-stage compressor pressures are monotonically increasing', () => {
    const s = computeEngineState(takeoff);
    const comp = s.stages.filter((st) => st.section === 'fan' || st.section === 'booster' || st.section === 'hpc');
    for (const stage of comp) expect(stage.pOut).toBeGreaterThan(stage.pIn);
  });

  it('turbine inlet temperature is plausible (1500–1900 K) at takeoff', () => {
    const s = computeEngineState(takeoff);
    expect(s.turbineInletTemp).toBeGreaterThan(1500);
    expect(s.turbineInletTemp).toBeLessThan(1900);
  });
});

describe('engine model — throttle & fuel', () => {
  it('fuel flow increases with throttle', () => {
    const flows = [10, 30, 50, 70, 100].map(
      (throttle) => computeEngineState({ throttle, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 }).fuelFlow,
    );
    for (let i = 1; i < flows.length; i++) expect(flows[i]).toBeGreaterThan(flows[i - 1]);
  });

  it('thrust increases with throttle', () => {
    const low = computeEngineState({ throttle: 30, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 });
    const high = computeEngineState({ throttle: 90, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 });
    expect(high.netThrust).toBeGreaterThan(low.netThrust);
  });

  it('is fully shut down at throttle 0 (no flow, no fuel, no thrust, spools stopped)', () => {
    const off = computeEngineState({ throttle: 0, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 });
    expect(off.totalMassFlow).toBeLessThan(1);
    expect(off.fuelFlow).toBeLessThan(0.01);
    expect(Math.abs(off.netThrust)).toBeLessThan(1000); // ~0 N
    expect(off.targetN1).toBeLessThan(0.02);
    expect(off.targetN2).toBeLessThan(0.02);
  });

  it('idle keeps the engine running with low but positive thrust', () => {
    const s = computeEngineState(idle);
    expect(s.netThrust).toBeGreaterThan(0);
    expect(s.netThrust).toBeLessThan(computeEngineState(takeoff).netThrust * 0.25);
    expect(s.targetN2).toBeGreaterThan(0.5); // HP spool idles high
  });
});

describe('engine model — robustness', () => {
  it('produces no NaN/Infinity across the full input envelope', () => {
    const failures = sweepForNonFinite();
    expect(failures).toEqual([]);
  });

  it('cruise is a sensible operating point', () => {
    const s = computeEngineState(cruise);
    expect(s.netThrust).toBeGreaterThan(0);
    expect(s.turbineInletTemp).toBeGreaterThan(1000);
    expect(s.exhaustGasTemp).toBeLessThan(s.turbineInletTemp);
    expect(s.tsfc).toBeGreaterThan(0);
  });

  it('hot day (ISA+20) reduces thrust vs standard day at takeoff', () => {
    const std = computeEngineState(takeoff);
    const hot = computeEngineState({ ...takeoff, isaTempOffsetC: 20 });
    expect(hot.netThrust).toBeLessThan(std.netThrust);
  });
});

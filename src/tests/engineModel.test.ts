import { describe, it, expect } from 'vitest';
import { computeEngineState } from '../sim/engineModel';
import { sweepForNonFinite } from '../sim/validation';
import { defaultEngineConfig as cfg } from '../data/defaultEngineConfig';
import type { EngineInputs } from '../sim/types';

const takeoff: EngineInputs = { throttle: 100, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };
const cruise: EngineInputs = { throttle: 85, altitudeFt: 35000, mach: 0.85, isaTempOffsetC: 0 };
const idle: EngineInputs = { throttle: 0, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };

describe('engine model — certified GE90-115B anchors', () => {
  // Sources: EASA TCDS IM.E.002 [TCDS], ICAO Emissions Databank v32 [ICAO].
  it('is calibrated to the 513.9 kN (115,540 lbf) takeoff rating [TCDS]', () => {
    const s = computeEngineState(takeoff);
    expect(s.netThrust).toBeGreaterThan(505_000);
    expect(s.netThrust).toBeLessThan(520_000);
  });

  it('burns 4.6–4.7 kg/s at takeoff [ICAO measured 4.60–4.69]', () => {
    const s = computeEngineState(takeoff);
    expect(s.fuelFlow).toBeGreaterThan(4.4);
    expect(s.fuelFlow).toBeLessThan(4.9);
  });

  it('produces a bypass ratio of ~7.1 at takeoff [ICAO 7.08–7.1]', () => {
    const s = computeEngineState(takeoff);
    expect(s.bypassRatio).toBeGreaterThan(6.7);
    expect(s.bypassRatio).toBeLessThan(7.5);
  });

  it('reaches OPR ~42 at takeoff [ICAO 42.2–43.2]', () => {
    const s = computeEngineState(takeoff);
    expect(s.overallPressureRatio).toBeGreaterThan(40);
    expect(s.overallPressureRatio).toBeLessThan(44);
  });

  it('moves ~1,450–1,550 kg/s of air at takeoff [EST]', () => {
    const s = computeEngineState(takeoff);
    expect(s.totalMassFlow).toBeGreaterThan(1400);
    expect(s.totalMassFlow).toBeLessThan(1600);
  });

  it('static takeoff TSFC ≈ 9.1 g/(kN·s) = 0.32 lb/lbf/h [derived ICAO/TCDS]', () => {
    const s = computeEngineState(takeoff);
    const tsfcG = s.tsfc * 1e6;
    expect(tsfcG).toBeGreaterThan(8.3);
    expect(tsfcG).toBeLessThan(9.9);
  });

  it('takeoff EGT shows a realistic margin below the 1,090 °C redline [TCDS]', () => {
    const s = computeEngineState(takeoff);
    expect(s.egtC).toBeGreaterThan(1000);
    expect(s.egtC).toBeLessThan(cfg.egtTakeoffLimitC);
  });

  it('spool anchors: takeoff N1 ≈ 100% (2,355 rpm), N2 above 100% but under redline', () => {
    const s = computeEngineState(takeoff);
    expect(s.targetN1).toBeGreaterThan(0.97);
    expect(s.targetN1).toBeLessThan(1.03);
    expect(s.targetN2).toBeGreaterThan(1.0);
    expect(s.targetN2).toBeLessThan(cfg.n2RedlineFrac);
  });
});

describe('engine model — ground idle anchors', () => {
  it('idles at N2 ≈ 66%, N1 ≈ 18% [EST flashcards/videos]', () => {
    const s = computeEngineState(idle);
    expect(s.targetN2).toBeCloseTo(cfg.idleN2, 2);
    expect(s.targetN1).toBeCloseTo(cfg.idleN1, 2);
  });

  it('idle fuel flow ≈ 0.20–0.30 kg/s (~700–1,100 kg/h) [EST]', () => {
    const s = computeEngineState(idle);
    expect(s.fuelFlow).toBeGreaterThan(0.18);
    expect(s.fuelFlow).toBeLessThan(0.32);
  });

  it('idle EGT ≈ 420–470 °C [EST video]', () => {
    const s = computeEngineState(idle);
    expect(s.egtC).toBeGreaterThan(415);
    expect(s.egtC).toBeLessThan(475);
  });

  it('idle keeps low but positive thrust (a few % of rated)', () => {
    const s = computeEngineState(idle);
    expect(s.netThrust).toBeGreaterThan(2_000);
    expect(s.netThrust).toBeLessThan(40_000);
  });

  it('idles around OPR ~9, not ~1 (real engines hold pressure at idle)', () => {
    const s = computeEngineState(idle);
    expect(s.overallPressureRatio).toBeGreaterThan(7);
    expect(s.overallPressureRatio).toBeLessThan(11);
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

  it('produces most thrust from the bypass stream (high-bypass behavior)', () => {
    const s = computeEngineState(takeoff);
    expect(s.bypassThrust).toBeGreaterThan(s.coreThrust);
  });

  it('per-stage compressor pressures are monotonically increasing', () => {
    const s = computeEngineState(takeoff);
    const comp = s.stages.filter((st) => st.section === 'fan' || st.section === 'booster' || st.section === 'hpc');
    for (const stage of comp) expect(stage.pOut).toBeGreaterThan(stage.pIn);
  });

  it('turbine inlet temperature is plausible (1,600–1,900 K) at takeoff', () => {
    const s = computeEngineState(takeoff);
    expect(s.turbineInletTemp).toBeGreaterThan(1600);
    expect(s.turbineInletTemp).toBeLessThan(1900);
  });
});

describe('engine model — throttle response', () => {
  it('fuel flow increases with throttle', () => {
    const flows = [0, 25, 50, 75, 100].map(
      (throttle) => computeEngineState({ throttle, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 }).fuelFlow,
    );
    for (let i = 1; i < flows.length; i++) expect(flows[i]).toBeGreaterThan(flows[i - 1]);
  });

  it('thrust increases with throttle', () => {
    const low = computeEngineState({ throttle: 30, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 });
    const high = computeEngineState({ throttle: 90, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 });
    expect(high.netThrust).toBeGreaterThan(low.netThrust);
  });

  it('throttle 0 commands IDLE, not shutdown — stopping the engine is the fuel switch\'s job', () => {
    const s = computeEngineState(idle);
    expect(s.targetN2).toBeGreaterThanOrEqual(cfg.idleN2 - 0.005);
    expect(s.fuelFlow).toBeGreaterThan(0.1);
  });

  it('thrust decreases with altitude at the same throttle', () => {
    const sl = computeEngineState({ throttle: 90, altitudeFt: 0, mach: 0.3, isaTempOffsetC: 0 });
    const alt = computeEngineState({ throttle: 90, altitudeFt: 35000, mach: 0.3, isaTempOffsetC: 0 });
    expect(alt.netThrust).toBeLessThan(sl.netThrust);
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
    // Cruise BPR runs a little higher than takeoff (textbook behavior).
    expect(s.bypassRatio).toBeGreaterThan(6.5);
  });

  it('hot day (ISA+20) reduces thrust vs standard day at takeoff', () => {
    const std = computeEngineState(takeoff);
    const hot = computeEngineState({ ...takeoff, isaTempOffsetC: 20 });
    expect(hot.netThrust).toBeLessThan(std.netThrust);
  });

  it('surge margin sits in the realistic 20–30% band, lower at high power', () => {
    const to = computeEngineState(takeoff);
    const id = computeEngineState(idle);
    expect(id.surgeMarginSteady).toBeGreaterThan(to.surgeMarginSteady);
    expect(to.surgeMarginSteady).toBeGreaterThan(15);
    expect(id.surgeMarginSteady).toBeLessThan(35);
  });
});

describe('station thermodynamic transparency (entropy/enthalpy/cooling)', () => {
  it('entropy rises across the combustor (heat addition, station 3 → 4)', () => {
    const s = computeEngineState(takeoff);
    expect(s.stations['4'].entropy).toBeGreaterThan(s.stations['3'].entropy);
  });

  it('real compression generates entropy (station 2 → 3, non-isentropic)', () => {
    const s = computeEngineState(takeoff);
    expect(s.stations['3'].entropy).toBeGreaterThan(s.stations['2'].entropy);
  });

  it('enthalpy climbs through the compressor and peaks at the combustor exit', () => {
    const s = computeEngineState(takeoff);
    expect(s.stations['3'].enthalpy).toBeGreaterThan(s.stations['2'].enthalpy);
    expect(s.stations['4'].enthalpy).toBeGreaterThan(s.stations['3'].enthalpy);
    expect(s.stations['45'].enthalpy).toBeLessThan(s.stations['4'].enthalpy);
  });

  it('freestream entropy/enthalpy sit at the ISA sea-level reference (≈0)', () => {
    const s = computeEngineState(takeoff);
    expect(Math.abs(s.stations['0'].entropy)).toBeLessThan(1);
    expect(Math.abs(s.stations['0'].enthalpy)).toBeLessThan(1000);
  });

  it('per-stage data covers the full 22-stage gas path', () => {
    const s = computeEngineState(takeoff);
    // 1 fan + 4 booster + 9 HPC + 2 HPT + 6 LPT
    expect(s.stages.length).toBe(
      1 + cfg.boosterStages + cfg.hpcStages + cfg.hptStages + cfg.lptStages,
    );
    // Pressure rises through every compressor stage, falls through every turbine stage.
    for (const st of s.stages) {
      if (st.section === 'hpt' || st.section === 'lpt') {
        expect(st.pOut).toBeLessThan(st.pIn);
      } else {
        expect(st.pOut).toBeGreaterThan(st.pIn);
      }
    }
  });

  it('HPT rotor-inlet temperature sits between Tt3 and Tt4 (cooling blend)', () => {
    const s = computeEngineState(takeoff);
    expect(s.coolingBleedFraction).toBeCloseTo(cfg.coolingBleedFraction, 5);
    expect(s.coolingBleedFlow).toBeCloseTo(s.coreMassFlow * cfg.coolingBleedFraction, 6);
    expect(s.hptRotorInletTemp).toBeGreaterThan(s.compressorExitTemp);
    expect(s.hptRotorInletTemp).toBeLessThan(s.turbineInletTemp);
  });
});

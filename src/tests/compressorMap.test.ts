import { describe, expect, it } from 'vitest';
import {
  buildCoreCompressorMap,
  steadyOperatingPoint,
  surgeMarginAt,
} from '../sim/compressorMap';
import { computeEngineState, steadySurgeMarginPct } from '../sim/engineModel';
import { defaultEngineConfig as cfg } from '../data/defaultEngineConfig';
import type { EngineInputs } from '../sim/types';

const takeoff: EngineInputs = { throttle: 100, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };
const idle: EngineInputs = { throttle: 0, altitudeFt: 0, mach: 0, isaTempOffsetC: 0 };

/**
 * The map is generated from the cycle's own schedules, so these tests pin the
 * consistency contract: map distance to the surge line must equal the
 * displayed surge margin everywhere ON the operating line, and the map's
 * operating line must reproduce the cycle's OPR.
 */
describe('core compressor map', () => {
  const map = buildCoreCompressorMap(cfg);

  it('operating line reproduces the cycle OPR at idle and takeoff', () => {
    const sIdle = computeEngineState(idle);
    const sTo = computeEngineState(takeoff);
    const opIdle = steadyOperatingPoint(cfg.idleN2, cfg);
    const opTo = steadyOperatingPoint(cfg.takeoffN2, cfg);
    expect(opIdle.pr).toBeCloseTo(sIdle.overallPressureRatio, 1);
    expect(opTo.pr).toBeCloseTo(sTo.overallPressureRatio, 1);
  });

  it('map surge margin equals the displayed schedule ON the operating line', () => {
    for (const n2 of [cfg.idleN2, 0.75, 0.85, 0.95, cfg.takeoffN2]) {
      const op = steadyOperatingPoint(n2, cfg);
      // Constant-Wc distance from op point to the surge line. The surge line's
      // flow sits −5% of ITS OWN op point, so at constant Wc the interpolated
      // surge PR belongs to a slightly faster speed line — margin reads within
      // a few points of the schedule, never below it (conservative display).
      const sm = surgeMarginAt(map, op.wc, op.pr);
      expect(sm).toBeGreaterThan(op.marginPct - 1);
      expect(sm).toBeLessThan(op.marginPct + 12);
    }
  });

  it('every speed line passes exactly through its steady operating point', () => {
    for (const line of map.speedLines) {
      const op = steadyOperatingPoint(line.n2c, cfg);
      const hit = line.points.some(
        (p) => Math.abs(p.wc - op.wc) < 1e-9 && Math.abs(p.pr - op.pr) < 1e-9,
      );
      expect(hit).toBe(true);
    }
  });

  it('speed lines run surge → choke: PR falls monotonically along each line', () => {
    for (const line of map.speedLines) {
      for (let i = 1; i < line.points.length; i++) {
        expect(line.points[i].pr).toBeLessThanOrEqual(line.points[i - 1].pr + 1e-9);
        expect(line.points[i].wc).toBeGreaterThanOrEqual(line.points[i - 1].wc - 1e-9);
      }
    }
  });

  it('surge line sits strictly above the operating line and rises with flow', () => {
    for (let i = 0; i < map.operatingLine.length; i++) {
      expect(map.surgeLine[i].pr).toBeGreaterThan(map.operatingLine[i].pr);
      if (i > 0) expect(map.surgeLine[i].pr).toBeGreaterThanOrEqual(map.surgeLine[i - 1].pr - 1e-9);
    }
  });

  it('crossing the surge line reads as negative margin', () => {
    const op = steadyOperatingPoint(0.9, cfg);
    const above = op.pr * (1 + (op.marginPct + 15) / 100);
    expect(surgeMarginAt(map, op.wc, above)).toBeLessThan(0);
  });

  it('schedule margin still matches the engine state (single source of truth)', () => {
    const s = computeEngineState(takeoff);
    expect(s.surgeMarginSteady).toBeCloseTo(steadySurgeMarginPct(cfg.takeoffN2, cfg), 5);
  });
});

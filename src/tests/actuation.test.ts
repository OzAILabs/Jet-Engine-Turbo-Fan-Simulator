import { describe, expect, it } from 'vitest';
import {
  computeActuation,
  VBV_CLOSE_END_N2,
  VSV_OPEN_END_N2,
  VSV_OPEN_START_N2,
} from '../sim/actuation';

/**
 * FADEC variable-geometry schedule anchors. These are the single source of
 * truth consumed by the 3D hardware (CompressorBleedSystems), the audio
 * (VBV drone), and any gauges — if a breakpoint changes here, all three
 * follow together.
 */
describe('actuation schedule', () => {
  it('holds VSVs closed and VBVs open through the whole sub-idle regime', () => {
    for (const n2 of [0, 0.2, 0.4, 0.63, VSV_OPEN_START_N2]) {
      const a = computeActuation(n2);
      expect(a.vsvOpenFrac).toBe(0);
      expect(a.vbvOpenFrac).toBe(1);
    }
  });

  it('fully opens the VSVs by takeoff N2 and keeps them open past it', () => {
    expect(computeActuation(VSV_OPEN_END_N2).vsvOpenFrac).toBe(1);
    expect(computeActuation(1.15).vsvOpenFrac).toBe(1);
  });

  it('fully closes the VBV doors by the schedule endpoint', () => {
    expect(computeActuation(VBV_CLOSE_END_N2).vbvOpenFrac).toBe(0);
    expect(computeActuation(1.0).vbvOpenFrac).toBe(0);
  });

  it('is partially open mid-schedule (doors closing while VSVs opening)', () => {
    const a = computeActuation(0.75); // between idle 0.66 and VBV-closed 0.85
    expect(a.vbvOpenFrac).toBeGreaterThan(0.1);
    expect(a.vbvOpenFrac).toBeLessThan(0.9);
    expect(a.vsvOpenFrac).toBeGreaterThan(0);
    expect(a.vsvOpenFrac).toBeLessThan(0.5);
  });

  it('moves monotonically with N2 (no schedule reversals)', () => {
    let prevVsv = -1;
    let prevVbv = 2;
    for (let n2 = 0; n2 <= 1.2; n2 += 0.01) {
      const a = computeActuation(n2);
      expect(a.vsvOpenFrac).toBeGreaterThanOrEqual(prevVsv);
      expect(a.vbvOpenFrac).toBeLessThanOrEqual(prevVbv);
      prevVsv = a.vsvOpenFrac;
      prevVbv = a.vbvOpenFrac;
    }
  });
});

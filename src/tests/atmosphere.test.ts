import { describe, it, expect } from 'vitest';
import { computeISA } from '../sim/atmosphere';

describe('ISA atmosphere', () => {
  it('matches sea-level standard conditions', () => {
    const a = computeISA(0, 0);
    expect(a.temperature).toBeCloseTo(288.15, 2);
    expect(a.pressure).toBeCloseTo(101325, 0);
    expect(a.density).toBeCloseTo(1.225, 2);
    expect(a.speedOfSound).toBeCloseTo(340.3, 0);
  });

  it('matches ~35,000 ft standard conditions', () => {
    const a = computeISA(35000, 0);
    // Standard values at 35,000 ft: ~218.8 K, ~23,840 Pa.
    expect(a.temperature).toBeGreaterThan(217);
    expect(a.temperature).toBeLessThan(220);
    expect(a.pressure).toBeGreaterThan(22500);
    expect(a.pressure).toBeLessThan(25000);
    expect(a.density).toBeGreaterThan(0.35);
    expect(a.density).toBeLessThan(0.42);
  });

  it('handles 40,000 ft (above the tropopause, isothermal layer)', () => {
    const a = computeISA(40000, 0);
    expect(a.temperature).toBeCloseTo(216.65, 1); // isothermal
    expect(a.pressure).toBeGreaterThan(17000);
    expect(a.pressure).toBeLessThan(20000);
    expect(Number.isFinite(a.density)).toBe(true);
  });

  it('pressure decreases monotonically with altitude', () => {
    let prev = Infinity;
    for (let ft = 0; ft <= 40000; ft += 2000) {
      const p = computeISA(ft, 0).pressure;
      expect(p).toBeLessThan(prev);
      prev = p;
    }
  });

  it('ISA offset raises temperature and lowers density at fixed pressure', () => {
    const std = computeISA(0, 0);
    const hot = computeISA(0, 20);
    expect(hot.temperature).toBeCloseTo(std.temperature + 20, 5);
    expect(hot.pressure).toBeCloseTo(std.pressure, 5); // pressure unchanged
    expect(hot.density).toBeLessThan(std.density); // hotter air is thinner
  });
});

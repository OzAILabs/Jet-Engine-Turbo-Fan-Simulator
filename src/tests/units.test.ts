import { describe, it, expect } from 'vitest';
import {
  celsiusToKelvin,
  clamp,
  feetToMeters,
  kelvinToCelsius,
  lbfToNewtons,
  lerp,
  mapRange,
  metersToFeet,
  newtonsToLbf,
} from '../sim/units';

describe('unit conversions', () => {
  it('feet <-> meters round-trip', () => {
    expect(feetToMeters(0)).toBe(0);
    expect(feetToMeters(1000)).toBeCloseTo(304.8, 1);
    expect(metersToFeet(feetToMeters(35000))).toBeCloseTo(35000, 3);
  });

  it('newtons <-> lbf', () => {
    expect(newtonsToLbf(513000)).toBeCloseTo(115327, 0);
    expect(lbfToNewtons(newtonsToLbf(1000))).toBeCloseTo(1000, 6);
    // GE90-115B target thrust sanity: ~115,300 lbf
    expect(newtonsToLbf(513000)).toBeGreaterThan(114000);
    expect(newtonsToLbf(513000)).toBeLessThan(117000);
  });

  it('temperature conversions', () => {
    expect(kelvinToCelsius(288.15)).toBeCloseTo(15, 5);
    expect(celsiusToKelvin(kelvinToCelsius(500))).toBeCloseTo(500, 9);
  });

  it('clamp / lerp / mapRange', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(mapRange(5, 0, 10, 0, 100)).toBe(50);
    expect(mapRange(0, 0, 0, 7, 9)).toBe(7); // degenerate range
  });
});

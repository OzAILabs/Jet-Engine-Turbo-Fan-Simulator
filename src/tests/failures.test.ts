import { beforeEach, describe, expect, it } from 'vitest';
import { useSimStore } from '../store/useSimStore';

/** Injected-failure contracts, driven through the real store tick. */
const S = () => useSimStore.getState();
const step = (seconds: number) => {
  for (let t = 0; t < seconds; t += 0.05) S().tick(0.05);
};

beforeEach(() => {
  S().setDeterioration(0);
  S().setVbvFailClosed(false);
  S().setIsaOffset(0);
  S().resetToTakeoff();
  S().setThrottle(100);
  step(5);
});

describe('injected failures', () => {
  it('bird strike: vibration caution + EGT spike + thrust loss, clearing in ~30 s', () => {
    const before = S().engine.netThrust;
    S().triggerBirdStrike();
    step(1);
    expect(S().engine.warnings.some((w) => w.id === 'eng-vibration')).toBe(true);
    expect(S().engine.netThrust).toBeLessThan(before * 0.99);
    step(35);
    expect(S().birdStrikeT).toBeNull();
    expect(S().engine.warnings.some((w) => w.id === 'eng-vibration')).toBe(false);
    expect(S().engine.netThrust).toBeGreaterThan(before * 0.99);
  });

  it('bird strike does nothing on a dead engine', () => {
    S().resetToColdDark();
    S().triggerBirdStrike();
    expect(S().birdStrikeT).toBeNull();
  });

  it('deterioration erodes the EGT margin: an old engine runs hotter for the same thrust', () => {
    step(20); // settle
    const freshEgt = S().engine.egtC;
    const freshThrust = S().engine.netThrust;
    S().setDeterioration(1);
    step(2);
    expect(S().engine.egtC).toBeGreaterThan(freshEgt + 35);
    // Thrust is held (the FADEC compensates); the price is temperature.
    expect(Math.abs(S().engine.netThrust - freshThrust) / freshThrust).toBeLessThan(0.03);
  });

  it('a fully deteriorated engine trips the EGT caution at full power on a hot day', () => {
    S().setIsaOffset(20);
    S().setDeterioration(1);
    step(25);
    expect(
      S().engine.warnings.some((w) => w.id === 'egt-mct' || w.id === 'egt-redline'),
    ).toBe(true);
  });
});

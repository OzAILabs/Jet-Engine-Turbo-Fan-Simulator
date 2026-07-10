import { beforeEach, describe, expect, it } from 'vitest';
import { useSimStore } from '../store/useSimStore';

/**
 * RUD (catastrophic failure) timeline contract, driven through the real
 * store tick — the same style as the autostart/failures contracts. These
 * anchor the event's shape: release → cascade (surge pops, EGT spike) →
 * flameout → rundown → windmill/secured, with the gauges the crew watches.
 */
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

describe('fan blade off (contained — the FAR 33.94 event)', () => {
  it('runs release → cascade → flameout → windmill with the right gauges', () => {
    const thrustBefore = S().engine.netThrust;
    S().triggerRud('fbo');
    expect(S().rud).not.toBeNull();

    // Release instant: full shake, ENG FAIL latched, blade identity fixed.
    step(0.2);
    expect(S().rud!.vibe).toBeGreaterThan(0.5);
    expect(S().rud!.bladeIndex).toBe(7);
    expect(S().engine.warnings.some((w) => w.id === 'eng-fail')).toBe(true);

    // Cascade: surge pops fire the existing surge machine; EGT spikes.
    step(0.7);
    expect(S().engine.egtC).toBeGreaterThan(S().rud!.egtAtRelease + 80);

    // Past flameout: fuel is gone, thrust is gone.
    step(2.5); // t ≈ 3.4
    expect(S().engine.fuelFlow).toBe(0);
    expect(S().engine.netThrust).toBeLessThan(thrustBefore * 0.02);

    // Long rundown: spools coast to a windmill, oil bleeds away, EGT cools.
    step(30);
    const rud = S().rud!;
    expect(rud.phase).toBe('windmill');
    expect(rud.n2).toBeLessThan(0.03);
    expect(rud.n1).toBeLessThan(0.12);
    expect(rud.n1).toBeGreaterThan(0); // windmilling, not frozen
    expect(S().instruments.oilPressurePsi).toBeLessThan(3);
    expect(S().engine.egtC).toBeLessThan(rud.egtAtRelease);
    // The shake dies with the speed, and the smoke clears.
    expect(rud.vibe).toBeLessThan(0.15);
    expect(rud.smoke).toBeLessThan(0.12);
    // No fuel-fed fire in the contained event.
    expect(rud.fire).toBe(0);
  });

  it('is permanent — no relight, only a scenario reset clears it', () => {
    S().triggerRud('fbo');
    step(10);
    S().setThrottle(100); // dead lever
    step(2);
    expect(S().rud).not.toBeNull();
    expect(S().engine.netThrust).toBeLessThan(1000);
    S().resetToTakeoff();
    expect(S().rud).toBeNull();
    step(1);
    expect(S().engine.netThrust).toBeGreaterThan(100_000);
  });

  it('does nothing on a dead engine', () => {
    S().resetToColdDark();
    S().triggerRud('fbo');
    expect(S().rud).toBeNull();
  });
});

describe('uncontained disk burst', () => {
  it('sustains a fuel-fed fire until the fire handle + bottle secure it', () => {
    S().triggerRud('burst');
    step(3);
    expect(S().rud!.fire).toBeGreaterThan(0.9);
    expect(S().engine.warnings.some((w) => w.id === 'eng-fire')).toBe(true);
    // The fire does NOT go out on its own.
    step(15);
    expect(S().rud!.fire).toBeGreaterThan(0.9);

    S().pullFireHandle();
    expect(S().fuelControl).toBe('CUTOFF');
    step(12); // bottle delay + knockdown
    expect(S().rud!.fire).toBe(0);
    expect(S().rud!.phase).toBe('secured');
    expect(S().engine.warnings.some((w) => w.id === 'eng-fire')).toBe(false);
  });

  it('kills the core almost instantly (the rotor is gone)', () => {
    S().triggerRud('burst');
    step(2);
    expect(S().rud!.n2).toBeLessThan(0.1);
    expect(S().engine.fuelFlow).toBe(0);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useSimStore } from '../store/useSimStore';

/**
 * One-touch autostart: a single runAutostart() call must orchestrate the whole
 * 777/GE90 start (APU bleed → crank → fuel/ignition → idle) with no further
 * input, and must NOT command START before bleed pressure is available (doing
 * so would trip a noBleed abort).
 */
describe('one-touch autostart', () => {
  beforeEach(() => {
    useSimStore.getState().resetToColdDark();
  });

  it('carries a cold-and-dark engine to ground idle from a single call', () => {
    const s = useSimStore.getState();
    expect(s.startSeq.runState).toBe('off');

    s.runAutostart();
    expect(useSimStore.getState().autoStartActive).toBe(true);

    let t = 0;
    const dt = 0.05;
    while (t < 200 && useSimStore.getState().startSeq.runState !== 'running') {
      useSimStore.getState().tick(dt);
      t += dt;
    }

    const st = useSimStore.getState();
    expect(st.startSeq.runState).toBe('running'); // reached the idle handoff
    expect(st.autoStartActive).toBe(false); // macro cleared itself when done
    expect(st.instruments.n2Pct).toBeGreaterThan(60); // at/above ground idle
    expect(t).toBeLessThan(120); // within a realistic start time
  });

  it('waits for bleed pressure before latching START (no dry-crank abort)', () => {
    useSimStore.getState().runAutostart();
    // First tick: APU has barely begun spooling, so bleed is well under the
    // 25 psi minimum — the macro must hold the selector at NORM, no fault.
    useSimStore.getState().tick(0.05);

    const st = useSimStore.getState();
    expect(st.apuBleedPsi).toBeLessThan(25);
    expect(st.startSelector).toBe('NORM');
    expect(st.startSeq.fault).toBeNull();
    expect(st.autoStartActive).toBe(true); // still armed, waiting for bleed
  });
});

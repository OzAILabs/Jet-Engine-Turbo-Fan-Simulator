import { beforeEach, describe, expect, it } from 'vitest';
import { useSimStore } from '../store/useSimStore';

/**
 * Surge-event state machine contracts, exercised through the REAL store tick
 * (running regime, torque-balance spool model). These pin the fixes from the
 * Phase 2 adversarial review:
 *  - a chop with stuck doors must NOT latch at the instant the lever moves
 *    (the penalty keys off the steady door schedule, not the commanded gap);
 *  - the event must clear at idle-with-failure (margin settles at 5) and
 *    re-arm with fresh pops while pinned past the line;
 *  - EICAS escalation must track the LIVE margin;
 *  - resets must clear the event.
 */
const S = () => useSimStore.getState();
const step = (seconds: number, dt = 0.05) => {
  for (let t = 0; t < seconds; t += dt) S().tick(dt);
};

beforeEach(() => {
  S().setVbvFailClosed(false);
  S().resetToTakeoff();
  S().setThrottle(100);
});

describe('surge event state machine (live store)', () => {
  it('healthy doors never surge, even on a full slam', () => {
    S().resetToColdDark();
    S().resetToTakeoff();
    S().setThrottle(0);
    step(40); // settle at idle
    S().setThrottle(100); // slam
    let surged = false;
    for (let t = 0; t < 30; t += 0.05) {
      S().tick(0.05);
      surged ||= S().surgeActive;
    }
    expect(surged).toBe(false);
  });

  it('slam from idle with VBVs failed closed surges, then recovers as N2 climbs', () => {
    S().setThrottle(0);
    step(40); // settle at idle (healthy)
    S().setVbvFailClosed(true);
    S().setThrottle(100);
    let latched = false;
    let warned = false;
    for (let t = 0; t < 30; t += 0.05) {
      S().tick(0.05);
      if (S().surgeActive) {
        latched = true;
        warned ||= S().engine.warnings.some((w) => w.id === 'eng-surge');
      }
    }
    expect(latched).toBe(true);
    expect(warned).toBe(true);
    // Recovered by the time the engine reaches takeoff (doors scheduled shut).
    expect(S().surgeActive).toBe(false);
    expect(S().spool.n2).toBeGreaterThan(1.0);
  });

  it('a chop with stuck doors does NOT latch at lever movement — the surge develops as N2 falls into the door band', () => {
    step(10); // ensure settled takeoff
    S().setVbvFailClosed(true);
    S().setThrottle(0); // CHOP
    // First second: doors are scheduled CLOSED at high N2, no penalty yet.
    for (let t = 0; t < 1; t += 0.05) {
      S().tick(0.05);
      expect(S().surgeActive).toBe(false);
    }
    // As N2 decays into the door-open band the stuck doors bite and it pops.
    let surgeAt: number | null = null;
    let n2AtSurge = 1;
    for (let t = 1; t < 40 && surgeAt === null; t += 0.05) {
      S().tick(0.05);
      if (S().surgeActive) {
        surgeAt = t;
        n2AtSurge = S().spool.n2;
      }
    }
    expect(surgeAt).not.toBeNull();
    expect(n2AtSurge).toBeLessThan(0.85); // inside the VBV schedule band
    // Settled at idle with the failure: margin sits at 5 — the event CLEARS
    // (no permanent invisible latch) and EICAS escalates on the live margin.
    step(30);
    expect(S().surgeActive).toBe(false);
    expect(S().surgeMargin).toBeGreaterThan(2);
    expect(S().surgeMargin).toBeLessThan(7);
    expect(S().engine.warnings.some((w) => w.id === 'surge-critical')).toBe(true);
  });

  it('resets clear a live surge event', () => {
    S().setThrottle(0);
    step(40);
    S().setVbvFailClosed(true);
    S().setThrottle(100);
    // Catch it mid-surge.
    let caught = false;
    for (let t = 0; t < 10 && !caught; t += 0.05) {
      S().tick(0.05);
      caught = S().surgeActive;
    }
    expect(caught).toBe(true);
    S().resetToTakeoff();
    expect(S().surgeActive).toBe(false);
    expect(S().surgeT).toBe(0);
    expect(S().surgeMargin).toBe(S().engine.surgeMarginSteady);
    // Stuck doors stay visibly stuck across the reset (scenario persists).
    expect(S().actuation.vbvOpenFrac).toBe(0);
  });
});

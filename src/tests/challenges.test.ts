import { beforeEach, describe, expect, it } from 'vitest';
import { CHALLENGES } from '../data/challenges';
import { useSimStore } from '../store/useSimStore';

/**
 * The challenges judge the LIVE store, so these tests prove each one is
 * actually winnable (and that the obvious wrong approach fails) by flying
 * the store the way a user would — the same guarantee for gameplay that the
 * calibration anchors give the physics.
 */
const S = () => useSimStore.getState();
const byId = (id: string) => CHALLENGES.find((c) => c.id === id)!;

const fly = (
  c: (typeof CHALLENGES)[number],
  seconds: number,
  control?: (t: number) => void,
): { verdict: ReturnType<(typeof CHALLENGES)[number]['judge']>; acc: Record<string, number> } => {
  const acc: Record<string, number> = {};
  let verdict: ReturnType<typeof c.judge> = null;
  for (let t = 0; t < seconds && !verdict; t += 0.05) {
    control?.(t);
    S().tick(0.05);
    if (Math.round(t * 20) % 4 === 0) {
      // 5 Hz watcher cadence, like the panel
      c.watch(S(), acc);
      verdict = c.judge(S(), acc);
    }
  }
  return { verdict, acc };
};

beforeEach(() => {
  S().setVbvFailClosed(false);
  S().setIsaOffset(0);
  S().resetToColdDark();
});

describe('challenges are winnable (and slams lose)', () => {
  it('gentle start: the autostart flow passes under the 700 °C line', () => {
    const c = byId('gentle-start');
    c.arm();
    S().runAutostart();
    const { verdict } = fly(c, 150);
    expect(verdict?.passed).toBe(true);
  });

  it('margin keeper: a staged acceleration passes…', () => {
    const c = byId('margin-keeper');
    c.arm();
    const { verdict } = fly(c, 90, (t) => {
      if (t < 0.1) S().setThrottle(30);
      else if (t > 15 && t < 15.1) S().setThrottle(60);
      else if (t > 30 && t < 30.1) S().setThrottle(85);
      else if (t > 45 && t < 45.1) S().setThrottle(100);
    });
    expect(verdict?.passed).toBe(true);
  });

  it('…and a full slam fails it', () => {
    const c = byId('margin-keeper');
    c.arm();
    const { verdict } = fly(c, 60, (t) => {
      if (t < 0.1) S().setThrottle(100);
    });
    expect(verdict?.passed).toBe(false);
  });

  it('hot-day derate: a careful partial-throttle setting passes', () => {
    const c = byId('hot-day-derate');
    c.arm();
    const { verdict } = fly(c, 120, (t) => {
      if (t > 1 && t < 1.1) S().setThrottle(75);
      else if (t > 40 && t < 40.1) S().setThrottle(85);
    });
    expect(verdict?.passed).toBe(true);
  });
});

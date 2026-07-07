/**
 * Challenges: goal + live judging against the REAL simulator state. A
 * challenge arms a starting condition, then a 5 Hz watcher accumulates
 * observations (max EGT, min surge margin, …) until the judge declares a
 * pass or fail with feedback. No scripted answers — the physics decides.
 */
import type { LearningMode } from '../store/useSimStore';
import { useSimStore } from '../store/useSimStore';
import { applyScenario } from '../util/simBridge';

type Store = ReturnType<typeof useSimStore.getState>;

export interface Verdict {
  passed: boolean;
  feedback: string;
}

export interface Challenge {
  id: string;
  title: string;
  tier: LearningMode;
  brief: string;
  hints: string[];
  /** Install the starting condition. */
  arm: () => void;
  /** Accumulate observations each sample (5 Hz). */
  watch: (s: Store, acc: Record<string, number>) => void;
  /** Return a verdict to end the run, or null to keep watching. */
  judge: (s: Store, acc: Record<string, number>) => Verdict | null;
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'gentle-start',
    title: 'Gentle start',
    tier: 'explore',
    brief:
      'Start the engine from cold and dark and reach stable idle WITHOUT the EGT ever touching 700 °C. The ground-start limit is 750 — leave yourself margin like a pro.',
    hints: [
      'APU on and bleed pressure first — a weak crank means a hot start.',
      'Let the starter reach max motoring N2 (~25%) before you bring the fuel in.',
      'Autostart does this correctly every time. Beating it BY HAND is the challenge.',
    ],
    arm: () => useSimStore.getState().resetToColdDark(),
    watch: (s, acc) => {
      acc.maxEgt = Math.max(acc.maxEgt ?? 0, s.instruments.egtC);
    },
    judge: (s, acc) => {
      if (s.startSeq.fault && s.startSeq.runState === 'off') {
        return { passed: false, feedback: `Start aborted (${s.startSeq.fault.kind}). Peak EGT ${Math.round(acc.maxEgt ?? 0)} °C. Reset and try a stronger crank before fuel.` };
      }
      if ((acc.maxEgt ?? 0) >= 700) {
        return { passed: false, feedback: `EGT touched ${Math.round(acc.maxEgt)} °C — over the 700 °C challenge line (limit 750). More airflow before light-off keeps the peak down.` };
      }
      if (s.startSeq.runState === 'running') {
        return { passed: true, feedback: `Stable idle with a peak EGT of ${Math.round(acc.maxEgt ?? 0)} °C. That is a gentle, professional start.` };
      }
      return null;
    },
  },
  {
    id: 'margin-keeper',
    title: 'Margin keeper',
    tier: 'course',
    brief:
      'From idle, reach 100% N2 while keeping the surge margin above 16% the whole way. A full slam bites ~15 points of margin — you will have to stage the throttle.',
    hints: [
      'The transient penalty scales with how far the lever is ahead of the spool.',
      'Watch the compressor-map dot: each push lifts it toward the surge line, then it settles back.',
      'Two or three staged pushes beat one slam.',
    ],
    arm: () => {
      applyScenario('idle');
      useSimStore.getState().setThrottle(0);
    },
    watch: (s, acc) => {
      if (s.inputs.throttle > 2) {
        acc.started = 1;
        acc.minSM = Math.min(acc.minSM ?? 100, s.surgeMargin);
      }
    },
    judge: (s, acc) => {
      if (!acc.started) return null;
      if ((acc.minSM ?? 100) < 16) {
        return { passed: false, feedback: `Surge margin dipped to ${Math.round(acc.minSM)}% — below the 16% challenge floor. Smaller throttle steps let the spool catch up to the lever.` };
      }
      if (s.spool.n2 >= 1.0) {
        return { passed: true, feedback: `100% N2 with the margin never below ${Math.round(acc.minSM ?? 100)}%. Exactly how a FADEC acceleration schedule thinks.` };
      }
      return null;
    },
  },
  {
    id: 'hot-day-derate',
    title: 'Hot-day derate',
    tier: 'course',
    brief:
      'It is a +20 °C day. Deliver at least 400 kN WITHOUT triggering any EICAS caution or warning. Full throttle will cook the EGT — find the derate a real crew would fly.',
    hints: [
      'Hot air is thin air: the same throttle makes less thrust and MORE temperature.',
      'The 1,050 °C max-continuous caution is the wall you must stay under.',
      'Creep up on it: set a throttle, let everything settle, read EGT, adjust.',
    ],
    arm: () => {
      const s = useSimStore.getState();
      s.resetToTakeoff();
      s.setIsaOffset(20);
      s.setThrottle(50);
    },
    watch: (s, acc) => {
      // Track the best clean thrust: only counts while no warnings show.
      if (s.engine.warnings.length === 0) {
        acc.bestClean = Math.max(acc.bestClean ?? 0, s.engine.netThrust);
      }
    },
    judge: (s, acc) => {
      const critical = s.engine.warnings.some((w) => w.severity === 'critical');
      if (critical) {
        return { passed: false, feedback: 'A red warning latched — that is an inspection-required event on a real engine. Reset and stay under the limits while you find the derate.' };
      }
      if ((acc.bestClean ?? 0) >= 400_000) {
        return { passed: true, feedback: `${Math.round((acc.bestClean ?? 0) / 1000)} kN clean — no cautions, no warnings. That is a flat-rated hot-day takeoff.` };
      }
      return null;
    },
  },
];

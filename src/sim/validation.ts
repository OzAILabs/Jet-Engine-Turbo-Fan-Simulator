/**
 * Runtime/test guardrails: sweep the input envelope and confirm the model
 * never produces NaN or Infinity. Used by the test suite and (optionally) as a
 * dev-mode sanity check.
 */
import { computeEngineState } from './engineModel';
import { defaultEngineConfig } from '../data/defaultEngineConfig';
import type { EngineConfig, EngineState } from './types';

/** Recursively check that every number in a value is finite. */
export function allFinite(value: unknown, path = 'root'): { ok: boolean; badPath?: string } {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true } : { ok: false, badPath: path };
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = allFinite(value[i], `${path}[${i}]`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const r = allFinite(v, `${path}.${k}`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  return { ok: true };
}

export interface SweepFailure {
  inputs: { throttle: number; altitudeFt: number; mach: number; isaTempOffsetC: number };
  badPath: string;
}

/**
 * Sweep throttle × altitude × Mach × ISA-offset and return any operating
 * points that yield a non-finite value. An empty array means the model is
 * clean across the whole envelope.
 */
export function sweepForNonFinite(config: EngineConfig = defaultEngineConfig): SweepFailure[] {
  const failures: SweepFailure[] = [];
  for (let throttle = 0; throttle <= 100; throttle += 10) {
    for (let altitudeFt = 0; altitudeFt <= 40000; altitudeFt += 5000) {
      for (let mach = 0; mach <= 0.85; mach += 0.085) {
        for (let isaTempOffsetC = -20; isaTempOffsetC <= 20; isaTempOffsetC += 20) {
          const inputs = { throttle, altitudeFt, mach: Math.min(mach, 0.85), isaTempOffsetC };
          const state: EngineState = computeEngineState(inputs, config);
          const r = allFinite(state);
          if (!r.ok) failures.push({ inputs, badPath: r.badPath ?? 'unknown' });
        }
      }
    }
  }
  return failures;
}

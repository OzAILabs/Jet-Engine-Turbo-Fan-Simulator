/**
 * Synthetic core-compressor map — the gas generator (booster + HPC lumped the
 * same way the cycle lumps them into OPR) drawn in the standard map plane:
 * corrected flow (fraction of design core flow) on X, pressure ratio on Y.
 *
 * Construction principle: the map is generated FROM the sim's own steady
 * relationships, so it is calibrated by construction and can never disagree
 * with the cycle:
 *   • At each corrected speed N2c the steady OPERATING POINT is
 *     (Wc, PR) = (coreFlowFraction(N2c), steadyOprSchedule(N2c)) — the exact
 *     numbers engineModel.ts produces at sea-level static.
 *   • Each SPEED LINE is a falling curve through its operating point: flow
 *     can rise ~+7% toward CHOKE (PR collapsing) or fall ~−5% toward SURGE
 *     (PR rising to the surge value) — the classic Walsh & Fletcher shape.
 *   • The SURGE LINE is the locus of speed-line tops, sitting the steady
 *     surge-margin schedule above the operating line — the SAME schedule the
 *     cycle displays, so map distance ≡ displayed margin on the line.
 *
 * This module is also the single source of truth for the OPR and
 * surge-margin schedules: engineModel.ts and CompressorMap.tsx import them
 * from here instead of keeping duplicate copies.
 */
import { defaultEngineConfig } from '../data/defaultEngineConfig';
import { coreFlowFraction, steadyOprSchedule, steadySurgeMarginPct } from './engineModel';
import type { EngineConfig } from './types';

// ---------------------------------------------------------------------------
// Map geometry
// ---------------------------------------------------------------------------

export interface MapPoint {
  /** Corrected flow, fraction of design core flow (0…~1.1). */
  wc: number;
  /** Pressure ratio. */
  pr: number;
}

export interface SpeedLine {
  /** Corrected N2 (fraction of rated) this line belongs to. */
  n2c: number;
  /** Sampled surge→choke, so points[0] sits ON the surge line. */
  points: MapPoint[];
}

export interface OperatingPoint extends MapPoint {
  n2c: number;
  marginPct: number;
}

export interface CoreCompressorMap {
  speedLines: SpeedLine[];
  operatingLine: OperatingPoint[];
  surgeLine: MapPoint[];
}

/** Flow excursion available along a speed line, relative to its op point. */
const SURGE_FLOW_DROP = 0.05; // −5% Wc from op point to the surge top
const CHOKE_FLOW_RISE = 0.07; // +7% Wc from op point to choke

/** Steady operating point in the map plane for a given N2. */
export function steadyOperatingPoint(
  n2: number,
  config: EngineConfig = defaultEngineConfig,
): OperatingPoint {
  return {
    n2c: n2,
    wc: coreFlowFraction(n2, config),
    pr: steadyOprSchedule(n2, config),
    marginPct: steadySurgeMarginPct(n2, config),
  };
}

/** One speed line through its operating point (t: −1 = surge … +1 = choke). */
function buildSpeedLine(n2c: number, config: EngineConfig, samples = 15): SpeedLine {
  const op = steadyOperatingPoint(n2c, config);
  const prSurge = op.pr * (1 + op.marginPct / 100);
  const points: MapPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const t = -1 + (2 * i) / (samples - 1);
    let wc: number;
    let pr: number;
    if (t <= 0) {
      // Surge side: flow backs off, PR climbs to the surge value (concave).
      const u = -t; // 0 at op point → 1 at surge
      wc = op.wc * (1 - SURGE_FLOW_DROP * u);
      pr = op.pr + (prSurge - op.pr) * Math.pow(u, 0.7);
    } else {
      // Choke side: flow saturates while PR collapses (steep drop).
      wc = op.wc * (1 + CHOKE_FLOW_RISE * t);
      pr = op.pr * (1 - 0.4 * Math.pow(t, 1.4));
    }
    points.push({ wc, pr });
  }
  return { n2c, points };
}

const mapCache = new WeakMap<EngineConfig, CoreCompressorMap>();

/** Build (and memoize) the full map for a config. */
export function buildCoreCompressorMap(
  config: EngineConfig = defaultEngineConfig,
): CoreCompressorMap {
  const cached = mapCache.get(config);
  if (cached) return cached;

  // Speed lines from just below idle to just past takeoff N2.
  const n2s: number[] = [];
  for (let n2 = 0.55; n2 <= config.takeoffN2 + 0.021; n2 += 0.08) n2s.push(n2);

  const speedLines = n2s.map((n2) => buildSpeedLine(n2, config));

  // Dense operating + surge lines for smooth display and margin lookups.
  const operatingLine: OperatingPoint[] = [];
  const surgeLine: MapPoint[] = [];
  for (let n2 = 0.5; n2 <= config.takeoffN2 + 0.04 + 1e-9; n2 += 0.01) {
    const op = steadyOperatingPoint(n2, config);
    operatingLine.push(op);
    surgeLine.push({
      wc: op.wc * (1 - SURGE_FLOW_DROP),
      pr: op.pr * (1 + op.marginPct / 100),
    });
  }

  const map = { speedLines, operatingLine, surgeLine };
  mapCache.set(config, map);
  return map;
}

/**
 * Surge margin from map geometry [%]: distance below the surge line at
 * constant corrected flow — the standard SM = (PR_surge − PR)/PR · 100.
 * Below/above the mapped flow range the end values clamp (sub-idle is
 * startSequence territory; the map owns idle→takeoff).
 */
export function surgeMarginAt(map: CoreCompressorMap, wc: number, pr: number): number {
  const line = map.surgeLine;
  if (line.length < 2 || pr <= 0) return 100;
  let prSurge: number;
  if (wc <= line[0].wc) {
    prSurge = line[0].pr;
  } else if (wc >= line[line.length - 1].wc) {
    prSurge = line[line.length - 1].pr;
  } else {
    // surgeLine wc is monotonic in n2; linear-interpolate the segment.
    let i = 1;
    while (i < line.length - 1 && line[i].wc < wc) i++;
    const a = line[i - 1];
    const b = line[i];
    const f = (wc - a.wc) / Math.max(b.wc - a.wc, 1e-9);
    prSurge = a.pr + (b.pr - a.pr) * f;
  }
  return ((prSurge - pr) / pr) * 100;
}

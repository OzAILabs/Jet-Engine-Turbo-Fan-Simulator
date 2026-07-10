/**
 * rudEvent.ts — the catastrophic-failure ("rapid unscheduled disassembly")
 * timeline: a deterministic, tick-driven state machine the store advances
 * while the event owns the engine. Two variants:
 *
 *  'fbo'   FAN BLADE OFF — the FAR §33.94 certification event. One of the 22
 *          fan blades releases at speed; the containment case absorbs it; the
 *          engine surges, flames out and shakes itself down to a windmill.
 *          The design WORKS — that is the lesson.
 *  'burst' UNCONTAINED DISK BURST — a fatigue-cracked rotor disk lets go.
 *          Fragments carry far too much energy for any case to stop ([EST]
 *          ~30–50× a blade), exit radially through the nacelle, sever fuel
 *          lines → sustained fire until the crew pulls the fire handle. The
 *          lesson: disks are life-limited parts precisely because this event
 *          cannot be contained.
 *
 * Energy scale for the copy ([EST], GE90-115B-inspired): a released blade
 * section ~15 kg with CG at ~1.0 m spinning at rated N1 2,355 rpm moves at
 * ~247 m/s → ~450 kJ — roughly a small car at highway speed, absorbed by the
 * containment wrap in a few milliseconds.
 *
 * All timing constants are [EST], chosen to read correctly at real-time and
 * to satisfy the timeline contract in tests/rudEvent.test.ts. The module is
 * PURE (no store imports): the store owns integration exactly as it does for
 * startSequence.
 */

import type { SpoolState } from './types';

export type RudVariant = 'fbo' | 'burst';

export type RudPhase =
  | 'release' // the first instants: blade/disk lets go
  | 'cascade' // surge pops, debris ingestion, EGT spike
  | 'flameout' // combustion lost / fuel severed
  | 'rundown' // heavy 1/rev shake decaying as the spools coast down
  | 'windmill' // terminal state (fbo): slow windmill, event over
  | 'secured'; // terminal state (burst): fire out after the handle + bottle

export interface RudState {
  variant: RudVariant;
  /** Seconds since release. */
  t: number;
  phase: RudPhase;
  /** Which fan blade let go (fixed → deterministic visuals). */
  bladeIndex: number;
  /** ALF clock hour where the release punched the case/nacelle. */
  impactClock: number;
  /** 0–1 shake amplitude for wobble/camera (1/rev, decays with N1). */
  vibe: number;
  /** 0–1 sustained fire intensity (burst; fbo gets only a brief flash). */
  fire: number;
  /** 0–1 smoke density feeding the trail. */
  smoke: number;
  /** Oil pressure [psi] bleeding away through severed lines. */
  oilPsi: number;
  /** Crew pulled the fire handle (fuel/hyd shutoff + bottle arm). */
  fireHandlePulled: boolean;
  /** Seconds since the handle was pulled. */
  tSinceHandle: number;
  /** Forced spool speeds (fractions of rated). */
  n1: number;
  n2: number;
  /** EGT the gauges show [°C]. */
  egtC: number;
  /** Multiplier applied to the pre-event thrust while it collapses → 0. */
  thrustFactor: number;
  /** True exactly on ticks that should force a fresh surge pop. */
  surgePop: boolean;
  /** Event time at which the fan-cowl doors depart (visual waves). */
  doorsDepartT: number;
  // --- Captured initial conditions (decay references) ---
  n1AtRelease: number;
  n2AtRelease: number;
  egtAtRelease: number;
  oilAtRelease: number;
  /** Net thrust [N] the engine made at release (thrustFactor multiplies THIS,
   *  never the already-decayed live value — no compounding). */
  thrustAtRelease: number;
  /** N1 the damaged fan windmills at (rises with flight Mach). */
  windmillN1: number;
}

/** Fuel/combustion is lost this many seconds after release. */
export const RUD_FLAMEOUT_T: Record<RudVariant, number> = { fbo: 2.2, burst: 0.25 };
/** The fan-cowl doors tear off this many seconds in (visual waves read it). */
const DOORS_DEPART_T: Record<RudVariant, number> = { fbo: 0.9, burst: 0.35 };
/** Cascade surge pops (event seconds) — reuse the existing surge machine. */
const SURGE_POPS: Record<RudVariant, number[]> = { fbo: [0.15, 0.7, 1.35], burst: [0.1] };
/** Fire-bottle knockdown delay after the handle is pulled [s]. */
const BOTTLE_DELAY_S = 2;

export function createRudState(
  variant: RudVariant,
  spool: SpoolState,
  egtC: number,
  oilPsi: number,
  mach: number,
  netThrustN: number,
): RudState {
  return {
    variant,
    t: 0,
    phase: 'release',
    bladeIndex: 7, // fixed: reproducible captures & tests
    impactClock: 7.7, // low on the +Z flank (ALF z = −sin: hours 6–12 face +Z)
    vibe: 1,
    fire: 0,
    smoke: 0,
    oilPsi,
    fireHandlePulled: false,
    tSinceHandle: 0,
    n1: spool.n1,
    n2: spool.n2,
    egtC,
    thrustFactor: 1,
    surgePop: false,
    doorsDepartT: DOORS_DEPART_T[variant],
    n1AtRelease: spool.n1,
    n2AtRelease: spool.n2,
    egtAtRelease: egtC,
    oilAtRelease: oilPsi,
    thrustAtRelease: netThrustN,
    // A dead fan windmills faster with more ram air; near-still at SLS. [EST]
    windmillN1: 0.015 + 0.06 * mach,
  };
}

/** Advance the event by dt seconds. Pure — returns the next state. */
export function advanceRud(prev: RudState, dt: number): RudState {
  const v = prev.variant;
  const t = prev.t + dt;
  const flameoutT = RUD_FLAMEOUT_T[v];

  // --- Spools ---------------------------------------------------------------
  // N2: the core chokes on debris (fbo) or ceases to exist as a rotor (burst),
  // then coasts to a stop — there is no relight from this.
  // Burst: the wreckage grinds to a stop in a couple of seconds (a broken
  // rotor seizes, it does not coast); fbo coasts down on damaged bearings.
  const n2Tau = t < flameoutT ? (v === 'fbo' ? 1.2 : 0.35) : v === 'fbo' ? 3.5 : 0.8;
  const n2 = prev.n2 * Math.exp(-dt / n2Tau);
  // N1: enormous aero + rub drag on the unbalanced fan, decaying toward the
  // windmill floor rather than zero.
  const n1Tau = v === 'fbo' ? 6 : 4.5;
  const n1 =
    prev.windmillN1 + (prev.n1 - prev.windmillN1) * Math.exp(-dt / n1Tau);

  // --- EGT --------------------------------------------------------------------
  // Cascade: reversed/re-ingested hot gas spikes the probes; after flameout
  // (or the severed fuel line) the gauge decays toward a warm-residual value.
  let egtC: number;
  if (t < flameoutT) {
    const spike = v === 'fbo' ? 260 : 150;
    egtC = prev.egtAtRelease + spike * Math.min(1, t / Math.max(flameoutT * 0.6, 0.1));
  } else {
    egtC = 60 + (prev.egtC - 60) * Math.exp(-dt / 8);
  }

  // --- Shake ------------------------------------------------------------------
  // 1/rev imbalance force scales with N1² (it IS the visual heartbeat of the
  // event); an impact transient rides on top for the first half-second.
  const imbalance = Math.pow(n1 / Math.max(prev.n1AtRelease, 0.2), 2);
  const vibe = Math.min(1, (v === 'fbo' ? 1 : 0.85) * imbalance + 0.35 * Math.exp(-t / 0.5));

  // --- Oil / fire / smoke -----------------------------------------------------
  const oilPsi = prev.oilAtRelease * Math.exp(-t / 7); // severed supply [EST]

  let fire: number;
  const tSinceHandle = prev.fireHandlePulled ? prev.tSinceHandle + dt : 0;
  if (prev.fireHandlePulled && tSinceHandle > BOTTLE_DELAY_S) {
    fire = prev.fire * Math.exp(-dt / 2); // bottle + fuel/hyd shutoff
  } else if (v === 'burst') {
    fire = Math.min(1, Math.max(prev.fire, (t - 0.4) / 0.8)); // fuel-fed, sustained
  } else {
    // Contained event, but the fan-case bay still burns oil for a while
    // (United 328 style): it starves out on its own in ~half a minute —
    // or the crew kills it sooner with the handle + bottle.
    fire = 0.55 * Math.min(1, Math.max(0, (t - 0.25) / 0.6)) * Math.exp(-Math.max(0, t - 0.85) / 9);
  }
  if (fire < 0.02) fire = 0;

  const smoke =
    v === 'burst'
      ? Math.max(fire, prev.smoke * Math.exp(-dt / 10))
      : t < 4
        ? Math.min(1, t / 0.5)
        : prev.smoke * Math.exp(-dt / 6);

  // --- Surge pops (edge-triggered flags for the store's surge machine) -------
  const surgePop = SURGE_POPS[v].some((p) => prev.t < p && t >= p);

  // --- Thrust -----------------------------------------------------------------
  // Collapses through the cascade with the pops, gone by flameout.
  const thrustFactor =
    t >= flameoutT
      ? 0
      : Math.max(0, 1 - t / flameoutT) * (surgePop ? 0.5 : 1) * (v === 'fbo' ? 1 : 0.3);

  // --- Phase ------------------------------------------------------------------
  let phase: RudPhase;
  if (t < 0.1) phase = 'release';
  else if (t < flameoutT) phase = 'cascade';
  else if (t < flameoutT + 1) phase = 'flameout';
  else if (v === 'burst' && prev.fireHandlePulled && fire === 0) phase = 'secured';
  else if (n2 < 0.03 && n1 < prev.windmillN1 + 0.02) phase = 'windmill';
  else phase = 'rundown';

  return {
    ...prev,
    t,
    phase,
    vibe,
    fire,
    smoke,
    oilPsi,
    tSinceHandle,
    n1,
    n2,
    egtC,
    thrustFactor,
    surgePop,
  };
}

/** The crew pulls the fire handle: fuel + hydraulics shut off, bottle armed. */
export function pullRudFireHandle(prev: RudState): RudState {
  if (prev.fireHandlePulled) return prev;
  return { ...prev, fireHandlePulled: true, tSinceHandle: 0 };
}

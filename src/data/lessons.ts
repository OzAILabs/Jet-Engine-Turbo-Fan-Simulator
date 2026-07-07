/**
 * Guided lessons: data-driven tours that drive the REAL simulator — camera,
 * view modes, scenarios, throttle, overlays — while a narration card tells
 * the story. Each step declaratively describes the state it wants; the
 * LessonsPanel applies it (and cleans up scenario side-effects on exit).
 *
 * Tiers gate the catalog: explore lessons for a first encounter, course
 * lessons for propulsion students.
 */
import type { LayerId, LearningMode, ViewMode, CameraPreset } from '../store/useSimStore';
import type { ScenarioName } from '../util/simBridge';

export interface LessonStep {
  title: string;
  /** The narration card text — 2–4 sentences, spoken-voice register. */
  narration: string;
  /** Snap to a named camera preset… */
  preset?: CameraPreset;
  /** …or fly to a point (used when no preset fits). */
  focus?: [number, number, number];
  viewMode?: ViewMode;
  /** Layers to switch OFF for this step (view-mode change resets them ON). */
  layersOff?: LayerId[];
  /** Install a start-sequence scenario (off/motoring/lightoff/idle/takeoff…). */
  scenario?: ScenarioName;
  /** Command the throttle [0–100]. */
  throttle?: number;
  /** Force the secondary-flows overlay for this step. */
  secondaryFlows?: boolean;
  /** Arm/disarm the VBV-fail training scenario (cleared on lesson exit). */
  vbvFailClosed?: boolean;
}

export interface Lesson {
  id: string;
  title: string;
  tier: LearningMode;
  blurb: string;
  steps: LessonStep[];
}

export const LESSONS: Lesson[] = [
  {
    id: 'thrust-101',
    title: 'How a turbofan makes thrust',
    tier: 'explore',
    blurb: 'The 60-second idea, told by the machine itself.',
    steps: [
      {
        title: 'One job',
        narration:
          'This machine has one job: grab air and throw it backward. Newton does the rest — push air back, the air pushes you forward. Everything you can see exists to do that efficiently.',
        preset: 'hero',
        viewMode: 'full',
        scenario: 'takeoff',
      },
      {
        title: 'The fan is the engine',
        narration:
          'Meet the real thrust-maker: a 3.25-meter fan. About 90% of the air never touches fire — the fan alone accelerates it gently around the outside. Moving a LOT of air a LITTLE beats moving a little air a lot.',
        preset: 'intake',
        viewMode: 'full',
      },
      {
        title: 'So what is all this?',
        narration:
          'The core is the fan\'s power plant. Compressors squeeze air 42-fold, fuel burns it, and turbines harvest the energy back — most of it just to spin that fan.',
        preset: 'iso',
        viewMode: 'cutaway',
      },
      {
        title: 'Squeeze…',
        narration:
          'Thirteen stages of spinning blades pack the air to 42 atmospheres. Feel how the passage narrows — compressed air needs less room. The blades get shorter and stubbier for the same reason.',
        preset: 'compressor',
        viewMode: 'cutaway',
      },
      {
        title: '…burn…',
        narration:
          'In the combustor, fuel meets that packed air and the temperature leaps to ~1,780 K — hotter than the turbine blades\' melting point. The fire is anchored by little swirl vanes behind each fuel nozzle.',
        preset: 'combustor',
        viewMode: 'cutaway',
      },
      {
        title: '…harvest',
        narration:
          'Turbines are windmills in a hurricane: two stages power the compressor, six more pull out the fan\'s enormous share. What survives them exits the nozzle as the hot core jet.',
        preset: 'exhaust',
        viewMode: 'cutaway',
      },
      {
        title: 'Add it up',
        narration:
          'Cool, slow, massive bypass air plus a hot, fast core jet: 513 kilonewtons — about the weight of 37 school buses, pushing forward. That\'s a turbofan.',
        preset: 'exhaust-low',
        viewMode: 'full',
        throttle: 100,
      },
    ],
  },
  {
    id: 'cold-start',
    title: 'A start from cold and dark',
    tier: 'explore',
    blurb: 'What actually happens in the 70 seconds before idle.',
    steps: [
      {
        title: 'Cold and dark',
        narration:
          'Nothing is turning. A jet engine can\'t start itself — compressors need speed to pump, but only the turbines can provide speed, and they need airflow first. Something outside has to break the deadlock.',
        preset: 'iso',
        viewMode: 'cutaway',
        scenario: 'off',
        layersOff: [],
      },
      {
        title: 'Borrowed breath',
        narration:
          'High-pressure air from the APU spins a small air-turbine starter bolted to the gearbox under the engine. Through the gear train and tower shaft, it cranks the CORE spool — watch N2 rise while the fan barely moves.',
        focus: [0.2, -1.05, 0],
        viewMode: 'internals',
        scenario: 'motoring',
      },
      {
        title: 'Fuel — and a heartbeat',
        narration:
          'At about 22% N2 there\'s finally enough airflow to hold a flame. Fuel sprays, igniters snap sparks six times a second, and — light-off. Watch the EGT gauge jump as the fire takes.',
        preset: 'combustor',
        viewMode: 'cutaway',
        scenario: 'lightoff',
      },
      {
        title: 'The dangerous minute',
        narration:
          'Now the turbine is helping the starter, but airflow is still weak — heat has nowhere to go. This is where hot starts live. The dashed line on the EGT dial is the 750 °C start limit the computer is guarding.',
        preset: 'combustor',
        scenario: 'accel',
      },
      {
        title: 'Self-sustaining',
        narration:
          'At 63% N2 the starter bows out — the engine now feeds itself. It settles at 66% N2: ground idle. Listen for the groan of the bleed doors dumping booster air the little core can\'t swallow yet.',
        preset: 'iso',
        viewMode: 'cutaway',
        scenario: 'idle',
      },
      {
        title: 'Alive',
        narration:
          'Seventy seconds from dead metal to a machine making 18 kN just idling. The throttle is yours now — but notice: it never touched the start. That whole sequence belonged to the FADEC.',
        preset: 'hero',
        viewMode: 'full',
      },
    ],
  },
  {
    id: 'brayton-tour',
    title: 'The Brayton cycle, station by station',
    tier: 'course',
    blurb: 'Walk the gas path with live numbers and the T–s diagram.',
    steps: [
      {
        title: 'The cycle in one look',
        narration:
          'Open the Charts panel and find the T–s diagram: compress up the left, burn across the top, expand down the right. The enclosed area is net work. Now let\'s walk that loop through real hardware. (Station markers are clickable throughout.)',
        preset: 'iso',
        viewMode: 'cutaway',
        scenario: 'takeoff',
      },
      {
        title: 'Station 2 — fan face',
        narration:
          'Ambient air, plus whatever ram the flight speed donated. Everything downstream is measured against this baseline — it\'s why compressor maps use "corrected" quantities.',
        focus: [-3.2, 0, 0],
      },
      {
        title: 'Stations 2.5 → 3 — the squeeze',
        narration:
          'Booster then HPC: pressure ×42, and the temperature is already ~950 K at station 3 from compression alone — no fire yet. On the T–s diagram this is the left leg, leaning slightly right because real compression makes entropy.',
        preset: 'compressor',
      },
      {
        title: 'Station 4 — the top of the cycle',
        narration:
          'Combustor exit: ~1,780 K at constant-ish pressure. The heat-addition leg sweeps far right on the T–s plane. This corner temperature is the ceiling materials place on the whole cycle.',
        preset: 'combustor',
      },
      {
        title: 'Station 4.5 — where EGT lives',
        narration:
          'Between the turbines. The HPT just spent ~300 K of the gas driving the compressor. The flight-deck EGT probes sit HERE — not at the exhaust — because it\'s the hottest place a sensor survives.',
        focus: [1.35, 0.4, 0],
      },
      {
        title: 'Station 5 → 8 — the payout',
        narration:
          'Six LPT stages fund the fan\'s power bill, then the nozzle converts what\'s left into jet velocity. Down the right leg of the T–s loop. The dashed return to station 0 is the atmosphere absorbing the heat we reject.',
        preset: 'exhaust',
      },
      {
        title: 'Now shrink it',
        narration:
          'Pull the throttle to idle and watch the T–s loop collapse — less pressure ratio, less peak temperature, less area, less work. The cycle you just walked breathes with the lever.',
        throttle: 0,
      },
    ],
  },
  {
    id: 'surge-lab',
    title: 'Why engines surge',
    tier: 'course',
    blurb: 'Break the bleed system, cross the surge line, hear the bang.',
    steps: [
      {
        title: 'The line you must not cross',
        narration:
          'Open the compressor map in the Charts panel. The red boundary is the surge line: ask the compressor for more pressure rise than its blades can hold at this flow, and the airflow through the core REVERSES. Explosively.',
        preset: 'compressor',
        viewMode: 'cutaway',
        scenario: 'idle',
      },
      {
        title: 'The protection you never notice',
        narration:
          'At low speed the booster overfeeds the little core. Ten bleed doors gape open and dump the excess into the bypass — that\'s the groan after start. They are the reason a normal engine CANNOT surge. So let\'s remove them.',
        focus: [-1.32, -0.75, 0],
        secondaryFlows: true,
      },
      {
        title: 'Break it',
        narration:
          'The start panel now has "Scenario: VBV fail closed" armed — the doors are stuck shut. The excess booster air has nowhere to go. Margin at idle just collapsed from 30% to about 5%. The map dot is already amber.',
        vbvFailClosed: true,
        preset: 'iso',
      },
      {
        title: 'Cross it',
        narration:
          'Slam the throttle. Acceleration over-fueling lifts the working line the last five points — BANG. Flame out of the combustor, thrust collapsing in pulses, ENG SURGE on the EICAS. The compressor is pumping backwards.',
        throttle: 100,
      },
      {
        title: 'Recovery',
        narration:
          'As N2 climbs past the range where the doors matter, the mismatch fades and the surging stops. A real crew would throttle back and land; a real FADEC logged everything. Un-breaking the doors now.',
        vbvFailClosed: false,
      },
      {
        title: 'The takeaway',
        narration:
          'Surge margin is the engine\'s most jealously guarded budget. Every variable vane, bleed door, and acceleration schedule in the FADEC exists to keep the operating point below that red line — invisibly, on every flight.',
        preset: 'iso',
        throttle: 0,
      },
    ],
  },
  {
    id: 'life-support',
    title: 'The machine that keeps itself alive',
    tier: 'course',
    blurb: 'Oil, cooling air, and the computer — the systems behind the thrust.',
    steps: [
      {
        title: 'More than a windmill',
        narration:
          'Thrust is the product, but the engine spends real effort just staying alive: lubricating bearings, cooling turbine blades, powering the aircraft. Turn on the secondary-flow overlay and look under the hood.',
        preset: 'iso',
        viewMode: 'cutaway',
        scenario: 'takeoff',
        secondaryFlows: true,
      },
      {
        title: 'The oil circuit',
        narration:
          'Yellow: oil loops from the fan-case tank down to gearbox pumps, out to jets at every bearing, and BACK — it\'s a circuit, not a supply. Lose pressure and the bearings have minutes, not hours.',
        focus: [-2.0, -1.0, 0.8],
      },
      {
        title: 'Air as armor',
        narration:
          'Cyan turning orange: ~8% of core air, tapped BEFORE the burner, snakes around the combustor and through the HPT blades\' internal passages. The blades live in gas hotter than their melting point wearing a film of this air.',
        preset: 'combustor',
      },
      {
        title: 'The dump doors',
        narration:
          'Pale streams at the bottom of the core: the VBV doors venting booster air into the bypass. Watch them fade as the throttle rises — the FADEC schedules them shut as the core learns to swallow everything.',
        focus: [-1.32, -0.75, 0],
        throttle: 0,
      },
      {
        title: 'The adult in the room',
        narration:
          'The finned box on the fan case is the FADEC: dual-channel, engine-mounted, translating every lever request into what the machine can safely deliver — fuel, vanes, bleeds, starts, limits. You\'ve been flying THROUGH it all along.',
        focus: [-2.85, 1.2, -1.2],
      },
    ],
  },
];

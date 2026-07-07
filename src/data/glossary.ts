/**
 * Searchable propulsion glossary. Entries use THIS simulator's conventions
 * (N1/N2 as % of rated speed, EGT = T49, the sim's station numbering) so the
 * definitions always match what the panels show. Cross-links via `related`.
 * `tier` gates depth by audience: explore entries read for a first-timer,
 * engineering entries assume the reader wants the real convention.
 */
import type { LearningMode } from '../store/useSimStore';

export interface GlossaryEntry {
  term: string;
  /** One-breath definition. */
  short: string;
  /** The fuller story — 2–4 sentences, tied to what the sim shows. */
  detail: string;
  formula?: string;
  related?: string[];
  tier: LearningMode; // minimum tier where the entry appears
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  thrust: {
    term: 'Thrust',
    short: 'The forward push: mass flow times how much you speed the air up.',
    detail:
      'The engine grabs ~1,500 kg of air every second and throws it backward slightly faster than it arrived. Most of the GE90\'s thrust comes from the fan\'s huge, gently-accelerated bypass stream — moving a LOT of air a LITTLE is more efficient than a small scorching jet.',
    formula: 'F = ṁ·(v_exit − v_flight)',
    related: ['bypass-ratio', 'tsfc'],
    tier: 'explore',
  },
  'bypass-ratio': {
    term: 'Bypass ratio (BPR)',
    short: 'Air around the core vs air through it — about 7:1 here.',
    detail:
      'For every kilogram of air that fights through compressors and fire, seven glide around the outside, pushed only by the fan. In this sim BPR is DERIVED from the two streams\' physics, not dialed in — watch it in the Engineering Data panel.',
    formula: 'BPR = ṁ_bypass / ṁ_core',
    related: ['thrust', 'fan'],
    tier: 'explore',
  },
  n1: {
    term: 'N1',
    short: 'Fan/LP-spool speed, shown as % of its rated 2,355 rpm.',
    detail:
      'The slow, heavy shaft: fan + booster + LP turbine. It is the thrust-setting gauge pilots actually use. Redline is 110.5%. Notice on a throttle slam that N2 responds first — N1 waits for the core to make the power.',
    related: ['n2', 'spool'],
    tier: 'explore',
  },
  n2: {
    term: 'N2',
    short: 'Core/HP-spool speed, % of its rated 9,332 rpm.',
    detail:
      'The fast gas-generator shaft: HP compressor + HP turbine. Idle is ~66%, redline 121%. During a start, everything is choreographed around N2 — fuel at ~22%, starter cutout at 63%, stable idle at 66%.',
    related: ['n1', 'spool'],
    tier: 'explore',
  },
  spool: {
    term: 'Spool',
    short: 'One rotating shaft-compressor-turbine assembly.',
    detail:
      'The GE90 is a TWO-spool engine: the LP spool (fan, booster, LP turbine) threads through the hollow HP spool (HPC, HPT). Each settles at the speed where its turbine\'s power exactly feeds its compressor\'s appetite — no gearbox between them.',
    related: ['n1', 'n2'],
    tier: 'explore',
  },
  egt: {
    term: 'EGT (T49)',
    short: 'Exhaust gas temperature — measured BETWEEN the turbines.',
    detail:
      'The health gauge. Probes sit at station 4.5 (HPT exit / LPT inlet) — the hottest place a thermocouple survives long-term. Ground-start limit 750 °C, takeoff limit 1,090 °C. An old engine runs closer to the limit for the same thrust — that eroding gap is "EGT margin".',
    related: ['tit', 'station-numbering'],
    tier: 'explore',
  },
  tit: {
    term: 'Turbine inlet temperature (Tt4)',
    short: 'The hottest gas in the machine, at the combustor exit.',
    detail:
      'Around 1,780 K at takeoff — ABOVE the melting point of the turbine blades downstream. They survive on film cooling: ~8% of core air, tapped before the burner, sweating out of hundreds of tiny holes. Higher TIT = more work per kg of air, which is why materials set the limit on the whole cycle.',
    related: ['egt', 'cooling-bleed'],
    tier: 'course',
  },
  opr: {
    term: 'Overall pressure ratio (OPR)',
    short: 'Total squeeze: ~42× ambient at takeoff.',
    detail:
      'Fan root, 4 booster stages, then 9 HPC stages multiply the pressure ~42-fold. High OPR is the single biggest lever on fuel efficiency — hotter, denser air releases far more useful energy from the same fuel. Idle OPR is ~9, not 1: even an idling core squeezes hard.',
    formula: 'OPR = P_t3 / P_t2',
    related: ['surge-margin', 'compressor-map'],
    tier: 'course',
  },
  'surge-margin': {
    term: 'Surge margin',
    short: 'Headroom between the operating point and aerodynamic breakdown.',
    detail:
      'How much extra pressure ratio the compressor could take at this flow before its blades stall and the flow reverses with a BANG. This sim runs ~30% at idle eroding to ~21% at takeoff; accelerations bite into it (watch the map dot lift). At 0 the surge event fires for real.',
    formula: 'SM = (PR_surge − PR) / PR × 100%',
    related: ['surge', 'compressor-map', 'vbv'],
    tier: 'course',
  },
  surge: {
    term: 'Compressor surge',
    short: 'Airflow through the core momentarily REVERSES. Bang.',
    detail:
      'When the compressor asks for more pressure rise than its blades can deliver, the whole flow breaks down and slams backward — a cannon-shot bang, flame out both ends, thrust collapsing in pulses. Try it: arm "VBV fail closed" on the start panel and slam the throttle from idle.',
    related: ['surge-margin', 'vbv', 'stall'],
    tier: 'course',
  },
  stall: {
    term: 'Compressor stall',
    short: 'Blade-level flow separation — surge\'s local precursor.',
    detail:
      'Individual blade rows lose grip on the air (like a wing at too high an angle of attack) before the whole machine surges. Rotating stall cells can circle the annulus at part speed; a deep enough stall becomes a full surge.',
    related: ['surge', 'vsv'],
    tier: 'engineering',
  },
  vsv: {
    term: 'Variable stator vanes (VSV)',
    short: 'Stator vanes that re-aim the flow as the core changes speed.',
    detail:
      'A compressor designed for takeoff speed sees all-wrong flow angles at idle. The FADEC twists the front HPC stator rows (via unison rings and fueldraulic actuators — watch them stroke on the case) so the blades always see air they can work with.',
    related: ['vbv', 'fadec', 'stall'],
    tier: 'course',
  },
  vbv: {
    term: 'Variable bleed valves (VBV)',
    short: '10 doors that dump booster air into the bypass at low speed.',
    detail:
      'At low N2 the booster delivers more air than the little core can swallow; the doors gape open and dump the excess overboard — the famous GE90 sub-idle groan. They also snap open on rapid decels. Stuck closed, the mismatch has nowhere to go: surge.',
    related: ['surge', 'vsv', 'actuation'],
    tier: 'course',
  },
  fadec: {
    term: 'FADEC / EEC',
    short: 'The computer that actually flies the engine.',
    detail:
      'Full-Authority Digital Engine Control: dual-channel, engine-mounted (the finned box on the fan case), owning fuel metering, variable geometry, start sequencing and limit protection. The throttle lever is a REQUEST; the FADEC decides what the engine may safely do with it.',
    related: ['vsv', 'vbv', 'autostart'],
    tier: 'course',
  },
  'station-numbering': {
    term: 'Station numbering',
    short: 'The standard addresses along the gas path: 0 to 8.',
    detail:
      'Freestream 0, fan face 2, booster exit 2.5, HPC exit 3, combustor exit 4, HPT exit 4.5, LPT exit 5, core nozzle 8 (bypass duct 13, bypass nozzle 18). Every readout in this sim uses them — click the station markers to tour the numbers live.',
    related: ['egt'],
    tier: 'course',
  },
  tsfc: {
    term: 'TSFC',
    short: 'Fuel burned per newton of thrust per second — lower is better.',
    detail:
      'Thrust-specific fuel consumption, the efficiency bottom line. This engine ~9.1 g/(kN·s) static at sea level. High bypass and high OPR both exist to push this number down.',
    formula: 'TSFC = ṁ_fuel / F',
    related: ['thrust', 'opr'],
    tier: 'course',
  },
  'corrected-speed': {
    term: 'Corrected speed / flow',
    short: 'Speeds and flows normalized to standard-day inlet conditions.',
    detail:
      'The compressor cares about the flow triangles at its blades, which depend on inlet temperature and pressure, not raw rpm. Dividing by √θ and δ collapses every altitude and weather into ONE map — the reason the compressor map\'s axes are "corrected".',
    formula: 'N_c = N/√θ,  W_c = W·√θ/δ',
    related: ['compressor-map'],
    tier: 'engineering',
  },
  'compressor-map': {
    term: 'Compressor map',
    short: 'The compressor\'s whole personality on one chart.',
    detail:
      'Pressure ratio vs corrected flow, with one falling line per corrected speed, the operating line the engine actually rides, and the surge line it must never cross. This sim\'s map (Charts panel) is generated from its own cycle, so the live dot rides the plotted line exactly.',
    related: ['surge-margin', 'corrected-speed'],
    tier: 'engineering',
  },
  'cooling-bleed': {
    term: 'Turbine cooling air',
    short: '~8% of core air skips the burner to keep blades alive.',
    detail:
      'Tapped at HPC discharge (already ~950 K, but 800 K colder than the gas!), routed around the combustor liner, and fed through serpentine passages inside the HPT blades to film-cool their skin. The rotor actually sees the blended, slightly cooler mix — check hptRotorInletTemp thinking in the readouts.',
    related: ['tit'],
    tier: 'engineering',
  },
  'brayton-cycle': {
    term: 'Brayton cycle',
    short: 'Compress → burn at constant pressure → expand. Every jet engine.',
    detail:
      'The gas-turbine cycle: spend work squeezing cold air, add heat at (nearly) constant pressure, then extract MORE work expanding the hot gas than compression cost — the surplus is thrust. Watch it live on the T–s diagram: the enclosed loop area IS the net work.',
    related: ['opr', 'tit', 'entropy'],
    tier: 'course',
  },
  entropy: {
    term: 'Entropy (s)',
    short: 'The thermodynamic cost meter: rises with every irreversibility.',
    detail:
      'Ideal compression and expansion would be vertical lines on the T–s diagram; real ones lean right — that lean is friction and loss. Heat addition sweeps far right by design. Comparing the sim\'s station entropies shows exactly where the cycle pays its taxes.',
    formula: 's = c_p·ln(T/T₀) − R·ln(P/P₀)',
    related: ['brayton-cycle'],
    tier: 'engineering',
  },
  windmilling: {
    term: 'Windmilling',
    short: 'Flight air spinning a dead engine like a pinwheel.',
    detail:
      'Cut the fuel in flight and the engine keeps turning — ram air drives the fan for minutes. Enough N2 for oil pressure and a relight. This sim models it: shut down at altitude with Mach set and watch the spools refuse to stop.',
    related: ['spool'],
    tier: 'course',
  },
  autostart: {
    term: 'Autostart',
    short: 'The FADEC flying the start so you can\'t cook the engine.',
    detail:
      'Air-turbine starter cranks the core (bleed air from the APU), fuel at ~22% N2, igniters until light-off, starter cutout at 63%, idle at 66% — with the EEC watching for hot, hung and wet starts and aborting before damage. Try breaking it with the igniter-failure scenario.',
    related: ['fadec', 'hot-start'],
    tier: 'course',
  },
  'hot-start': {
    term: 'Hot start',
    short: 'Light-off EGT racing past the start limit — abort NOW.',
    detail:
      'Too much fuel or too little airflow during a start sends EGT through the 750 °C ground limit while there\'s almost no cooling flow. The autostart cuts fuel, dry-motors to purge, and retries with both igniters. The dashed line on the EGT gauge is exactly this limit.',
    related: ['autostart', 'egt'],
    tier: 'course',
  },
  'fuel-air-ratio': {
    term: 'Fuel–air ratio',
    short: 'Roughly 1:50 in the core at takeoff — leaner than any campfire.',
    detail:
      'Jet engines burn overall-lean: the primary zone runs near-stoichiometric to hold flame, then dilution air folds in to trim the gas below the turbine\'s survival limit. Too lean overall and the flame blows out (the sim\'s flameout warning).',
    related: ['tit'],
    tier: 'engineering',
  },
  'ram-effect': {
    term: 'Ram effect',
    short: 'Flight speed pre-compressing the air before the fan ever sees it.',
    detail:
      'At Mach 0.85 the inlet recovers the freestream\'s dynamic pressure nearly losslessly — free compression before stage one. It also means thrust falls with speed (v_exit − v_flight shrinks) even as the engine swallows more air.',
    related: ['thrust', 'corrected-speed'],
    tier: 'engineering',
  },
  redline: {
    term: 'Redline',
    short: 'The never-exceed line — set by physics, enforced by the FADEC.',
    detail:
      'N1 110.5%, N2 121%, EGT 1,090 °C takeoff. Beyond them: disk burst from centrifugal load, blade creep from heat. Hover over the EICAS gauges — each tooltip explains WHY its limit exists.',
    related: ['egt', 'fadec'],
    tier: 'explore',
  },
  'accessory-gearbox': {
    term: 'Accessory gearbox (AGB)',
    short: 'The engine\'s power-takeoff: pumps and generators live here.',
    detail:
      'A tower shaft steals a little power off the HP spool, runs down the 6:00 strut, and spins a train of gears driving the fuel pump, oil pumps, hydraulic pump and generators. During start the flow reverses: the air-turbine starter cranks the core THROUGH this same gearbox.',
    related: ['spool', 'autostart'],
    tier: 'course',
  },
  'thermal-growth': {
    term: 'Thermal growth',
    short: 'Hot metal is bigger metal — clearances are a moving target.',
    detail:
      'Disks and cases swell hundreds of degrees apart in time, so blade-tip gaps breathe through every power change (exaggerated visibly on this sim\'s disks). Real engines actively cool the HPT case to pinch the gap in cruise — tip leakage is wasted work.',
    related: ['cooling-bleed'],
    tier: 'engineering',
  },
};

/** Entries visible at a tier (explore ⊂ course ⊂ engineering). */
export function glossaryForTier(tier: LearningMode): Array<[string, GlossaryEntry]> {
  const rank: Record<LearningMode, number> = { explore: 0, course: 1, engineering: 2 };
  return Object.entries(GLOSSARY).filter(([, e]) => rank[e.tier] <= rank[tier]);
}

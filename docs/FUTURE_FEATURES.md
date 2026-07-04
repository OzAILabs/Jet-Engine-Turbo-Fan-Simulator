# Future Features and Realism Roadmap

This document tracks planned realism improvements and completed milestones for
the GE90-inspired turbofan simulator. Update it whenever a milestone is started,
completed, substantially changed, or intentionally deferred.

## Completed

- [x] **Real engine startup procedure** (777/GE90-faithful): flip-out ENGINE
  START panel with APU bleed, START/IGNITION selector (EEC-released), guarded
  fuel control, EICAS dials with the disappearing 750 °C start-limit line;
  cold-and-dark boot; autostart protections (hot/hung/no-light, retry with
  both igniters); manual-start hot starts emerge from the physics.
- [x] **Sub-idle torque-balance physics**: starter torque × bleed pressure,
  n²+Coulomb drag, light-off + sub-idle combustion efficiency, EGT peak
  ~600 °C, starter cutout 63% N2, idle 66% N2 in ~70 s; shutdown coastdown
  (~60–90 s core stop, minutes-long fan windmill); in-flight windmilling.
- [x] **Certified-data calibration** (EASA TCDS / ICAO EDB): N1/N2 as % of
  rated speed (2,355 / 9,332 rpm), BPR corrected to 7.1 (derived, not
  prescribed), OPR 42, 513.9 kN, FF 4.6–4.7 kg/s takeoff / ~0.24 idle,
  EGT displayed as T49 with certified limits, realistic surge margins.
- [x] **External hardware detail**: accessory gearbox train, fuel manifolds +
  30 pigtails, igniters + exciters + leads, VSV rings/actuators (animated),
  10 VBV doors (open during start), bolted flanges + 280 bolts, borescope
  ports, FADEC + harnesses, EGT thermocouple ring, oil tank, drain mast —
  all instanced, MIL-STD-1247 tube colors.
- [x] Rotating rotor drums/disk rims on the correct spools + bearing frames.
- [x] Exhaust state-gating (no plume engine-off, light-off smoke puff),
  daylight-honest Realistic style, shock cells in Dramatic when choked.
- [x] Deterministic capture bridge (`window.__sim`): named scenarios, instant
  camera presets/poses, PNG capture (see .claude/CAPTURE.md).
- [x] Rework Dramatic exhaust into a turbulent, translucent commercial-jet plume.
- [x] Remove fighter-style flame colors, shock diamonds, and additive blowout.
- [x] Add screen-space heat distortion to Dramatic exhaust.
- [x] Fix displaced exhaust-refraction geometry clones during camera rotation.
- [x] Make intact Cutaway-mode cowling and core casing opaque.
- [x] Fix the Flow Particles toggle lifecycle crash.
- [x] Add procedural engine audio driven by N1, N2, thrust, mass flow, fuel flow,
  and exhaust velocity.
- [x] Add layered low-frequency jet roar with idle breathing, mid-spool pressure
  pulses, high-power roar, and turbulent tearing.
- [x] Upgrade lighting with soft self-shadowing, contact grounding, and offline
  studio reflections for physically based metal materials.
## Completed (2026-07 "living machinery / glass cockpit / materials" upgrade)

- [x] **Rotation direction corrected**: both spools now turn clockwise viewed
  from the rear (real GE90 sense, SPOOL_SPIN_SIGN); turbine blades mirrored so
  the gas drives the true direction.
- [x] **FADEC-owned VSV/VBV actuation** (`sim/actuation.ts` + store.actuation):
  visuals, audio and gauges share one schedule; VSV actuator rods stroke;
  VBVs transiently re-open on rapid decels (booster-stall protection).
- [x] **Living machinery**: igniter spark strobes (A/B-aware) + fuel-flow glow
  on the manifolds; live main-shaft bearings (spinning races, epicyclic roller
  cages, oil jets keyed to oil pressure); machined rotor disks + drive cones +
  fan disk with dovetails; AGB inspection pocket with six meshing spur gears,
  spinning tower/horizontal shafts, pad couplings, and an air-turbine starter
  wheel that spins only during crank.
- [x] **Internals view mode** (drive-train X-ray) + camera freed for deep zoom
  and under-engine inspection.
- [x] **Glass cockpit**: true 777 EICAS arc gauges (ticks, numerals, boxed
  digits, amber band, N1 command bug, exceedance latching, FCOM start-limit
  line preserved); EICAS message stack with master WARNING/CAUTION lights;
  start-trend strip chart + live compressor map with surge line; pedestal
  throttle quadrant with draggable lever, guarded fuel switch and fire handle.
- [x] Procedural aerospace PBR materials (all CanvasTexture, no assets):
  carbon-twill fan blades with titanium leading edge, brushed titanium
  compressor, heat-stained nickel turbines, ceramic combustor liner, painted
  nacelle; blade UVs generated in the loft.
- [x] Internal rotor disks, structural struts, live bearings, flanges,
  fasteners, and fuel manifolds. (Stage spacers and air seals still open.)
- [x] Hot-section appearance corrected: permanent tempering staining, glow
  reserved for over-temperature events, irregular flickering flame pockets.
- [x] Bloom postprocessing (HDR-thresholded: sparks, over-temp, exhaust core).
- [x] Presentation mode: overlays/grid hidden, panels collapse to edge tabs,
  perspective + cinematic hero/intake/exhaust-low poses. (DoF deferred.)

## Planned Visual Realism

- [ ] Give cutaway shells physical thickness and finished cut-edge faces.
  Deferred after the first implementation interfered with blade/internal
  animation visibility; revisit with a less intrusive geometry approach.
- [ ] Stage spacer rings and rotating air seals (labyrinth) between disks.
- [ ] Optional depth of field for presentation mode.
- [ ] Improve rotating assembly motion:
  - Speed-dependent radial/temporal blade blur (a blur disc exists on the fan).
  - Subtle startup and shutdown vibration (basic sub-idle jitter exists).
  - Windmilling from flight speed when fuel is off (sim supports it; add cues).

## Planned Flow and Atmosphere

- [ ] Add a physically styled flow-visualization mode separate from educational
  flow particles.
- [ ] Visualize rotor-induced swirl and stator flow straightening.
- [ ] Show flow contraction through compressors and mixing after combustion.
- [ ] Add atmospheric-condition-driven inlet condensation and exhaust haze.

## Planned Simulation Realism

- [ ] Replace first-order spool interpolation with torque and inertia dynamics.
- [ ] Add simplified fan and compressor maps with live operating and surge lines.
- [ ] Add variable stator and bleed effects.
- [ ] Improve nozzle modeling with pressure thrust, discharge coefficients,
  installation losses, and more detailed choking behavior.
- [x] Operating sequences and abnormal scenarios — DONE except compressor
  stall/surge events (start, light-off, EGT rise, shutdown, windmilling,
  hot/hung/no-light starts all implemented).
- [ ] Compressor stall / surge as audible+visible events (bang, flame burp).

## Maintenance Rule

When a feature is completed:

1. Move it to **Completed**.
2. Update the relevant implementation or architecture documentation.
3. Update `README.md` when the user-visible feature set or controls change.
4. Keep deferred or rejected ideas listed with a short reason.

# Future Features and Realism Roadmap

This document tracks planned realism improvements and completed milestones for
the GE90-inspired turbofan simulator. Update it whenever a milestone is started,
completed, substantially changed, or intentionally deferred.

## Completed

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
## In Progress

- [ ] Add procedural aerospace PBR materials.

## Planned Visual Realism

- [ ] Give cutaway shells physical thickness and finished cut-edge faces.
  Deferred after the first implementation interfered with blade/internal
  animation visibility; revisit with a less intrusive geometry approach.
- [ ] Complete procedural aerospace PBR material coverage:
  - Composite fan blades with subtle weave and leading-edge wear.
  - Brushed titanium compressor stages.
  - Heat-stained nickel turbine stages.
  - Ceramic-coated combustor liners.
  - Painted nacelle with subtle roughness variation.
- [ ] Add internal rotor disks, stage spacers, structural struts, bearings,
  seals, flanges, fasteners, and fuel manifolds.
- [ ] Correct hot-section appearance:
  - Use heat staining instead of normal-operation visible glow.
  - Reserve visible red/orange metal glow for over-temperature events.
  - Replace the cylindrical combustor flame with irregular flame pockets.
- [ ] Improve rotating assembly motion:
  - Speed-dependent radial/temporal blade blur.
  - Rotating drums and shafts.
  - Subtle startup and shutdown vibration.
  - Windmilling from flight speed when fuel is off.
- [ ] Add a clean Realism presentation mode with labels and educational overlays
  hidden, perspective camera defaults, cinematic presets, and optional depth of
  field.

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
- [ ] Add operating sequences and abnormal scenarios:
  - Starter-driven engine start and starter cutout.
  - Fuel introduction, light-off, and EGT rise.
  - Shutdown and spool coast-down.
  - Windmilling.
  - Hot start, hung start, flameout, compressor stall, and surge.

## Maintenance Rule

When a feature is completed:

1. Move it to **Completed**.
2. Update the relevant implementation or architecture documentation.
3. Update `README.md` when the user-visible feature set or controls change.
4. Keep deferred or rejected ideas listed with a short reason.

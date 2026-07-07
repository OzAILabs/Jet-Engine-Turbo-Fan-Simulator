# The Learning Platform Program — GE90-115B Simulator, Next Level

**Goal:** evolve the simulator from a beautiful engine demonstrator into a
serious three-audience learning platform — high-school students, college
propulsion students, and practicing engineers — with more internals layers,
more moving machinery, and physics deep enough to be credible in a propulsion
classroom.

This program was synthesized from three independent perspective audits
(pedagogy, simulation physics, 3D visualization/machinery) run 2026-07-06.
It supersedes nothing: `docs/NEXT_LEVEL_PLAN.md` (calibration sources) and
`docs/FUTURE_FEATURES.md` (roadmap ledger) remain in force; completed items
here get ticked there per the maintenance rule.

---

## Non-negotiable invariants (every phase, every commit)

1. **Rollback is sacred.** One concern per commit; every commit message ends
   with its own `git revert` instruction. Feature branch per phase; ff-only
   merges to `main`.
2. **Calibration anchors stay green.** `npm test` after touching anything in
   `src/sim/`. Physics upgrades must reproduce the existing TCDS/ICAO
   equilibria (takeoff 505–520 kN, OPR 40–44, BPR 6.7–7.5, idle EGT
   415–475 °C, start timeline 50–110 s) or the anchors are re-derived
   *deliberately, in their own commit, with justification*.
3. **Perf discipline.** ~130 draw calls today; hard ceiling 250. New repeated
   parts are instanced or merged per material; per-frame reads use
   `useSimStore.getState()` inside `useFrame`; no per-frame allocations.
4. **`engineLayout.ts` stays the single source of truth** for all 3D
   coordinates. `sim/` owns behavior; visuals/audio/UI consume store state.
5. **No binary assets.** Materials remain procedural CanvasTextures.
6. **Determinism.** No `Math.random()` in sim paths; fixed-dt tests.

---

## Program at a glance

| Phase | Theme | Headline deliverables | Size |
|-------|-------|----------------------|------|
| 0 | Quick strikes | Educational-copy fixes, disk thermal growth, blade flutter, oil pump rotor, stage spacers + labyrinth seals | days |
| 1 | Foundations | Layer system (12 toggleable system layers), 3-tier learning modes, full per-stage gas path + turbine cooling bleed + entropy/enthalpy | ~1–2 wks |
| 2 | Physics core | Component maps + operating-line solver, torque-balance spool dynamics, surge/stall events (bang, flame burp, VBV auto-open) | ~2–3 wks |
| 3 | Interactive anatomy | Draggable clipping plane, exploded assembly hierarchy + tree, part-inspection turntable, secondary airflow (oil/bleed/cooling), combustor swirlers | ~2–3 wks |
| 4 | The classroom | Guided lessons w/ camera choreography, live T-s / P-v diagrams, challenges & quizzes, glossary + part annotations, formula overlays, SI/imperial toggle | ~3–4 wks |
| 5 | Scenarios & deployment | Failure injection (FOD/bird strike, EGT-margin erosion, thermal soak), what-if design labs, teacher mode + shareable state URLs, thrust reverser + cowl opening | ~3–4 wks |

Dependencies flow downward: 4 needs the physics of 2 and the anatomy of 3 to
have something to teach; 2 and 3 need the plumbing of 1; 0 needs nothing.

---

## Phase 0 — Quick strikes (no dependencies, immediate payoff)

- **0.1 Fix `src/data/educationalCopy.ts`** — it currently teaches wrong
  facts (audit findings):
  - Station 5 copy claims it *is* "EGT"; displayed EGT is T49 at HPT exit.
    Rewrite station 5 and expand station 45 to explain the probe location.
  - Section labels explain *what*, never *why* — add the energy-flow "why".
  - Add `LIMITS_EXPLAINED` copy (why 750 °C start limit, why redlines, why
    surge margin) for the gauges to reference.
- **0.2 Disk thermal growth (exaggerated mode)** — scale `RotorDisks` with
  Tt4 in `useFrame`; 0 new draw calls; visible engine "breathing" with heat.
- **0.3 Blade flutter at high N2** — shader-only vertex wobble above ~80% N2;
  teaches blade dynamics; 0 draw calls.
- **0.4 Oil pump gerotor** — spinning lobe rotor in the AGB lube unit driven
  off the tower-shaft ratio; +1 draw call. Coordinates in
  `engineLayout.ts` EXTERNALS.
- **0.5 Stage spacer rings + labyrinth air seals** — the deferred
  FUTURE_FEATURES item, done the non-intrusive way: rings strictly *between*
  blade rows, one merged mesh per spool; +2 draw calls.

## Phase 1 — Foundations (the enablers everything else plugs into)

- **1.1 Layer system.** Replace monolithic view-mode gating with ~12
  independently toggleable system layers (nacelle, fan case, core case,
  rotors, stators, combustor, fuel, air/bleed, oil, electrical/FADEC,
  structure, accessory drive) + per-layer opacity. The existing five
  `ViewMode`s become *presets* that compose layers — zero behavior change
  until a user customizes. Store slice `layers`; components read their own
  layer flag. 0 new draw calls.
- **1.2 Learning modes.** `learningMode: 'explore' | 'course' | 'engineering'`
  gates UI density (readouts, panels, controls) by audience. Explore = HS
  (6 key numbers, big picture), Course = college (maps, station data,
  diagrams), Engineering = everything. Foundation for Phase 4 content.
- **1.3 Full station gas path + cooling bleed.** Expose the per-stage
  `StagePoint[]` array (fan, 4 booster, 9 HPC, 2 HPT, 6 LPT stages) on
  `EngineState`; add an explicit ~8% [EST] HPT cooling-bleed split (extract
  at station 4, rejoin at 4.5); add specific entropy/enthalpy to
  `StationState` (feeds Phase 4 T-s/P-v diagrams). Equilibrium unchanged by
  construction; anchors stay green ±0.5%.

## Phase 2 — Physics core (what makes it credible for engineers)

- **2.1 Component maps + operating-line solver.** Synthetic fan and core
  compressor maps (corrected speed vs corrected flow, PR + efficiency
  contours, surge line) calibrated to pass through the current cycle's
  idle/50%/takeoff points, so anchors hold by construction. Surge margin
  becomes map distance, not the current algebraic formula.
  `CompressorMap.tsx` draws the real map + live operating-point trajectory.
  ~10–20 solver iterations/frame ≈ 200 µs — comfortably real-time.
- **2.2 Torque-balance spool dynamics.** Replace the above-idle first-order
  lags with `J·dω/dt = Q_turbine − Q_compressor − Q_friction`, unifying with
  the sub-idle integrator in `startSequence.ts`. Friction tuned so the step
  response matches today's timescales (anchors green). Ships behind a
  `useTorqueBalance` toggle with the lag model as fallback until proven.
  Transient surge risk now *emerges* instead of being faked.
- **2.3 Surge/stall events.** Map-crossing detection → latched `ENG SURGE`
  EICAS message, thrust oscillation with decay, audio bang, flame burp out
  the inlet/exhaust, VBV auto-open recovery, hysteresis reset. Plus the
  sub-80 Hz rotating-stall rumble precursor when margin < 10%. Completes the
  long-standing FUTURE_FEATURES surge item.

## Phase 3 — Interactive anatomy (more layers, more machinery)

- **3.1 Draggable clipping plane.** three.js `clippingPlanes` with a gizmo +
  preset cuts (sagittal/transverse/oblique). MVP without capped cut faces
  (0 draw calls); caps are a later polish. Coexists with the cutaway wedge.
- **3.2 Exploded assembly hierarchy.** `ASSEMBLY_TREE` data (engine →
  modules → stages → parts), staged 3 s unfold animation, clickable tree UI
  → highlight + camera fly-to.
- **3.3 Part-inspection mode.** Click a part (raycast; assembly-level for
  instanced rows) → isolate on a turntable with a card: name, material,
  function, operating conditions. Start with a 10-part registry, grow.
- **3.4 Secondary airflow visualization.** Animated particles along merged
  tube runs for oil supply/scavenge, VSV/VBV muscle pressure, and HPC→HPT
  turbine cooling air (cyan→orange), gated by the Phase 1 layers;
  MIL-STD-1247 colors; +~6 draw calls.
- **3.5 Combustor swirlers + fuel-nozzle internals.** Visible swirl vanes and
  dual-orifice nozzle tips so the flame is visibly *held* by something;
  +2 draw calls. Optional follow-ons: honeycomb abradable tip seals
  (shader-only), ACC valves that stroke on over-temp.

## Phase 4 — The classroom (pedagogy content on top of 1–3)

- **4.1 Guided lessons.** `LessonFrame` schema (narration, camera preset,
  station highlights, annotations, formula snippet, optional quiz) + a
  LessonViewer with prev/next. Camera choreography rides the existing
  `window.__sim` preset machinery. Launch set: 5 Explore tours ("How a
  turbofan makes thrust", "A start from cold and dark"…), 4 Course
  deep-dives ("Brayton cycle station by station", "Compressor maps"…),
  3 Engineering case studies ("Reading an EICAS log"…).
- **4.2 Live T-s and P-v diagrams.** SVG plots of the core stations using the
  Phase 1 entropy/enthalpy, with the selected station highlighted and
  "how we computed this" formula cards.
- **4.3 Challenges.** Evaluate-predicate framework + first set: "start
  without a hot start", "keep surge margin ≥ 10% through an accel",
  "diagnose the hung start". Uses Phase 2 surge events.
- **4.4 Glossary + annotations.** ~50-entry searchable glossary with
  cross-links, audience-gated; hover cards on parts/stations wired to it.
- **4.5 Formula overlays + units toggle.** Live equations with real numbers
  substituted (`F = ṁ·Δv` with today's flows), SI ↔ imperial display toggle
  built on `src/sim/units.ts`.

## Phase 5 — Scenarios & deployment (professional + classroom ops)

- **5.1 Failure injection.** FailurePanel: bird strike/FOD (thrust ripple,
  EGT spike, vibration, 30 s decay), EGT-margin erosion over mission time,
  hot-section thermal soak affecting restarts, oil-system fault → bearing
  temperature → vibration cascade. All multiplicative overlays; anchors
  untouched when inactive.
- **5.2 What-if design labs.** Sliders for OPR/BPR/TIT as a *lab overlay*
  (never mutating `defaultEngineConfig`), live thrust/TSFC/surge-margin
  response, preset design studies.
- **5.3 Teacher mode + shareable URLs.** Engine + camera + lesson state
  encoded in the URL hash; teacher lock; PNG worksheet export via the
  existing capture bridge.
- **5.4 The big machinery finale.** Thrust reverser (translating sleeves,
  blocker doors, cascades, negative thrust in the sim) and maintenance cowl
  opening. Largest single visual item; deliberately last.

---

## Verification per phase

- `npx tsc --noEmit` + `npm test` (all suites) before every commit.
- New sim features ship with their own contract tests
  (`compressorMapSolver.test.ts`, torque-equilibrium identity test, surge
  no-fire-at-steady-state test, bleed-split conservation test).
- Draw-call budget re-measured after each visual phase (target < 250).
- Fresh-reload runtime check (no vite overlay, DOM state) after integration;
  the user is the live visual loop for look/feel sign-off.

## Delivery model

Same pipeline that shipped the living-machinery upgrade: max 3 parallel
read-only draft agents per wave for isolated new files, inline work for
shared-file edits and shaders, diff-before-copy on any full-file rewrite,
atomic commits with revert instructions, ff-only merges.

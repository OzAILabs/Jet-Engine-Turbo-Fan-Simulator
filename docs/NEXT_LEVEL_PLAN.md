# NEXT LEVEL — Realism Master Plan

This is the working contract for the "take it to the next level" realism push.
It was assembled from a deep read of every subsystem plus primary-source
research: the **EASA Type Certificate Data Sheet IM.E.002** (mirrors FAA TCDS
E00049EN), the **ICAO Engine Emissions Databank v32**, the **Boeing 777
Systems Summary (Engines & APU)**, an airline **777 FCOM** (normal +
supplementary procedures), published **sub-idle modeling literature** (Kurzke
GPPS-TC-2022-0128; METU start-up thesis; Walsh & Fletcher scalings), and GE90
externals documentation (Avio AGB brochure, borescope training flipbook).

Each number below is tagged: **[TCDS]** certified, **[ICAO]** measured,
**[FCOM]** Boeing/airline doc, **[EST]** estimated/triangulated (forums,
videos, training flashcards). Estimates are good enough for an educational
sim but are flagged in code comments wherever used.

---

## Phase C — Real GE90-115B numbers (do FIRST: everything else calibrates to these)

### C1. Redefine spool-speed normalization
Today `n1`/`n2` are *fraction of redline* (1.0 = redline) with display-only
redlines of 2,600/10,000 rpm. Real engines define **100% as rated speed**,
with redline above it:

| Quantity | Value | Source |
|---|---|---|
| N1 100% | **2,355.0 rpm** | [TCDS] |
| N1 redline | **2,602 rpm = 110.5%** | [TCDS] |
| N2 100% | **9,332.0 rpm** | [TCDS] |
| N2 redline | **11,292 rpm = 121.0%** | [TCDS] |

Change: `n1`/`n2` become *fraction of 100% rated speed*. Redline = 1.105 /
1.21. All consumers (readouts, audio RPM, rotation angles) update; the
ReadoutPanel N1%/N2% then reads like a real EICAS.

### C2. Operating anchors

| Parameter | Idle (ground min) | Takeoff (SLS, ISA) | Source |
|---|---|---|---|
| N2 | **~66%** | ~108% (of 9,332) | [EST flashcards/TCDS icing floor 65%] / [EST] |
| N1 | **~18%** | ~100% | [EST videos/forums 17–21%] / definition |
| EGT (T49, LPT inlet) | **~440 °C** | **1,030–1,055 °C** (35–60 °C margin to 1,090 redline) | [EST video] / [TCDS redline + EST margin] |
| Fuel flow | **~0.30 kg/s** (~1,080 kg/h) | **4.6–4.69 kg/s** | [EST; ICAO 7%-point is 0.34–0.38] / [ICAO] |
| Net thrust | ~13 kN (~3,000 lbf) | **513.9 kN (115,540 lbf)** | [EST] / [TCDS] |
| Bypass ratio | ~5–6 [EST] | **7.1** | [ICAO 7.08–7.1; the popular 9:1 belongs to the base GE90 — fix config] |
| OPR | — | **42** | [ICAO 42.2–43.2; TCDS/GE 42] |
| Total mass flow | ~70–90 kg/s | **~1,500 kg/s** | [EST 1,450–1,550; no certified figure] |
| TSFC (static) | — | **~9.1 g/(kN·s) = 0.32 lb/lbf/h** | derived [ICAO]/[TCDS] |
| TSFC (cruise M0.85/35k) | — | ~0.52–0.55 lb/lbf/h | [EST lit.] |

### C3. Temperature limits (displayed EGT = T49, LPT inlet — today the sim shows LPT *exit*)

| Limit | Value | Source |
|---|---|---|
| Takeoff (5 min) | 1,090 °C | [TCDS] |
| Transient (30 s) | 1,095 °C | [TCDS] |
| Max continuous | 1,050 °C | [TCDS] |
| **Max start, ground** | **750 °C** | [TCDS] |
| **Max start, in-flight** | **825 °C** | [TCDS] |

Add an EGT *measurement plane* to the model (calibrated map from the cycle's
HPT-exit temperature) so the displayed value hits the anchors above; keep the
physical cycle untouched for teaching.

### C4. Config corrections
`defaultEngineConfig.ts`: bypassRatioTakeoff 8.7 → **7.1**; designMassFlow
1350 → **~1500**; add `n1RatedRpm: 2355`, `n2RatedRpm: 9332`, redline
fractions, EGT limit set, idle anchors, fuel-flow anchors. Tests assert every
row of the C2 table at equilibrium.

---

## Phase A — Real startup / shutdown physics (sim layer)

### A1. Engine run-state machine (new `src/sim/startSequence.ts` + store fields)

```
OFF ──start selector → START──▶ MOTORING (starter air valve open, N2 rises)
MOTORING ──fuel control RUN + EEC at ~22% N2──▶ FUEL_ON (FF appears, igniter on)
FUEL_ON ──light-off (1–3 s delay, EGT rises)──▶ LIGHTOFF
LIGHTOFF ──EGT climbing, N2 accelerating──▶ ACCEL (starter still assisting)
ACCEL ──starter cutout 63% N2, selector→NORM, ignition off 56%──▶ FINAL_ACCEL
FINAL_ACCEL ──stable 66% N2, EGT start-limit line disappears──▶ RUNNING
RUNNING ──fuel control CUTOFF──▶ SPOOLDOWN (N2 → 0 in ~60–90 s, N1 windmills)
SPOOLDOWN ──N2 < ~2%──▶ OFF
failures: HOT_START (EGT → 750 °C), HUNG_START (N2 stagnates sub-idle),
NO_LIGHTOFF (no EGT rise within 20 s of fuel) ──▶ ABORTED (EEC cuts fuel,
motors 30 s to clear fuel, retries with BOTH igniters per FCOM logic)
```

Timeline targets (autostart, APU bleed) **[FCOM/EST flashcards]**:
selector START → N2 rises; ~22% N2 max motoring in ~20–25 s; fuel + igniter
~18–25 s in; light-off 3–10 s after fuel; EGT peaks **~500–650 °C** during
accel (limit 750); ignition off 56% N2; **starter cutout ~63% N2** (GE90
cutout is near idle — NOT the Trent's ~50%); stable idle 66% N2; total
**~60–90 s**. N1 must rotate by 50% N2. Idle within 2 min of RUN.

### A2. Sub-idle torque-balance integrator (replaces first-order lag below idle)
Per Kurzke / METU thesis — normalized HP-spool ODE, Euler at frame rate:

```
dn2/dt = (q_starter + q_turbine − q_drag) / J_n
q_starter = Q0 · max(0, 1 − n2/n_free) when starter engaged (n_free ≈ 0.68; ramp-in 1–2 s)
q_drag    = a·n2² + c                  (c = Coulomb term → finite-time stop)
q_turbine = k_f · wf · η_b(n2)         (η_b ramps 0.3 → 0.99 light-off → idle)
```

Calibrate `Q0, a, c, k_f, J_n` so: starter-only equilibrium ≈ 25% N2 (max
motoring); 0→22% in ~20–25 s; 22→66% in ~50–70 s; fuel-chop from idle stops
N2 in ~60–90 s. LP spool: slaved sub-idle coupling (N1 barely turns during
crank — Kurzke's crank example: N_H 3.5%, N_L 0.9%), plus windmilling floor
from Mach so an in-flight fuel chop windmills instead of stopping.
Above idle the existing first-order lags take over (they're fine there).

Sub-idle EGT: `T49 ≈ T3 + wf·η_b·LHV/(ṁ(n2)·cp)` with a 2–3 s lag — the
post-light-off EGT peak falls out naturally because airflow is still low.

Fuel flow becomes a real scheduled state during start (EEC start schedule),
not a derived display value, then hands off to the existing model at idle.

### A3. Store integration
New store slice: `runState`, `starterEngaged`, `fuelControlRun`,
`autostartOn`, `igniterSelected ('A'|'B'|'BOTH')`, `starterAirValve`,
`startElapsed`, latched `startFault`. `commandedSpeeds()` loses the
throttle-0-7% "lights off" hack — throttle maps idle→max **only when
RUNNING**; throttle is locked to idle otherwise. The sim **boots cold and
dark (OFF)**. `resetToTakeoff/Cruise` remain as explicit "snap to running
state" presets (documented as such).

Tests: full-start timeline assertions, hot-start trigger (e.g. residual EGT +
weak bleed), hung start, no-light, abort + 30 s dry-motor clears to retry,
shutdown coastdown duration, windmill at Mach > 0.

---

## Phase B — Flip-out start panel (777-faithful UI)

A **flip-out overhead/pedestal panel** docked at the bottom-center, toggled
by a tab ("ENGINE START"). It slides/folds out over the scene (CSS 3D fold).
Contents, faithful to the 777 flow:

1. **Preconditions row**: APU RUNNING + BLEED (25 psi min) indicator, FUEL
   PUMPS, oil temp. (APU is simulated as a toggle with spool-up delay.)
2. **START/IGNITION rotary selector** — NORM / START (latches; springs back
   to NORM at starter cutout, driven by the sim, with CON position).
3. **AUTOSTART ON/OFF** switch.
4. **FUEL CONTROL switch** RUN / CUTOFF with click-guard (the real one is on
   the control stand — rendered as a guarded toggle).
5. **EICAS-style start gauges** (DOM/SVG, not canvas): primary N1 + EGT round
   dials — EGT shows the **red 750 °C start-limit line that disappears when
   the engine stabilizes at idle** (the real "start complete" cue); secondary
   N2 dial, FF digits, oil pressure/temp tapes, VIB. Parameters come alive in
   the real order: N2 first (starter), oil pressure, FF at ~22% N2, EGT jump
   at light-off, N1 creeping last.
6. **Status line + EICAS messages**: ENG AUTOSTART L, ENGINE SHUTDOWN, plus
   start-fault annunciations (latched, click-to-acknowledge).
7. **Manual-start mode** (AUTOSTART OFF): the user must select RUN at max
   motoring themselves; aborting requires CUTOFF + 30 s dry motor — the
   FCOM aborted-start drill.

Sequencing guards mirror the FCOM: no starter re-engage above 30% N2, starter
duty-cycle timer (5 ON/10 OFF), engines started one at a time (single engine
here), N1 rotation check by 50% N2.

---

## Phase D — Mechanical-detail graphics pass (wires, tubes, valves, fasteners)

Today the casings are perfectly smooth lathes; **none** of the external
hardware exists. Research gave us a placement map (positions Aft-Looking-
Forward; engine +X aft in scene coords). New umbrella component
`Externals.tsx` + per-system files; all coordinates added to
`engineLayout.ts` (single source of truth). Everything instanced where
repeated; greebles opt out of shadow casting; each component handles the four
view modes (partial-sweep or retained-wedge placement for cutaway; hidden or
shifted when exploded).

| System | What to build | Placement (research) |
|---|---|---|
| **Accessory gearbox train** | AGB box w/ pad bulges, horizontal driveshaft, transfer gearbox, radial driveshaft, IDG, backup gen, fuel pump+HMU stack, lube unit, hydraulic pump, **air-turbine starter + starter air valve/duct** | AGB **under the core at 6:00**, axially under the HPC; radial shaft down the 6:00 fan-frame strut; starter on AGB aft face |
| **Fuel system** | Metered-fuel line up the core, **two semicircular staged manifolds (DAC pilot+main)** wrapping the combustor case, pigtails to **30** nozzle stems (upgrade from 16 fake cylinders), staging-valve block | Combustor (CDN) case crown |
| **Ignition** | 2 exciter boxes, 2 thick shielded leads routed aft along the core, igniter plugs at ~8:30 / 9:00 on the combustor case | lower-left core |
| **VSV system** | 4 unison rings + lever arms (IGV + stages 1–3), 2 fueldraulic actuators (~3:00/9:00), supply lines from HMU | forward HPC case |
| **VBV system** | 10 pivoting bleed doors + unison ring + 2 actuators, louvered exits on the inner bypass wall — **doors visibly OPEN during start, modulating closed above idle** (animated from run-state!) | fan hub frame, booster exit |
| **Case flanges & fasteners** | ~8 bolted flange rings at module joints (fan case → fan frame → HPC fwd → HPC aft → CDN → HPT → LPT → TRF), instanced bolt circles, case ribs | per CutawayShell profile |
| **Oil system** | Oil tank at **9:00 on the fan case**, sight gauge, scavenge/supply lines | fan case left |
| **FADEC** | Dual-channel ECU box on vibration isolators + main harness trunks (gray convoluted conduit) running aft along both sides of the core, harness ring at the LPT (EGT thermocouples) | fan case right |
| **Borescope ports** | Instanced hex-plug bosses: A 8:00 fan frame; B–H axial row 10:00 HPC; J/K/L/M at 1:00/4:00/7:00/10:00 CDN; N/P/Q/R turbine cases | per flipbook |
| **Tube color ID** | Bands per MIL-STD-1247: fuel **red**, oil **yellow**, hydraulic **blue+yellow**, pneumatic **orange+blue** | all plumbing |
| **Rotating fixes** | Replace static "rotating-looking" drums with actually spinning rotor drums/disks; add bearing frames so transparent view doesn't show floating shafts | compressor/turbine |

Perf budget: stay under ~250 draw calls (currently ~130) via InstancedMesh
(bolts, vane arms, ports) and merged tube geometries (one merged BufferGeometry
per system, not per tube).

## Phase E — Exhaust upgrades (both styles)

* **"Realistic" (volumetric)** is physically wrong: a ~900 K core jet does
  **not glow orange in daylight**. Rebuild it around the (currently dead)
  refraction "haze" path: translucent heat-distortion plume, optical depth
  from gas density × path length, almost no emissive color in daylight.
* Migrate the screen-space flow-direction streak fix (already solved in
  ExhaustShader's `vFlowDir`) into whatever CPU style survives; fix the
  particle recycle pop (life floor 0.16/0.32 → fade to 0 at p=1).
* **Engine-state coupling**: zero plume when OFF; first faint shimmer at
  light-off (+ a brief start-smoke puff — visible in every real GE90 start
  video); plume character (length/turbulence/distortion) follows the new
  run-state and fuel flow, not just N1.
* **"Dramatic" (shader)**: implement the advertised-but-absent shock-cell
  banding, gated on nozzle pressure ratio (choked flag already computed);
  unify the divergent magic constants (THRUST_REF 420k vs 480k vs 120k) into
  a shared `exhaustConstants.ts`.

## Phase F — Deterministic capture system (stop burning tokens on zoom/rotate)

* `preserveDrawingBuffer: true` + a capture component inside the Canvas.
* **`window.__sim` bridge** (dev affordance, documented):
  * `__sim.store` — the Zustand store (getState/setState/subscribe).
  * `__sim.snapCamera(preset)` — instant camera placement (new `snap` command
    kind in CameraRig; no lerp), plus a `cameraSettled` flag.
  * `__sim.applyScenario(name)` — canned states: `off`, `motoring`,
    `lightoff`, `idle`, `takeoff`, `cruise`, `shutdown` (drives run-state +
    spools + throttle deterministically, advancing the sim if needed).
  * `__sim.capture(presetOrOpts)` → PNG dataURL at a fixed resolution:
    sets camera, waits a settled frame, reads the drawing buffer.
* `.claude/CAPTURE.md` documents one-call recipes (e.g. *"combustor closeup
  at light-off"*) so any future agent run takes **one keyed capture** via
  `preview_eval` instead of orbit-and-screenshot loops.

## Phase G — Audio, verification, docs

* Audio (needs A's run-state in the frame): starter whine sweep during
  motoring, igniter tick one-shots, **light-off whoomph** (edge-detected
  one-shot), VBV "whine-grind" drone sub-idle (the real GE90 start
  signature), the famous "mooing cow" resonance band near light-off, long
  spool-down glide with low-RPM blade-click events, silence at OFF (current
  graph drones at 28 Hz forever). Requires new one-shot scheduling infra +
  previous-frame memory in `engineAudio.ts`.
* Verification: scripted full start → takeoff → shutdown run captured via the
  Phase F system; unit tests green (`npm test`); typecheck; README +
  FUTURE_FEATURES updated; one feature commit per phase.

---

## Execution order

```
C (numbers) → A (start physics) → B (panel) → D ∥ E ∥ F → G (audio+verify+docs)
```

C first because A's calibration and B's gauges are all expressed in real %
/ rpm / °C; D–F are independent of each other once A lands; G needs
everything.

## Documented approximations (be honest on stream)

* EEC-internal thresholds (hung-start stagnation, hot-start rate triggers,
  6 s vs 30 s motor logic) are proprietary FADEC software — ours are
  reasoned approximations of FCOM-described behavior.
* True minimum ground-idle N1/EGT/FF have no authoritative public source —
  values are video/forum-triangulated.
* GE90 spool inertias are not public; the sub-idle model is calibrated to the
  event timeline (22% → fuel, 63% → cutout, 66% idle, ~90 s total), not to
  real moments of inertia.
* Mass flow ~1,500 kg/s and the takeoff BPR direction-of-variation at idle
  are estimates; the -115B BPR 7.1 and OPR 42 are measured [ICAO].

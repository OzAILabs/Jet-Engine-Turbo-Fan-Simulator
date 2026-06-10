# GE90-115B Turbofan Simulator — agent notes

- **Screenshots/verification:** NEVER orbit/zoom manually. Use the `window.__sim`
  bridge (named scenarios + instant camera presets) — see [.claude/CAPTURE.md](.claude/CAPTURE.md).
- **Numbers are sourced:** physics targets come from the EASA TCDS / ICAO
  databank and are tagged [TCDS]/[ICAO]/[EST] — see
  [docs/NEXT_LEVEL_PLAN.md](docs/NEXT_LEVEL_PLAN.md) before changing any
  constant in `src/data/defaultEngineConfig.ts` or `src/sim/`.
- **Spool convention:** `spool.n1/n2` are fractions of 100% *rated* speed
  (N1 2,355 rpm / N2 9,332 rpm); redlines are 1.105/1.21. Idle: N2 0.66, N1 0.18.
- The engine boots **cold and dark**; it is started from the flip-out ENGINE
  START panel (777-style: APU → selector START → fuel control RUN). Throttle
  only commands idle→takeoff while running. Sub-idle physics live in
  `src/sim/startSequence.ts` (torque balance), above-idle in `spoolDynamics.ts`.
- All 3D coordinates come from `src/data/engineLayout.ts` (incl. EXTERNALS for
  accessory hardware + clock-position helpers). Keep it the single source of truth.
- `npm test` (vitest) holds calibration anchors and the start-timeline contract;
  run it after touching anything in `src/sim/`.
- Update `docs/FUTURE_FEATURES.md` when completing/deferring roadmap items.

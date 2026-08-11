# Contributing

Thanks for your interest. This is a personal educational project, maintained
casually — please read this before opening a pull request, so nobody wastes
their time.

## Project status

**Maintained casually, as-is.** Issues and pull requests are welcome, but there
is no service-level promise: responses may take a while, and PRs may be declined
without a lengthy explanation. If that's a problem for your use case, forking is
absolutely fine (within the terms of the [LICENSE](LICENSE)).

## The one hard rule: the physics is sourced

The engine's numbers are not decoration. Thrust, pressure ratios, spool speeds,
temperature limits and the start timeline come from the **EASA Type Certificate
Data Sheet** and the **ICAO Emissions Databank**, and are tagged in the code:

- `[TCDS]` / `[ICAO]` — a real published figure. **Do not change these** without
  citing the source you're correcting them against.
- `[EST]` — a deliberate estimate. Improvable, but say why in the PR.

The test suite (`npm test`) contains **calibration anchors** that pin the model
to those figures. A PR that turns the tests red will not be merged. If your
change makes a test fail, that is the model telling you something — investigate
before adjusting the test.

## What's likely to be accepted

- Bug fixes, with a clear description of the wrong behaviour
- Visual and rendering improvements that don't cost frame rate
- Documentation, comments, and teaching copy that make the model easier to learn from
- Accessibility and browser-compatibility fixes
- Better sourcing: replacing an `[EST]` with a cited real figure

## What's unlikely to be accepted

- Large refactors or dependency swaps with no user-visible benefit
- New frameworks, build tools, or a backend (this is deliberately a static,
  no-backend, no-asset-files project)
- 3D model files or texture assets — **all geometry and every texture is
  generated procedurally in code**, on purpose, and that constraint stays
- Changes to sourced physics values without a citation
- Anything that turns this into a game rather than a teaching instrument

## Practical notes

Before opening a PR, please make sure these pass:

```bash
npm test         # the simulation tests, including calibration anchors
npx tsc --noEmit # type-check
```

Keep pull requests **small and single-purpose**. One concern per PR, with a
description of what changed and why. A PR that does five unrelated things is
very likely to be declined purely because it can't be reviewed or reverted
cleanly.

## Licensing of contributions

By submitting a contribution, you agree that it is licensed under the same terms
as the project — the [PolyForm Noncommercial License 1.0.0](LICENSE) — and that
you have the right to contribute it.

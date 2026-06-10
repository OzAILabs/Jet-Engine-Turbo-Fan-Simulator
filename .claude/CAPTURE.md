# Deterministic captures — STOP orbiting/zooming to take screenshots

This project has a scripting bridge at `window.__sim` (installed by
`src/util/simBridge.ts` + the `CaptureBridge` in `EngineScene.tsx`). Use it via
`preview_eval` to put the simulator into a NAMED state and a NAMED camera in
one call, then take ONE `preview_screenshot`. Never drive OrbitControls or
sweep the camera manually for verification — it burns tokens and is
non-deterministic.

## One-call recipes (preview_eval)

```js
// Named engine states (frame-rate independent, reproducible):
window.__sim.applyScenario('off');       // cold & dark
window.__sim.applyScenario('motoring');  // dry crank ~18% N2
window.__sim.applyScenario('lightoff');  // flame just lit, EGT jumping
window.__sim.applyScenario('accel');     // ~45% N2, EGT near start peak
window.__sim.applyScenario('idle');      // start complete, stable idle
window.__sim.applyScenario('takeoff');   // settled SLS 100%
window.__sim.applyScenario('cruise');    // FL350 M0.85
window.__sim.applyScenario('shutdown');  // fuel cut 6 s ago, coasting

// Named cameras (instant, no animation):
window.__sim.snapCamera('iso' | 'fan' | 'compressor' | 'combustor' | 'exhaust' | 'top');

// Arbitrary close-up (instant): position, look-at target, ortho zoom (px/m).
// Good zooms: 90 overview, 180 module close-up, 300 part close-up.
window.__sim.poseCamera({ position: [-0.5, -1.6, 5], target: [-0.5, -0.55, 0], zoom: 220 }); // AGB underside
window.__sim.poseCamera({ position: [0.4, -0.8, 5.5], target: [0.35, -0.35, 0], zoom: 240 }); // igniters/fuel manifolds

// Any store mutation (view modes, toggles, throttle...):
window.__sim.store.getState().setViewMode('cutaway');   // full|transparent|cutaway|exploded
window.__sim.store.getState().setExhaustStyle('shader'); // volumetric|shader
window.__sim.store.getState().setThrottle(100);          // only acts while running

// Self-contained PNG (data URL) if you need pixels without preview_screenshot:
await window.__sim.capture({ scenario: 'idle', preset: 'combustor' });
```

## Standard verification shots

| Shot | eval | then |
|---|---|---|
| Hero cutaway running | `__sim.applyScenario('takeoff'); __sim.snapCamera('iso')` | preview_screenshot |
| Start panel mid-start | `__sim.applyScenario('accel')` | preview_screenshot (panel shows EGT rising) |
| Combustor at light-off | `__sim.applyScenario('lightoff'); __sim.snapCamera('combustor')` | preview_screenshot |
| Exhaust at takeoff | `__sim.applyScenario('takeoff'); __sim.snapCamera('exhaust')` | preview_screenshot |
| Externals detail | `__sim.snapCamera('compressor'); __sim.store.getState().setViewMode('full')` | preview_screenshot |
| Cold & dark | `__sim.applyScenario('off'); __sim.snapCamera('iso')` | preview_screenshot |

Wait ~0.5 s between eval and screenshot so a few frames render.

## Live timeline checks

For a REAL start (not a snap), eval:
```js
__sim.applyScenario('off');
const s = __sim.store.getState();
s.setApuRunning(true);
setTimeout(() => { s.setStartSelector('START'); s.setFuelControl('RUN'); }, 11000); // APU bleed up first
```
then poll `__sim.store.getState().instruments` / `.startSeq.runState`.
A full autostart takes ~70 s of wall-clock (it's real-time physics).

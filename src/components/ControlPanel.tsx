/**
 * ControlPanel - the primary DOM control surface for the simulator.
 *
 * This is a plain HTML overlay (NOT inside the 3D canvas). It lets the student
 * drive the four flight/throttle inputs, pick how the engine is rendered, toggle
 * the various educational overlays, and pause or jump to a couple of canned
 * operating points (takeoff / cruise).
 *
 * Performance note: we subscribe ONLY to the small slices of store state that
 * actually drive this panel's rendering (the inputs, the view mode, the paused
 * flag, and the five overlay toggles). We do NOT subscribe to the live spool or
 * engine numbers here, so dragging a slider never forces the 3D scene to rebuild.
 */
import { useSimStore } from '../store/useSimStore';
import type { ViewMode, ExhaustStyle } from '../store/useSimStore';
import { engineAudio } from '../audio/engineAudio';
import { ThrottleQuadrant } from './ThrottleQuadrant';

// Exhaust rendering styles shown in a segmented control.
const EXHAUST_STYLES: { style: ExhaustStyle; label: string }[] = [
  { style: 'volumetric', label: 'Realistic' },
  { style: 'shader', label: 'Dramatic' },
];

// The render modes shown in the segmented control, paired with labels.
const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: 'full', label: 'Full' },
  { mode: 'transparent', label: 'Transparent' },
  { mode: 'cutaway', label: 'Cutaway' },
  { mode: 'exploded', label: 'Exploded' },
  // Drive-train X-ray: shells + gas-path machinery hidden; shafts, bearings
  // and the accessory hardware get the stage to themselves.
  { mode: 'internals', label: 'Internals' },
];

// The five overlay toggles. The key matches both the store boolean and the
// argument to toggle(). Keeping them in one list avoids repetitive JSX.
const TOGGLES: {
  key:
    | 'showStationLabels'
    | 'showSectionLabels'
    | 'showFlowParticles'
    | 'showTempColors'
    | 'showVelocityVectors';
  label: string;
}[] = [
  { key: 'showStationLabels', label: 'Station labels' },
  { key: 'showSectionLabels', label: 'Section labels' },
  { key: 'showFlowParticles', label: 'Flow particles' },
  { key: 'showTempColors', label: 'Temp/pressure colors' },
  { key: 'showVelocityVectors', label: 'Velocity vectors' },
];

export function ControlPanel() {
  // Reactive subscriptions: only the slices this panel renders from.
  const inputs = useSimStore((s) => s.inputs);
  const viewMode = useSimStore((s) => s.viewMode);
  const exhaustStyle = useSimStore((s) => s.exhaustStyle);
  const paused = useSimStore((s) => s.paused);
  const soundEnabled = useSimStore((s) => s.soundEnabled);
  const soundVolume = useSimStore((s) => s.soundVolume);
  const presentationMode = useSimStore((s) => s.presentationMode);

  const showStationLabels = useSimStore((s) => s.showStationLabels);
  const showSectionLabels = useSimStore((s) => s.showSectionLabels);
  const showFlowParticles = useSimStore((s) => s.showFlowParticles);
  const showTempColors = useSimStore((s) => s.showTempColors);
  const showVelocityVectors = useSimStore((s) => s.showVelocityVectors);

  // Actions (stable identities from Zustand; safe to read non-reactively-ish).
  const setAltitude = useSimStore((s) => s.setAltitude);
  const setMach = useSimStore((s) => s.setMach);
  const setIsaOffset = useSimStore((s) => s.setIsaOffset);
  const setViewMode = useSimStore((s) => s.setViewMode);
  const setExhaustStyle = useSimStore((s) => s.setExhaustStyle);
  const toggle = useSimStore((s) => s.toggle);
  const togglePaused = useSimStore((s) => s.togglePaused);
  const resetToTakeoff = useSimStore((s) => s.resetToTakeoff);
  const resetToCruise = useSimStore((s) => s.resetToCruise);
  const setSoundEnabled = useSimStore((s) => s.setSoundEnabled);
  const setSoundVolume = useSimStore((s) => s.setSoundVolume);
  const setPresentationMode = useSimStore((s) => s.setPresentationMode);

  // Map each toggle key to its live boolean so the list render stays declarative.
  const toggleValues: Record<(typeof TOGGLES)[number]['key'], boolean> = {
    showStationLabels,
    showSectionLabels,
    showFlowParticles,
    showTempColors,
    showVelocityVectors,
  };

  // ISA offset is signed (deviation from the standard atmosphere), so show a sign.
  const isaLabel = `${inputs.isaTempOffsetC > 0 ? '+' : ''}${inputs.isaTempOffsetC} degC`;

  return (
    <div className="panel">
      <div className="panel-title">Controls</div>

      {/* --- Presentation mode ------------------------------------------- */}
      {/* Prominent: hides overlays + floor grid, collapses the side panels
          to hover-reveal edge tabs, forces the perspective camera and flies
          to the cinematic hero pose. Individual overlay checkboxes keep
          their values and come back exactly as left. */}
      <button
        className={`btn presentation-btn${presentationMode ? ' is-active' : ''}`}
        onClick={() => setPresentationMode(!presentationMode)}
        title="Clean beauty view: overlays and floor grid off, panels collapse to slim edge tabs (hover to reveal)"
      >
        {presentationMode ? 'Exit Presentation' : 'Presentation'}
      </button>

      {/* --- Flight / throttle inputs ------------------------------------ */}
      <div className="panel-section">
        <div className="panel-subtitle">Flight Condition</div>

        {/* Throttle: pedestal quadrant (fire handle, thrust lever, guarded fuel
            switch). Engine-running gating lives inside the component. */}
        <ThrottleQuadrant />

        {/* Altitude 0-40000 ft */}
        <div className="field">
          <div className="field-head">
            <span className="field-label">Altitude</span>
            <span className="field-value">{inputs.altitudeFt.toLocaleString()} ft</span>
          </div>
          <input
            className="slider"
            type="range"
            min={0}
            max={40000}
            step={500}
            value={inputs.altitudeFt}
            onChange={(e) => setAltitude(+e.target.value)}
          />
        </div>

        {/* Mach 0-0.85 */}
        <div className="field">
          <div className="field-head">
            <span className="field-label">Mach</span>
            <span className="field-value">{inputs.mach.toFixed(2)}</span>
          </div>
          <input
            className="slider"
            type="range"
            min={0}
            max={0.85}
            step={0.01}
            value={inputs.mach}
            onChange={(e) => setMach(+e.target.value)}
          />
        </div>

        {/* ISA temperature offset -20..20 degC (signed) */}
        <div className="field">
          <div className="field-head">
            <span className="field-label">ISA offset</span>
            <span className="field-value">{isaLabel}</span>
          </div>
          <input
            className="slider"
            type="range"
            min={-20}
            max={20}
            step={1}
            value={inputs.isaTempOffsetC}
            onChange={(e) => setIsaOffset(+e.target.value)}
          />
        </div>
      </div>

      {/* --- View mode --------------------------------------------------- */}
      <div className="panel-section">
        <div className="panel-subtitle">View Mode</div>
        <div className="seg">
          {VIEW_MODES.map(({ mode, label }) => (
            <button
              key={mode}
              className={`seg-btn${viewMode === mode ? ' is-active' : ''}`}
              onClick={() => setViewMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* --- Exhaust style ----------------------------------------------- */}
      <div className="panel-section">
        <div className="panel-subtitle">Exhaust</div>
        <div className="seg">
          {EXHAUST_STYLES.map(({ style, label }) => (
            <button
              key={style}
              className={`seg-btn${exhaustStyle === style ? ' is-active' : ''}`}
              onClick={() => setExhaustStyle(style)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* --- Overlay toggles --------------------------------------------- */}
      <div className="panel-section">
        <div className="panel-subtitle">Overlays</div>
        {TOGGLES.map(({ key, label }) => (
          <label key={key} className="checkbox">
            <input
              type="checkbox"
              checked={toggleValues[key]}
              onChange={() => toggle(key)}
            />
            {label}
          </label>
        ))}
      </div>

      {/* --- Simulation buttons ------------------------------------------ */}
      <div className="panel-section">
        <div className="panel-subtitle">Simulation</div>
        <div className="btn-row">
          <button
            className={`btn${paused ? ' is-active' : ''}`}
            onClick={() => togglePaused()}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn" onClick={() => resetToTakeoff()}>
            Reset Takeoff
          </button>
          <button className="btn" onClick={() => resetToCruise()}>
            Reset Cruise
          </button>
        </div>

        <div className="audio-controls">
          <button
            className={`btn${soundEnabled ? ' is-active' : ''}`}
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              void engineAudio.setEnabled(next);
            }}
          >
            {soundEnabled ? 'Mute Engine' : 'Enable Engine Sound'}
          </button>

          <div className="field audio-volume">
            <div className="field-head">
              <span className="field-label">Volume</span>
              <span className="field-value">{Math.round(soundVolume * 100)} %</span>
            </div>
            <input
              className="slider"
              type="range"
              aria-label="Engine sound volume"
              min={0}
              max={100}
              step={1}
              value={soundVolume * 100}
              onChange={(e) => setSoundVolume(+e.target.value / 100)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

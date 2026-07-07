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
import { useState } from 'react';
import { LAYER_IDS, LAYER_LABELS, useSimStore } from '../store/useSimStore';
import type { ViewMode, ExhaustStyle, LearningMode } from '../store/useSimStore';
import { engineAudio } from '../audio/engineAudio';
import { ThrottleQuadrant } from './ThrottleQuadrant';

// Exhaust rendering styles shown in a segmented control.
const EXHAUST_STYLES: { style: ExhaustStyle; label: string }[] = [
  { style: 'volumetric', label: 'Realistic' },
  { style: 'shader', label: 'Dramatic' },
];

// Audience tiers — progressive disclosure of the analytical panels.
const LEARNING_MODES: { mode: LearningMode; label: string; hint: string }[] = [
  { mode: 'explore', label: 'Explore', hint: 'Big picture: 3D engine, throttle, start panel, cockpit gauges.' },
  { mode: 'course', label: 'Course', hint: 'Adds live readouts, station charts, trends and the compressor map.' },
  { mode: 'engineering', label: 'Engineering', hint: 'Everything, including diagnostic detail as it lands.' },
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
    | 'showVelocityVectors'
    | 'showSecondaryFlows';
  label: string;
}[] = [
  { key: 'showStationLabels', label: 'Station labels' },
  { key: 'showSectionLabels', label: 'Section labels' },
  { key: 'showFlowParticles', label: 'Flow particles' },
  { key: 'showTempColors', label: 'Temp/pressure colors' },
  { key: 'showVelocityVectors', label: 'Velocity vectors' },
  { key: 'showSecondaryFlows', label: 'Secondary flows (oil / bleed / cooling)' },
];

export function ControlPanel() {
  // Reactive subscriptions: only the slices this panel renders from.
  const inputs = useSimStore((s) => s.inputs);
  const viewMode = useSimStore((s) => s.viewMode);
  const layers = useSimStore((s) => s.layers);
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
  const showSecondaryFlows = useSimStore((s) => s.showSecondaryFlows);

  // Actions (stable identities from Zustand; safe to read non-reactively-ish).
  const setAltitude = useSimStore((s) => s.setAltitude);
  const setMach = useSimStore((s) => s.setMach);
  const setIsaOffset = useSimStore((s) => s.setIsaOffset);
  const learningMode = useSimStore((s) => s.learningMode);
  const setLearningMode = useSimStore((s) => s.setLearningMode);
  const spoolModel = useSimStore((s) => s.spoolModel);
  const setSpoolModel = useSimStore((s) => s.setSpoolModel);
  const sectionCut = useSimStore((s) => s.sectionCut);
  const setSectionCut = useSimStore((s) => s.setSectionCut);
  const setViewMode = useSimStore((s) => s.setViewMode);
  const toggleLayer = useSimStore((s) => s.toggleLayer);
  const setAllLayers = useSimStore((s) => s.setAllLayers);
  const setExhaustStyle = useSimStore((s) => s.setExhaustStyle);

  // Layers checklist visibility (local UI state; collapsed by default).
  const [layersOpen, setLayersOpen] = useState(false);
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
    showSecondaryFlows,
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

      {/* --- Audience tier -------------------------------------------------
          Progressive disclosure: Explore trims the right-hand analytical
          panels for a first encounter; Course/Engineering restore them. */}
      <div className="panel-section">
        <div className="panel-subtitle">Audience</div>
        <div className="seg">
          {LEARNING_MODES.map(({ mode, label, hint }) => (
            <button
              key={mode}
              title={hint}
              className={`seg-btn${learningMode === mode ? ' is-active' : ''}`}
              onClick={() => setLearningMode(mode)}
            >
              {label}
            </button>
          ))}
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

      {/* --- System layers ------------------------------------------------
          Per-system visibility, AND-gated with the view mode ("show me just
          the fuel system"). Picking any view mode resets all layers ON, so
          the segmented buttons above double as presets. Collapsed by default
          to keep the panel lean. */}
      <div className="panel-section">
        <div className="panel-subtitle">
          <button
            className={`btn${layersOpen ? ' is-active' : ''}`}
            onClick={() => setLayersOpen((v) => !v)}
          >
            Layers {layersOpen ? '▾' : '▸'}
          </button>
        </div>
        {layersOpen && (
          <>
            {LAYER_IDS.map((id) => (
              <label key={id} className="checkbox">
                <input
                  type="checkbox"
                  checked={layers[id]}
                  onChange={() => toggleLayer(id)}
                />
                {LAYER_LABELS[id]}
              </label>
            ))}
            <div className="btn-row">
              <button className="btn" onClick={() => setAllLayers(true)}>
                All on
              </button>
              <button className="btn" onClick={() => setAllLayers(false)}>
                All off
              </button>
            </div>
          </>
        )}
      </div>

      {/* --- Section cut ----------------------------------------------------
          One renderer-level clipping plane: slice the whole engine along any
          axis and slide the cut. Composes with view modes and layers. */}
      <div className="panel-section">
        <div className="panel-subtitle">Section Cut</div>
        <div className="seg">
          <button
            className={`seg-btn${!sectionCut.enabled ? ' is-active' : ''}`}
            onClick={() => setSectionCut({ enabled: false })}
          >
            Off
          </button>
          {(
            [
              { axis: 'z', label: 'Half' },
              { axis: 'y', label: 'Horiz' },
              { axis: 'x', label: 'Cross' },
            ] as const
          ).map(({ axis, label }) => (
            <button
              key={axis}
              className={`seg-btn${sectionCut.enabled && sectionCut.axis === axis ? ' is-active' : ''}`}
              title={
                axis === 'z'
                  ? 'Vertical half-section (the classic cutaway drawing)'
                  : axis === 'y'
                    ? 'Horizontal slice'
                    : 'Transverse cross-section disc'
              }
              onClick={() => setSectionCut({ enabled: true, axis, offset: 0 })}
            >
              {label}
            </button>
          ))}
        </div>
        {sectionCut.enabled && (
          <>
            <div className="field">
              <div className="field-head">
                <span className="field-label">Cut position</span>
                <span className="field-value">{sectionCut.offset.toFixed(2)} m</span>
              </div>
              <input
                className="slider"
                type="range"
                min={sectionCut.axis === 'x' ? -3.5 : -2.3}
                max={sectionCut.axis === 'x' ? 2.5 : 2.3}
                step={0.02}
                value={sectionCut.offset}
                onChange={(e) => setSectionCut({ offset: +e.target.value })}
              />
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={sectionCut.flip}
                onChange={() => setSectionCut({ flip: !sectionCut.flip })}
              />
              Keep the other side
            </label>
          </>
        )}
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

      {/* --- Spool physics model (Engineering tier) ----------------------- */}
      {learningMode === 'engineering' && (
        <div className="panel-section">
          <div className="panel-subtitle">Spool Dynamics</div>
          <div className="seg">
            <button
              className={`seg-btn${spoolModel === 'torque' ? ' is-active' : ''}`}
              title="Temperature-surplus torque balance: Tt4 is a real state; torque builds first, speed follows."
              onClick={() => setSpoolModel('torque')}
            >
              Torque balance
            </button>
            <button
              className={`seg-btn${spoolModel === 'lag' ? ' is-active' : ''}`}
              title="Classic first-order lags (legacy)."
              onClick={() => setSpoolModel('lag')}
            >
              Classic lag
            </button>
          </div>
        </div>
      )}

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

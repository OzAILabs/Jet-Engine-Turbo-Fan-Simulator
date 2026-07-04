/**
 * CameraControlsPanel
 *
 * A compact DOM control panel that lets the student jump between named camera
 * presets (the "exhibit" viewpoints), switch the projection between an
 * orthographic and a perspective camera, and reset the view.
 *
 * This is a plain DOM panel (not part of the 3D scene), so it subscribes to the
 * store reactively to keep its highlighted/active states in sync.
 */
import { useSimStore } from '../store/useSimStore';
import { CAMERA_PRESET_LIST, CINEMATIC_PRESET_LIST } from '../util/cameraPresets';

export function CameraControlsPanel() {
  // Reactive subscriptions: the active preset highlight and the
  // orthographic/perspective segmented control both depend on these.
  const cameraMode = useSimStore((s) => s.cameraMode);
  const cameraCommand = useSimStore((s) => s.cameraCommand);

  // Actions are stable references, so reading them once is fine.
  const setCameraPreset = useSimStore((s) => s.setCameraPreset);
  const setCameraMode = useSimStore((s) => s.setCameraMode);
  const resetCamera = useSimStore((s) => s.resetCamera);

  return (
    <div className="panel">
      <div className="panel-title">Camera</div>

      {/* One button per named preset, stacked vertically. A preset is marked
          active only when it was the last preset move (not a focus or reset). */}
      <div className="panel-section">
        <div className="btn-row">
          {CAMERA_PRESET_LIST.map((preset) => {
            const isActive =
              cameraCommand.preset === preset.key && cameraCommand.kind !== 'focus';
            return (
              <button
                key={preset.key}
                className={'btn' + (isActive ? ' is-active' : '')}
                onClick={() => setCameraPreset(preset.key)}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cinematic beauty poses (hero / intake / exhaust-low). Deliberately
          always available — not gated to presentation mode: they double as
          screenshot views for the window.__sim capture bridge, and buttons
          that appear/disappear per mode make the panel feel modal. They are
          composed for the perspective camera but degrade fine under ortho. */}
      <div className="panel-section">
        <div className="panel-subtitle">Cinematic</div>
        <div className="btn-row">
          {CINEMATIC_PRESET_LIST.map((preset) => {
            const isActive =
              cameraCommand.preset === preset.key && cameraCommand.kind !== 'focus';
            return (
              <button
                key={preset.key}
                className={'btn' + (isActive ? ' is-active' : '')}
                onClick={() => setCameraPreset(preset.key)}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Projection toggle: orthographic vs. perspective camera. */}
      <div className="panel-section">
        <div className="seg">
          <button
            className={'seg-btn' + (cameraMode === 'orthographic' ? ' is-active' : '')}
            onClick={() => setCameraMode('orthographic')}
          >
            Orthographic
          </button>
          <button
            className={'seg-btn' + (cameraMode === 'perspective' ? ' is-active' : '')}
            onClick={() => setCameraMode('perspective')}
          >
            Perspective
          </button>
        </div>
      </div>

      {/* Return to the default isometric view. */}
      <div className="panel-section">
        <button className="btn" onClick={() => resetCamera()}>
          Reset Camera
        </button>
      </div>
    </div>
  );
}

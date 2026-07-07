/**
 * App — overlay layout. The 3D scene fills the viewport; the control / readout
 * / chart / warning / camera panels float over it like a science-center kiosk.
 */
import { EngineScene } from './components/EngineScene';
import { AssemblyTreePanel } from './components/AssemblyTreePanel';
import { ControlPanel } from './components/ControlPanel';
import { ReadoutPanel } from './components/ReadoutPanel';
import { ChartsPanel } from './components/ChartsPanel';
import { WarningPanel } from './components/WarningPanel';
import { CameraControlsPanel } from './components/CameraControlsPanel';
import { EngineAudio } from './components/EngineAudio';
import { StartPanel } from './components/StartPanel';
import { useSimStore } from './store/useSimStore';
import { DISCLAIMER } from './data/educationalCopy';

export default function App() {
  // Presentation mode collapses the side panel columns to slim hover-reveal
  // edge tabs via pure CSS keyed off this root class (see styles.css). The
  // bottom-center ENGINE START dock is deliberately left untouched.
  const presentationMode = useSimStore((s) => s.presentationMode);
  // Audience tier: 'explore' hides the analytical panels (readouts + charts);
  // the 3D scene, throttle, start panel and EICAS stay for every tier.
  const learningMode = useSimStore((s) => s.learningMode);

  return (
    <div className={`app${presentationMode ? ' is-presentation' : ''}`}>
      <EngineAudio />
      <div className="scene-layer">
        <EngineScene />
      </div>

      <div className="ui-layer">
        <header className="ui-top">
          <div className="title-block">
            <h1>GE90-Inspired Turbofan — Interactive Cutaway</h1>
            <p className="subtitle">Educational high-bypass turbofan simulator</p>
          </div>
        </header>

        <div className="ui-col ui-left">
          <ControlPanel />
          <CameraControlsPanel />
          <AssemblyTreePanel />
        </div>

        <div className="ui-col ui-right">
          <WarningPanel />
          {learningMode !== 'explore' && (
            <>
              <ReadoutPanel />
              <ChartsPanel />
            </>
          )}
        </div>

        <StartPanel />

        <footer className="disclaimer">{DISCLAIMER}</footer>
      </div>
    </div>
  );
}

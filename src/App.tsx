/**
 * App — overlay layout. The 3D scene fills the viewport; the control / readout
 * / chart / warning / camera panels float over it like a science-center kiosk.
 */
import { EngineScene } from './components/EngineScene';
import { ControlPanel } from './components/ControlPanel';
import { ReadoutPanel } from './components/ReadoutPanel';
import { ChartsPanel } from './components/ChartsPanel';
import { WarningPanel } from './components/WarningPanel';
import { CameraControlsPanel } from './components/CameraControlsPanel';
import { EngineAudio } from './components/EngineAudio';
import { StartPanel } from './components/StartPanel';
import { DISCLAIMER } from './data/educationalCopy';

export default function App() {
  return (
    <div className="app">
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
        </div>

        <div className="ui-col ui-right">
          <WarningPanel />
          <ReadoutPanel />
          <ChartsPanel />
        </div>

        <StartPanel />

        <footer className="disclaimer">{DISCLAIMER}</footer>
      </div>
    </div>
  );
}

/**
 * StartPanel — the flip-out engine-start station.
 *
 * A 777-faithful control flow in one fold-out panel:
 *   APU (bleed source) → START/IGNITION selector → FUEL CONTROL switch,
 * monitored on EICAS-style gauges. The displayed logic follows the FCOM:
 *  • The START selector latches and the EEC springs it back to NORM at
 *    starter cutout (~63% N2 — handled in the sim, mirrored here).
 *  • The EGT dial carries the red 750 °C ground-start-limit line whenever the
 *    fuel control is in CUTOFF or N2 is below idle; the line disappearing IS
 *    the "engine stabilized at idle" cue, exactly like the airplane.
 *  • Autostart protections annunciate (hot/hung/no-light → abort, retry with
 *    both igniters); manual starts have no nanny and can cook the engine.
 */
import { useState } from 'react';
import { EicasGauges } from './EicasGauges';
import { useSimStore } from '../store/useSimStore';
import type { EngineRunState } from '../sim/startSequence';

// Short phase labels for the one-touch AUTO-START button while it runs.
const AUTOSTART_PHASE: Partial<Record<EngineRunState, string>> = {
  off: 'APU SPOOL-UP',
  spooldown: 'CLEARING',
  motoring: 'DRY MOTORING',
  fuelOn: 'FUEL ON',
  lightoff: 'LIGHT-OFF',
  accel: 'ACCEL TO IDLE',
  aborting: 'ABORT — MOTORING',
};

// ---------------------------------------------------------------------------
// Status-line text per run state (what a check airman would call out).
// ---------------------------------------------------------------------------
function statusText(runState: EngineRunState, n1Pct: number, attempt: number): string {
  switch (runState) {
    case 'off':
      return n1Pct > 3 ? 'ENGINE OFF — FAN WINDMILLING' : 'ENGINE OFF — COLD AND DARK';
    case 'motoring':
      return 'MOTORING — N2 RISING, OIL PRESSURE CHECK';
    case 'fuelOn':
      return 'FUEL ON — AWAITING LIGHT-OFF';
    case 'lightoff':
      return 'LIGHT-OFF — EGT RISING';
    case 'accel':
      return 'ACCELERATING TO IDLE';
    case 'running':
      return 'STABILIZED — START COMPLETE';
    case 'spooldown':
      return 'FUEL CUT — SPOOLING DOWN';
    case 'aborting':
      return attempt > 1 ? `AUTOSTART ABORT — MOTORING, ATTEMPT ${attempt}` : 'ABORT — MOTORING TO CLEAR FUEL';
  }
}

export function StartPanel() {
  const [open, setOpen] = useState(true);

  const startSeq = useSimStore((s) => s.startSeq);
  const startSelector = useSimStore((s) => s.startSelector);
  const fuelControl = useSimStore((s) => s.fuelControl);
  const autostart = useSimStore((s) => s.autostart);
  const autoStartActive = useSimStore((s) => s.autoStartActive);
  const apuRunning = useSimStore((s) => s.apuRunning);
  const apuBleedPsi = useSimStore((s) => s.apuBleedPsi);
  const igniterFailure = useSimStore((s) => s.igniterFailure);
  const instruments = useSimStore((s) => s.instruments);

  const setStartSelector = useSimStore((s) => s.setStartSelector);
  const setFuelControl = useSimStore((s) => s.setFuelControl);
  const setAutostart = useSimStore((s) => s.setAutostart);
  const runAutostart = useSimStore((s) => s.runAutostart);
  const setApuRunning = useSimStore((s) => s.setApuRunning);
  const setIgniterFailure = useSimStore((s) => s.setIgniterFailure);
  const vbvFailClosed = useSimStore((s) => s.vbvFailClosed);
  const setVbvFailClosed = useSimStore((s) => s.setVbvFailClosed);
  const resetToColdDark = useSimStore((s) => s.resetToColdDark);

  const running = startSeq.runState === 'running';
  const bleedOk = apuBleedPsi >= 25;
  const selectorAngle = startSelector === 'NORM' ? 0 : startSelector === 'START' ? -42 : 42;

  return (
    <div className={`start-dock${open ? ' is-open' : ''}`}>
      <button className="start-tab" onClick={() => setOpen(!open)}>
        {open ? '▼ ' : '▲ '}ENGINE START
        <span className={`tab-state tab-${startSeq.runState}`}>{startSeq.runState.toUpperCase()}</span>
      </button>

      <div className="start-panel">
        {/* ----- One-touch full autostart procedure ------------------------ */}
        <div className="sp-autostart-bar">
          {running ? (
            <button className="sp-autostart is-done" disabled>
              ● ENGINE RUNNING — IDLE
            </button>
          ) : autoStartActive ? (
            <button
              className="sp-autostart is-running"
              onClick={() => resetToColdDark()}
              title="Abort the autostart and return to cold & dark"
            >
              ■ ABORT · {AUTOSTART_PHASE[startSeq.runState] ?? 'STARTING'}
              {instruments.n2Pct > 1 ? ` · N2 ${instruments.n2Pct.toFixed(0)}%` : ''}
            </button>
          ) : (
            <button
              className="sp-autostart"
              onClick={() => runAutostart()}
              title="One click: APU bleed → crank → fuel/ignition → idle, fully sequenced by the EEC"
            >
              ▶ AUTO-START ENGINE
            </button>
          )}
          <span className="sp-autostart-hint">
            {autoStartActive
              ? 'EEC sequencing the start…'
              : running
                ? 'Throttle up, or cut fuel to shut down.'
                : 'Full hands-off start to ground idle.'}
          </span>
        </div>

        <div className="sp-row">
        {/* ----- Column 1: bleed + EEC mode --------------------------------- */}
        <div className="sp-col sp-overhead">
          <div className="sp-section-title">AIR / EEC</div>

          <button
            className={`sp-switch${apuRunning ? ' is-on' : ''}`}
            onClick={() => setApuRunning(!apuRunning)}
          >
            <span className="sp-switch-label">APU</span>
            <span className={`sp-lamp${apuRunning && bleedOk ? ' lamp-green' : apuRunning ? ' lamp-amber' : ''}`}>
              {apuRunning ? (bleedOk ? 'RUN' : 'SPOOLING') : 'OFF'}
            </span>
          </button>
          <div className="sp-readline">
            <span>DUCT PRESS</span>
            <span className={bleedOk ? 'val-ok' : 'val-dim'}>{apuBleedPsi.toFixed(0)} psi</span>
          </div>

          <button
            className={`sp-switch${autostart ? ' is-on' : ''}`}
            onClick={() => setAutostart(!autostart)}
          >
            <span className="sp-switch-label">AUTOSTART</span>
            <span className={`sp-lamp${autostart ? ' lamp-green' : ' lamp-amber'}`}>{autostart ? 'ON' : 'OFF'}</span>
          </button>

          <div className="sp-readline">
            <span>IGNITER</span>
            <span className="val-ok">
              {startSeq.ignitionOn ? `${startSeq.activeIgniter} FIRING` : startSeq.activeIgniter}
            </span>
          </div>
          <div className="sp-readline">
            <span>START VALVE</span>
            <span className={startSeq.starterAirValveOpen ? 'val-warn' : 'val-dim'}>
              {startSeq.starterAirValveOpen ? 'OPEN' : 'CLOSED'}
            </span>
          </div>

          <label className="checkbox sp-failure">
            <input type="checkbox" checked={igniterFailure} onChange={() => setIgniterFailure(!igniterFailure)} />
            Scenario: igniter failure
          </label>
          <label
            className="checkbox sp-failure"
            title="VBV doors stuck closed: the booster can't dump air at low N2. Accelerate hard from idle and the compressor WILL surge."
          >
            <input type="checkbox" checked={vbvFailClosed} onChange={() => setVbvFailClosed(!vbvFailClosed)} />
            Scenario: VBV fail closed
          </label>
        </div>

        {/* ----- Column 2: START/IGNITION rotary selector ------------------- */}
        <div className="sp-col sp-selector">
          <div className="sp-section-title">START / IGNITION</div>
          <div className="sp-rotary">
            <div className="sp-knob" style={{ transform: `rotate(${selectorAngle}deg)` }}>
              <div className="sp-knob-pointer" />
            </div>
            <button
              className={`sp-rotary-pos pos-start${startSelector === 'START' ? ' is-active' : ''}`}
              onClick={() => setStartSelector('START')}
              disabled={startSeq.runState === 'running'}
            >
              START
            </button>
            <button
              className={`sp-rotary-pos pos-norm${startSelector === 'NORM' ? ' is-active' : ''}`}
              onClick={() => setStartSelector('NORM')}
            >
              NORM
            </button>
            <button
              className={`sp-rotary-pos pos-con${startSelector === 'CON' ? ' is-active' : ''}`}
              onClick={() => setStartSelector('CON')}
            >
              CON
            </button>
          </div>

          <div className="sp-section-title sp-fuel-title">FUEL CONTROL</div>
          <div className="sp-fuelswitch">
            <button
              className={`sp-fuel-pos${fuelControl === 'RUN' ? ' is-run' : ''}`}
              onClick={() => setFuelControl('RUN')}
            >
              RUN
            </button>
            <button
              className={`sp-fuel-pos${fuelControl === 'CUTOFF' ? ' is-cutoff' : ''}`}
              onClick={() => setFuelControl('CUTOFF')}
            >
              CUTOFF
            </button>
          </div>

          <button className="btn sp-colddark" onClick={() => resetToColdDark()}>
            Reset Cold &amp; Dark
          </button>
        </div>

        {/* ----- Column 3: EICAS gauges ------------------------------------- */}
        <div className="sp-col sp-eicas">
          <EicasGauges />

          <div className={`sp-status status-${startSeq.runState}`}>
            {statusText(startSeq.runState, instruments.n1Pct, startSeq.attempt)}
          </div>

          {startSeq.fault && (
            <div className={`sp-annunciator${startSeq.fault.kind === 'egtExceedance' ? ' is-red' : ''}`}>
              {startSeq.fault.kind === 'noLight' || startSeq.fault.kind === 'hot' || startSeq.fault.kind === 'hung'
                ? 'ENG AUTOSTART  —  '
                : ''}
              {startSeq.fault.message}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

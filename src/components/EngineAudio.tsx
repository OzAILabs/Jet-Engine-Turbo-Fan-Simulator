import { useEffect } from 'react';
import { engineAudio } from '../audio/engineAudio';
import { useSimStore } from '../store/useSimStore';
import { clamp } from '../sim/units';

/**
 * Bridges the live simulation state to the procedural Web Audio graph.
 * Rendering stays outside React through requestAnimationFrame.
 */
export function EngineAudio() {
  // Sound defaults ON, but a browser AudioContext can only start inside a user
  // gesture. Arm the audio graph on the first interaction anywhere, honouring
  // whatever soundEnabled is at that moment (so a pre-gesture Mute still wins).
  useEffect(() => {
    let armed = false;
    const arm = () => {
      if (armed) return;
      armed = true;
      void engineAudio.setEnabled(useSimStore.getState().soundEnabled);
      remove();
    };
    const remove = () => {
      window.removeEventListener('pointerdown', arm, true);
      window.removeEventListener('keydown', arm, true);
      window.removeEventListener('touchstart', arm, true);
    };
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('keydown', arm, true);
    window.addEventListener('touchstart', arm, true);
    return remove;
  }, []);

  useEffect(() => {
    let frameId = 0;

    const update = () => {
      const {
        config,
        engine,
        spool,
        instruments,
        startSeq,
        actuation,
        soundEnabled,
        soundVolume,
        surgeActive,
      } = useSimStore.getState();
      engineAudio.setVolume(soundVolume);

      if (soundEnabled) {
        engineAudio.update({
          n1: spool.n1,
          n2: spool.n2,
          lpRpm: spool.n1 * config.n1RatedRpm,
          hpRpm: spool.n2 * config.n2RatedRpm,
          thrustFraction: clamp(engine.netThrust / config.designThrust, 0, 1.2),
          massFlowFraction: clamp(engine.totalMassFlow / config.designMassFlow, 0, 1.2),
          coreVelocityFraction: clamp(engine.coreExhaustVelocity / 620, 0, 1.4),
          bypassVelocityFraction: clamp(engine.bypassExhaustVelocity / 300, 0, 1.4),
          fuelFraction: clamp(instruments.fuelFlowKgs / 3.6, 0, 1.2),
          runState: startSeq.runState,
          starterEngaged: startSeq.starterEngaged,
          ignitionOn: startSeq.ignitionOn,
          lit: startSeq.lit,
          egtC: instruments.egtC,
          fuelFlowKgs: instruments.fuelFlowKgs,
          vbvOpenFrac: actuation.vbvOpenFrac,
          surgeActive,
        });
      }

      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return null;
}

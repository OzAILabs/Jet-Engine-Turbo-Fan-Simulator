import { useEffect } from 'react';
import { engineAudio } from '../audio/engineAudio';
import { useSimStore } from '../store/useSimStore';
import { clamp } from '../sim/units';

/**
 * Bridges the live simulation state to the procedural Web Audio graph.
 * Rendering stays outside React through requestAnimationFrame.
 */
export function EngineAudio() {
  useEffect(() => {
    let frameId = 0;

    const update = () => {
      const { config, engine, spool, soundEnabled, soundVolume } = useSimStore.getState();
      engineAudio.setVolume(soundVolume);

      if (soundEnabled) {
        engineAudio.update({
          n1: spool.n1,
          n2: spool.n2,
          lpRpm: spool.n1 * config.lpSpoolRedlineRpm,
          hpRpm: spool.n2 * config.hpSpoolRedlineRpm,
          thrustFraction: clamp(engine.netThrust / config.designThrust, 0, 1.2),
          massFlowFraction: clamp(engine.totalMassFlow / config.designMassFlow, 0, 1.2),
          coreVelocityFraction: clamp(engine.coreExhaustVelocity / 620, 0, 1.4),
          bypassVelocityFraction: clamp(engine.bypassExhaustVelocity / 300, 0, 1.4),
          fuelFraction: clamp(engine.fuelFlow / 3.6, 0, 1.2),
        });
      }

      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return null;
}

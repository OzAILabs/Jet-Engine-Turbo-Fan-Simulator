/**
 * Shareable state URLs — a teacher sets up a scenario, copies the link, and
 * every student opens the SAME machine in the same state.
 *
 * Encoded in the hash (survives static hosting, never hits the server):
 *   run   base scenario (off | idle | takeoff | cruise)
 *   thr   throttle %            alt  altitude ft      mach  Mach
 *   isa   ISA offset °C         view view mode        tier  learning mode
 *   cut   sectionCut axis:offset:flip                 lsn   lesson id
 */
import { useSimStore, type LearningMode, type ViewMode } from '../store/useSimStore';
import { applyScenario, type ScenarioName } from './simBridge';

const RUNS: ScenarioName[] = ['off', 'idle', 'takeoff', 'cruise'];
const VIEWS: ViewMode[] = ['full', 'transparent', 'cutaway', 'exploded', 'internals'];
const TIERS: LearningMode[] = ['explore', 'course', 'engineering'];

/** Build the share URL for the CURRENT store state. */
export function buildShareUrl(): string {
  const s = useSimStore.getState();
  const p = new URLSearchParams();
  // Base scenario from the run state (sub-idle snapshots share as 'off').
  const running = s.startSeq.runState === 'running';
  p.set('run', running ? (s.inputs.altitudeFt > 10000 ? 'cruise' : 'takeoff') : 'off');
  if (running) p.set('thr', String(Math.round(s.inputs.throttle)));
  p.set('alt', String(Math.round(s.inputs.altitudeFt)));
  p.set('mach', s.inputs.mach.toFixed(2));
  p.set('isa', String(Math.round(s.inputs.isaTempOffsetC)));
  p.set('view', s.viewMode);
  p.set('tier', s.learningMode);
  if (s.sectionCut.enabled) {
    p.set('cut', `${s.sectionCut.axis}:${s.sectionCut.offset.toFixed(2)}:${s.sectionCut.flip ? 1 : 0}`);
  }
  return `${window.location.origin}${window.location.pathname}#${p.toString()}`;
}

/** Apply a shared hash on boot. Returns true if anything was applied. */
export function applyUrlState(): boolean {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return false;
  const p = new URLSearchParams(hash);
  if (!p.has('run')) return false;
  const s = useSimStore.getState();

  const tier = p.get('tier') as LearningMode | null;
  if (tier && TIERS.includes(tier)) s.setLearningMode(tier);

  const run = p.get('run') as ScenarioName | null;
  if (run && RUNS.includes(run)) applyScenario(run);

  const num = (key: string): number | null => {
    const v = p.get(key);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const alt = num('alt');
  if (alt !== null) s.setAltitude(alt);
  const mach = num('mach');
  if (mach !== null) s.setMach(mach);
  const isa = num('isa');
  if (isa !== null) s.setIsaOffset(isa);
  const thr = num('thr');
  if (thr !== null) s.setThrottle(thr);

  const view = p.get('view') as ViewMode | null;
  if (view && VIEWS.includes(view)) s.setViewMode(view);

  const cut = p.get('cut');
  if (cut) {
    const [axis, offset, flip] = cut.split(':');
    if (axis === 'x' || axis === 'y' || axis === 'z') {
      const off = Number(offset);
      s.setSectionCut({
        enabled: true,
        axis,
        offset: Number.isFinite(off) ? off : 0,
        flip: flip === '1',
      });
    }
  }
  return true;
}

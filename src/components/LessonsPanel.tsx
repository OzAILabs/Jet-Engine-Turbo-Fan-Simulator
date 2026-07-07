/**
 * LessonsPanel — the guided-lesson catalog + the active narration overlay.
 *
 * Each step declaratively drives the real simulator (scenario, view mode,
 * layers, throttle, overlays, camera) through the store's own actions and
 * the sim bridge — the same paths the UI uses, so a lesson can never desync
 * from reality. Training side-effects (VBV failure, forced overlays) are
 * snapshotted on entry and restored on exit.
 */
import { useRef, useState } from 'react';
import { LESSONS, type Lesson, type LessonStep } from '../data/lessons';
import { useSimStore } from '../store/useSimStore';
import { applyScenario } from '../util/simBridge';

const TIER_RANK = { explore: 0, course: 1, engineering: 2 } as const;

function applyStep(step: LessonStep) {
  const s = useSimStore.getState();
  if (step.scenario) applyScenario(step.scenario);
  if (step.viewMode) s.setViewMode(step.viewMode); // resets layers ON
  step.layersOff?.forEach((id) => {
    if (useSimStore.getState().layers[id]) s.toggleLayer(id);
  });
  if (step.throttle !== undefined) s.setThrottle(step.throttle);
  if (step.secondaryFlows !== undefined && s.showSecondaryFlows !== step.secondaryFlows) {
    s.toggle('showSecondaryFlows');
  }
  if (step.vbvFailClosed !== undefined) s.setVbvFailClosed(step.vbvFailClosed);
  if (step.preset) s.snapCamera(step.preset);
  else if (step.focus) s.focusOn(step.focus);
}

export function LessonsPanel() {
  const learningMode = useSimStore((s) => s.learningMode);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Lesson | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const preLesson = useRef<{ vbvFailClosed: boolean; secondaryFlows: boolean } | null>(null);

  const catalog = LESSONS.filter((l) => TIER_RANK[l.tier] <= TIER_RANK[learningMode]);

  const start = (lesson: Lesson) => {
    const s = useSimStore.getState();
    preLesson.current = { vbvFailClosed: s.vbvFailClosed, secondaryFlows: s.showSecondaryFlows };
    setActive(lesson);
    setStepIdx(0);
    applyStep(lesson.steps[0]);
  };

  const exit = () => {
    const s = useSimStore.getState();
    const pre = preLesson.current;
    if (pre) {
      s.setVbvFailClosed(pre.vbvFailClosed);
      if (s.showSecondaryFlows !== pre.secondaryFlows) s.toggle('showSecondaryFlows');
    }
    setActive(null);
    setStepIdx(0);
  };

  const go = (delta: number) => {
    if (!active) return;
    const next = stepIdx + delta;
    if (next < 0) return;
    if (next >= active.steps.length) {
      exit();
      return;
    }
    setStepIdx(next);
    applyStep(active.steps[next]);
  };

  const step = active?.steps[stepIdx];

  return (
    <>
      <div className="panel">
        <div className="panel-title">
          <button className={`btn${open ? ' is-active' : ''}`} onClick={() => setOpen((v) => !v)}>
            Lessons {open ? '▾' : '▸'}
          </button>
        </div>
        {open &&
          catalog.map((l) => (
            <div key={l.id} className="ls-item">
              <button
                className={`ls-start${active?.id === l.id ? ' is-active' : ''}`}
                onClick={() => start(l)}
              >
                {l.title}
              </button>
              <div className="ls-blurb">{l.blurb}</div>
            </div>
          ))}
      </div>

      {active && step && (
        <div className="lesson-overlay">
          <div className="lesson-head">
            <span className="lesson-title">{active.title}</span>
            <span className="lesson-count">
              {stepIdx + 1} / {active.steps.length}
            </span>
          </div>
          <div className="lesson-step-title">{step.title}</div>
          <p className="lesson-narration">{step.narration}</p>
          <div className="lesson-nav">
            <button className="btn" onClick={() => go(-1)} disabled={stepIdx === 0}>
              ‹ Back
            </button>
            <button className="btn" onClick={exit}>
              Exit
            </button>
            <button className="btn is-active" onClick={() => go(1)}>
              {stepIdx === active.steps.length - 1 ? 'Finish' : 'Next ›'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

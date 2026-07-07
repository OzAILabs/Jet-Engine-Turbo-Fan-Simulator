/**
 * ChallengesPanel — pick a challenge, fly it, get judged by the physics.
 * A 5 Hz watcher accumulates observations from the live store; the
 * challenge's judge ends the run with feedback. Hints reveal one at a time.
 */
import { useEffect, useRef, useState } from 'react';
import { CHALLENGES, type Challenge, type Verdict } from '../data/challenges';
import { useSimStore } from '../store/useSimStore';

const TIER_RANK = { explore: 0, course: 1, engineering: 2 } as const;

export function ChallengesPanel() {
  const learningMode = useSimStore((s) => s.learningMode);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Challenge | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [hintsShown, setHintsShown] = useState(0);
  const acc = useRef<Record<string, number>>({});

  const catalog = CHALLENGES.filter((c) => TIER_RANK[c.tier] <= TIER_RANK[learningMode]);

  const start = (c: Challenge) => {
    acc.current = {};
    setVerdict(null);
    setHintsShown(0);
    c.arm();
    setActive(c);
  };

  const stop = () => {
    setActive(null);
    setVerdict(null);
  };

  useEffect(() => {
    if (!active || verdict) return;
    const id = window.setInterval(() => {
      const s = useSimStore.getState();
      if (s.paused) return;
      active.watch(s, acc.current);
      const v = active.judge(s, acc.current);
      if (v) setVerdict(v);
    }, 200);
    return () => window.clearInterval(id);
  }, [active, verdict]);

  return (
    <>
      <div className="panel">
        <div className="panel-title">
          <button className={`btn${open ? ' is-active' : ''}`} onClick={() => setOpen((v) => !v)}>
            Challenges {open ? '▾' : '▸'}
          </button>
        </div>
        {open &&
          catalog.map((c) => (
            <div key={c.id} className="ls-item">
              <button
                className={`ls-start${active?.id === c.id ? ' is-active' : ''}`}
                onClick={() => start(c)}
              >
                {c.title}
              </button>
            </div>
          ))}
      </div>

      {active && (
        <div className="lesson-overlay">
          <div className="lesson-head">
            <span className="lesson-title">Challenge — {active.title}</span>
            <span className={`lesson-count${verdict ? (verdict.passed ? ' ch-pass' : ' ch-fail') : ''}`}>
              {verdict ? (verdict.passed ? 'PASSED' : 'FAILED') : 'LIVE'}
            </span>
          </div>
          <p className="lesson-narration">{verdict ? verdict.feedback : active.brief}</p>
          <div className="lesson-nav">
            {!verdict && hintsShown < active.hints.length && (
              <button className="btn" onClick={() => setHintsShown((n) => n + 1)}>
                Hint ({hintsShown}/{active.hints.length})
              </button>
            )}
            {verdict && (
              <button className="btn" onClick={() => start(active)}>
                Retry
              </button>
            )}
            <button className="btn" onClick={stop}>
              Close
            </button>
          </div>
          {!verdict && hintsShown > 0 && (
            <ul className="ch-hints">
              {active.hints.slice(0, hintsShown).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

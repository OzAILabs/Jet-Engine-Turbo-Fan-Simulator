/**
 * WarningPanel — a 777-style EICAS message stack with master lights.
 *
 * Messages come from three feeds and are merged into one prioritized stack,
 * exactly like the real display orders them:
 *   WARNING  (red)    engine.warnings severity 'critical', plus start faults
 *                     that represent limit exceedances (hot start / EGT).
 *   CAUTION  (amber)  engine.warnings severity 'caution', other start faults,
 *                     and the rapid-throttle surge-margin transient note.
 *   ADVISORY (white)  engine.warnings severity 'info'.
 *
 * MASTER WARNING / MASTER CAUTION lights sit above the stack (Korry-style
 * push-to-cancel): a light comes on whenever a message of its class appears
 * that has not been acknowledged; PUSHING the lit light cancels (acknowledges
 * the current set — the messages stay in the stack, the light goes out); a NEW
 * message re-lights it. RECALL clears all acknowledgements so the lights
 * re-assert — the recall/cancel cycle real crews use.
 *
 * Subscriptions stay narrow (warnings / fault / transient slices only), so
 * unrelated UI changes never re-render this panel.
 */
import { useState } from 'react';
import { useSimStore } from '../store/useSimStore';

type MsgClass = 'warning' | 'caution' | 'advisory';

interface EicasMessage {
  id: string;
  cls: MsgClass;
  text: string;
}

/** Start-fault kinds that are limit exceedances → red WARNING class. */
const FAULT_WARNING_KINDS = new Set(['hot', 'egtExceedance']);

const CLS_ORDER: Record<MsgClass, number> = { warning: 0, caution: 1, advisory: 2 };

export function WarningPanel() {
  // Reactive subscriptions: only re-render when one of these slices changes.
  const warnings = useSimStore((s) => s.engine.warnings);
  const fault = useSimStore((s) => s.startSeq.fault);
  const transientActive = useSimStore((s) => s.transientActive);
  const surgeMargin = useSimStore((s) => s.surgeMargin);

  // Acknowledged message ids: cancelling a master light acks the messages of
  // that class that are CURRENTLY displayed; a new id re-lights the master.
  const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());

  // --- Merge the three feeds into one prioritized stack ---------------------
  const stack: EicasMessage[] = warnings.map((w) => ({
    id: w.id,
    cls: w.severity === 'critical' ? 'warning' : w.severity === 'caution' ? 'caution' : 'advisory',
    text: w.message,
  }));
  if (fault) {
    stack.push({
      id: `fault-${fault.kind}`,
      cls: FAULT_WARNING_KINDS.has(fault.kind) ? 'warning' : 'caution',
      text: fault.message,
    });
  }
  if (transientActive) {
    stack.push({
      id: 'transient-surge',
      cls: 'caution',
      text: `Throttle transient — surge margin ${surgeMargin.toFixed(0)}%`,
    });
  }
  stack.sort((a, b) => CLS_ORDER[a.cls] - CLS_ORDER[b.cls]);

  const unackedOf = (cls: MsgClass) => stack.some((m) => m.cls === cls && !acked.has(m.id));
  const masterWarning = unackedOf('warning');
  const masterCaution = unackedOf('caution');

  /** Push-to-cancel: acknowledge every currently-displayed message of a class. */
  const cancel = (cls: MsgClass) => {
    setAcked((prev) => {
      const next = new Set(prev);
      for (const m of stack) if (m.cls === cls) next.add(m.id);
      return next;
    });
  };
  /** RECALL: drop all acknowledgements so active messages re-assert. */
  const recall = () => setAcked(new Set());

  return (
    <div className="panel">
      <div className="panel-title">EICAS — Warnings</div>

      {/* Master lights: push a LIT light to cancel; RECALL re-asserts. */}
      <div className="eicas-masters">
        <button
          className={`eicas-master is-warning${masterWarning ? ' is-lit' : ''}`}
          onClick={() => cancel('warning')}
          title="Push to cancel master warning"
        >
          WARNING
        </button>
        <button
          className={`eicas-master is-caution${masterCaution ? ' is-lit' : ''}`}
          onClick={() => cancel('caution')}
          title="Push to cancel master caution"
        >
          CAUTION
        </button>
        <button className="eicas-recall" onClick={recall} title="Re-assert acknowledged messages">
          RECALL
        </button>
      </div>

      <div className="eicas-stack">
        {stack.map((m) => (
          <div key={m.id} className={`eicas-msg is-${m.cls}`}>
            {m.text}
          </div>
        ))}
        {stack.length === 0 ? <div className="eicas-msg is-ok">ALL PARAMETERS NOMINAL</div> : null}
      </div>
    </div>
  );
}

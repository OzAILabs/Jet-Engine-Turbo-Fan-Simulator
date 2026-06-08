/**
 * WarningPanel
 *
 * A plain DOM panel (lives in the HTML overlay, NOT inside the 3D canvas) that
 * surfaces the engine model's active warnings to the student.
 *
 * It subscribes reactively to just three narrow store slices:
 *   - engine.warnings   the list of warnings produced by the steady solution
 *   - transientActive   true while a rapid throttle change is eating surge margin
 *   - surgeMargin       the live surge margin (read so the panel re-renders as it
 *                       moves; the transient note tells students to watch it)
 *
 * Because each selector is narrow, unrelated UI changes (camera, view mode,
 * slider drags that do not change warnings) will not re-render this panel.
 *
 * Severity maps to a CSS modifier on each .warn row:
 *   caution  -> .is-caution
 *   critical -> .is-critical
 *   info     -> (plain .warn, no modifier)
 *
 * When nothing is wrong (no warnings AND no active transient) we show a single
 * reassuring "All parameters nominal." row using the .is-ok modifier.
 */
import { useSimStore } from '../store/useSimStore';
import type { WarningSeverity } from '../sim/types';

/**
 * Build the className for a single warning row from its severity. Critical and
 * caution get a modifier class; info warnings render as a plain .warn row.
 */
function warnClass(severity: WarningSeverity): string {
  if (severity === 'critical') return 'warn is-critical';
  if (severity === 'caution') return 'warn is-caution';
  return 'warn';
}

export function WarningPanel() {
  // Reactive subscriptions: only re-render when one of these slices changes.
  const warnings = useSimStore((s) => s.engine.warnings);
  const transientActive = useSimStore((s) => s.transientActive);
  // Subscribing to surgeMargin keeps the panel live while a transient is active
  // (the transient note asks the student to watch this value as it changes).
  const surgeMargin = useSimStore((s) => s.surgeMargin);

  // "Everything is fine" only when there is nothing to report at all.
  const allNominal = warnings.length === 0 && !transientActive;

  return (
    <div className="panel">
      <div className="panel-title">Warnings</div>

      <div className="warns">
        {/* One row per model warning, styled by severity. */}
        {warnings.map((w) => (
          <div key={w.id} className={warnClass(w.severity)}>
            {w.message}
          </div>
        ))}

        {/* A rapid throttle change temporarily erodes surge margin; flag it. */}
        {transientActive ? (
          <div className="warn is-caution">
            Rapid throttle transient - watch surge margin ({surgeMargin.toFixed(0)}%).
          </div>
        ) : null}

        {/* Nothing wrong: a single reassuring row. */}
        {allNominal ? <div className="warn is-ok">All parameters nominal.</div> : null}
      </div>
    </div>
  );
}

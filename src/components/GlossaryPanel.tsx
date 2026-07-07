/**
 * GlossaryPanel — searchable propulsion vocabulary, audience-gated by the
 * learning tier and cross-linked (click a related term to jump). Data in
 * src/data/glossary.ts, written against THIS sim's conventions.
 */
import { useMemo, useState } from 'react';
import { GLOSSARY, glossaryForTier } from '../data/glossary';
import { useSimStore } from '../store/useSimStore';

export function GlossaryPanel() {
  const learningMode = useSimStore((s) => s.learningMode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const entries = useMemo(() => glossaryForTier(learningMode), [learningMode]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      ([, e]) => e.term.toLowerCase().includes(q) || e.short.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const selected = selectedKey ? GLOSSARY[selectedKey] : undefined;

  return (
    <div className="panel">
      <div className="panel-title">
        <button className={`btn${open ? ' is-active' : ''}`} onClick={() => setOpen((v) => !v)}>
          Glossary {open ? '▾' : '▸'}
        </button>
      </div>
      {open && (
        <>
          <input
            className="gl-search"
            placeholder="Search terms…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="gl-list">
            {filtered.map(([key, e]) => (
              <button
                key={key}
                className={`gl-term${selectedKey === key ? ' is-active' : ''}`}
                onClick={() => setSelectedKey(key)}
                title={e.short}
              >
                {e.term}
              </button>
            ))}
          </div>
          {selected && (
            <div className="panel-section">
              <div className="panel-subtitle">{selected.term}</div>
              <p className="gl-short">{selected.short}</p>
              <p className="gl-detail">{selected.detail}</p>
              {selected.formula && <code className="gl-formula">{selected.formula}</code>}
              {selected.related && selected.related.some((r) => GLOSSARY[r]) && (
                <div className="gl-related">
                  {selected.related
                    .filter((r) => GLOSSARY[r])
                    .map((r) => (
                      <button key={r} className="gl-link" onClick={() => setSelectedKey(r)}>
                        {GLOSSARY[r].term}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

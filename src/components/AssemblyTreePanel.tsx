/**
 * AssemblyTreePanel — the engine as the modular stack it really is.
 *
 * A collapsible hierarchy (module → subassembly); clicking a node flies the
 * camera to it (store.focusOn) and shows its story card — what the part is
 * and WHY it exists. Works in every view mode and composes with layers and
 * the section cut, so "fly to the HPC, cut it in half, hide the stators" is
 * three clicks.
 *
 * Data lives in src/data/assemblyTree.ts (geometry references from
 * engineLayout — the single source of truth).
 */
import { useState } from 'react';
import { ASSEMBLY_INDEX, ASSEMBLY_TREE, type AssemblyNode } from '../data/assemblyTree';
import { useSimStore } from '../store/useSimStore';

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: AssemblyNode;
  depth: number;
  selectedId: string | null;
  onSelect: (n: AssemblyNode) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasKids = (node.children?.length ?? 0) > 0;
  return (
    <div className="at-node" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      <div className="at-row">
        {hasKids ? (
          <button className="at-twist" onClick={() => setOpen((v) => !v)}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="at-twist at-leaf">•</span>
        )}
        <button
          className={`at-label${selectedId === node.id ? ' is-active' : ''}`}
          onClick={() => onSelect(node)}
        >
          {node.label}
        </button>
      </div>
      {open &&
        node.children?.map((c) => (
          <TreeNode key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
        ))}
    </div>
  );
}

export function AssemblyTreePanel() {
  const focusOn = useSimStore((s) => s.focusOn);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const select = (n: AssemblyNode) => {
    setSelectedId(n.id);
    focusOn(n.focus);
  };

  const selected = selectedId ? ASSEMBLY_INDEX.get(selectedId) : undefined;

  return (
    <div className="panel">
      <div className="panel-title">
        <button className={`btn${open ? ' is-active' : ''}`} onClick={() => setOpen((v) => !v)}>
          Assemblies {open ? '▾' : '▸'}
        </button>
      </div>
      {open && (
        <>
          <TreeNode node={ASSEMBLY_TREE} depth={0} selectedId={selectedId} onSelect={select} />
          {selected && (
            <div className="panel-section at-card">
              <div className="panel-subtitle">{selected.label}</div>
              <p className="at-desc">{selected.description}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

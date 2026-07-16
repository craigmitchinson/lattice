import { useMemo, type ReactNode } from 'react';
import { useLatticeStore } from '../store.ts';
import { impact } from '../../lib/graph/impact.ts';
import { impactToCsv } from '../../lib/graph/csv.ts';
import { downloadText } from '../lib/download.ts';
import type { ImpactGroup, NodeResolution } from '../../lib/graph/types.ts';

const DEPTH_OPTIONS = [1, 2, 3, 4, 5];

function resolutionBadge(resolution: NodeResolution): ReactNode {
  if (resolution === 'external') return <span className="badge badge-external">external or missing</span>;
  if (resolution === 'dynamic') return <span className="badge badge-dynamic">dynamic</span>;
  return <span className="badge badge-resolved">resolved</span>;
}

function ImpactColumn({
  title,
  groups,
  emptyMessage,
  onSelect,
}: {
  title: string;
  groups: ImpactGroup[];
  emptyMessage: string;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <div>
      <h2 className="panel-title">{title}</h2>
      {groups.length === 0 ? (
        <p className="empty-state">{emptyMessage}</p>
      ) : (
        groups.map((group) => (
          <div key={group.kind}>
            <h3 className="impact-group-heading">
              {group.kind} ({group.nodes.length})
            </h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Depth</th>
                    <th>Via</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {group.nodes.map((row) => (
                    <tr key={row.node.id} className="clickable" onClick={() => onSelect(row.node.id)}>
                      <td className="mono">{row.node.name}</td>
                      <td>{row.depth}</td>
                      <td className="mono">{row.via}</td>
                      <td>{row.evidence.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function ImpactView() {
  const graph = useLatticeStore((s) => s.graph);
  const selection = useLatticeStore((s) => s.selection);
  const impactDepth = useLatticeStore((s) => s.impactDepth);
  const setDepth = useLatticeStore((s) => s.setDepth);
  const select = useLatticeStore((s) => s.select);

  const result = useMemo(() => {
    if (!graph || !selection) return null;
    return impact(graph, selection.nodeId, impactDepth);
  }, [graph, selection, impactDepth]);

  if (!graph || !selection || !result) {
    return (
      <div className="view">
        <p className="empty-state">Select an item from the estate browser to see its impact.</p>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">{result.root.name}</h1>
        <span className="view-subtitle">
          {result.root.kind} {resolutionBadge(result.root.resolution)}{' '}
          {result.root.provenance.map((p) => p.fileName).join(', ')}
        </span>
      </div>

      <div className="filter-row">
        <label>
          Depth
          <select value={impactDepth} onChange={(e) => setDepth(Number(e.target.value))}>
            {DEPTH_OPTIONS.map((depth) => (
              <option key={depth} value={depth}>
                {depth}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="btn-row">
        <button type="button" className="btn" onClick={() => downloadText('lattice-impact.csv', 'text/csv', impactToCsv(result))}>
          Export impact CSV
        </button>
      </div>

      <div className="impact-columns">
        <ImpactColumn
          title="Depends on"
          groups={result.upstream}
          emptyMessage="No dependencies found in the imported set."
          onSelect={select}
        />
        <ImpactColumn
          title="Depended on by"
          groups={result.downstream}
          emptyMessage="No consumers found in the imported set."
          onSelect={select}
        />
      </div>
    </div>
  );
}

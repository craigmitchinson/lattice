import { useMemo, type ReactNode } from 'react';
import { useLatticeStore } from '../store.ts';
import { BROWSER_KINDS, filterBrowserNodes } from '../lib/filters.ts';
import { estateInventoryCsv } from '../../lib/graph/csv.ts';
import { downloadText } from '../lib/download.ts';
import type { GraphNode, NodeKind, NodeResolution } from '../../lib/graph/types.ts';

const RESOLUTION_OPTIONS: { value: NodeResolution | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'resolved', label: 'resolved' },
  { value: 'external', label: 'external or missing' },
  { value: 'dynamic', label: 'dynamic' },
];

function resolutionBadge(resolution: NodeResolution): ReactNode {
  if (resolution === 'external') return <span className="badge badge-external">external or missing</span>;
  if (resolution === 'dynamic') return <span className="badge badge-dynamic">dynamic</span>;
  return null;
}

export function EstateBrowserView() {
  const graph = useLatticeStore((s) => s.graph);
  const browserFilters = useLatticeStore((s) => s.browserFilters);
  const setBrowserSearch = useLatticeStore((s) => s.setBrowserSearch);
  const setBrowserKindFilter = useLatticeStore((s) => s.setBrowserKindFilter);
  const setBrowserResolutionFilter = useLatticeStore((s) => s.setBrowserResolutionFilter);
  const select = useLatticeStore((s) => s.select);

  const rows = useMemo<GraphNode[]>(() => {
    if (!graph) return [];
    const nodes: GraphNode[] = [];
    for (const kind of BROWSER_KINDS) {
      const ids = graph.byKind.get(kind) ?? [];
      for (const id of ids) {
        const node = graph.nodes.get(id);
        if (node) nodes.push(node);
      }
    }
    return filterBrowserNodes(nodes, browserFilters);
  }, [graph, browserFilters]);

  if (!graph) {
    return (
      <div className="view">
        <p className="empty-state">No estate imported yet.</p>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Estate browser</h1>
        <span className="view-subtitle">{rows.length} items</span>
      </div>

      <div className="filter-row">
        <label>
          Search
          <input
            type="text"
            value={browserFilters.search}
            onChange={(e) => setBrowserSearch(e.target.value)}
            placeholder="Search by name"
          />
        </label>
        <label>
          Kind
          <select
            value={browserFilters.kind}
            onChange={(e) => setBrowserKindFilter(e.target.value as NodeKind | 'all')}
          >
            <option value="all">All kinds</option>
            {BROWSER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          Resolution
          <select
            value={browserFilters.resolution}
            onChange={(e) => setBrowserResolutionFilter(e.target.value as NodeResolution | 'all')}
          >
            {RESOLUTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn"
          onClick={() => downloadText('lattice-estate-inventory.csv', 'text/csv', estateInventoryCsv(graph))}
        >
          Export inventory CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="empty-state">No items match the current search and filters.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name</th>
                <th>Version</th>
                <th>BP version</th>
                <th>Consumers</th>
                <th>Resolution</th>
                <th>Source files</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((node) => (
                <tr key={node.id} className="clickable" onClick={() => select(node.id)}>
                  <td>{node.kind}</td>
                  <td className="mono">{node.name}</td>
                  <td className="mono">{node.data.version ?? ''}</td>
                  <td className="mono">{node.data.bpversion ?? ''}</td>
                  <td>{graph.consumers.get(node.id)?.size ?? 0}</td>
                  <td>{resolutionBadge(node.resolution)}</td>
                  <td>{node.provenance.map((p) => p.fileName).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

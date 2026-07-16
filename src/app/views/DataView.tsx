import { useState } from 'react';
import { useLatticeStore } from '../store.ts';
import { SCHEMA_VERSION } from '../../lib/persist/schema.ts';
import { graphToJson } from '../../lib/graph/serialise.ts';
import { downloadText } from '../lib/download.ts';

export function DataView() {
  const fileEntries = useLatticeStore((s) => s.fileEntries);
  const releases = useLatticeStore((s) => s.releases);
  const graph = useLatticeStore((s) => s.graph);
  const discardedStale = useLatticeStore((s) => s.discardedStale);
  const clearEverything = useLatticeStore((s) => s.clearEverything);

  const [clearArmed, setClearArmed] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  function handleClearClick(): void {
    if (clearing) return;
    if (!clearArmed) {
      setClearArmed(true);
      setClearError(null);
      return;
    }
    setClearing(true);
    setClearError(null);
    clearEverything()
      .catch((err: unknown) => {
        setClearError(err instanceof Error ? err.message : 'Failed to clear local data.');
      })
      .finally(() => {
        setClearing(false);
        setClearArmed(false);
      });
  }

  return (
    <div className="view">
      <h1 className="view-title">Data</h1>

      <div className="panel">
        <h2 className="panel-title">Local storage</h2>
        <div className="stat-grid">
          <div className="stat-tile">
            <span className="stat-value">{fileEntries.length}</span>
            <span className="stat-label">Files attempted this session</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{releases.length}</span>
            <span className="stat-label">Releases stored</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{SCHEMA_VERSION}</span>
            <span className="stat-label">Schema version</span>
          </div>
        </div>
        {discardedStale > 0 && (
          <p className="empty-state">
            {discardedStale} cached files from an older parser version were discarded.
          </p>
        )}
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn"
          disabled={graph === null}
          onClick={() => {
            if (graph) downloadText('lattice-estate-graph.json', 'application/json', graphToJson(graph));
          }}
        >
          Export graph as JSON
        </button>
        <button type="button" className="btn btn-danger" disabled={clearing} onClick={handleClearClick}>
          {clearing ? 'Clearing...' : clearArmed ? 'Click again to confirm' : 'Clear all local data'}
        </button>
      </div>
      {clearArmed && !clearing && (
        <p className="empty-state">This cannot be undone: all imported releases will be removed from this browser.</p>
      )}
      {clearError && <p className="empty-state">{clearError}</p>}
    </div>
  );
}

import { useMemo } from 'react';
import { useLatticeStore } from '../store.ts';
import type { PathInfo } from '../../lib/discovery/discover.ts';

function attributeSummary(info: PathInfo): string {
  return Object.entries(info.attributes)
    .map(([name, attr]) => {
      const examples = attr.examples.map((ex) => `"${ex}"`).join(', ');
      return `${name} (${attr.count}): ${examples}`;
    })
    .join('; ');
}

export function DiscoveryView() {
  const discovery = useLatticeStore((s) => s.discovery);

  const rows = useMemo<PathInfo[]>(() => {
    if (!discovery) return [];
    return Object.values(discovery.paths).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }, [discovery]);

  return (
    <div className="view">
      <h1 className="view-title">Schema discovery</h1>
      <p className="view-note">
        Schema discovery: every element and attribute encountered across imported files. Grounds the parser in real
        export structure.
      </p>

      {!discovery ? (
        <p className="empty-state">No schema discovery data yet. Import files in this session to populate it.</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">No schema discovery data yet. Import files in this session to populate it.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table mono">
            <thead>
              <tr>
                <th>Element path</th>
                <th>Count</th>
                <th>Attributes</th>
                <th>Text examples</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((info) => (
                <tr key={info.path}>
                  <td>{info.path}</td>
                  <td>{info.count}</td>
                  <td>{attributeSummary(info)}</td>
                  <td>{info.hasText ? info.textExamples.join('; ') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { describe, expect, it } from 'vitest';
import type { DuplicateRecord, EstateGraph, GraphNode } from '../../lib/graph/types.ts';
import type { FileEntry } from './fileEntry.ts';
import { deriveBatchSummary } from './batchSummary.ts';

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return { id: 'process:test', kind: 'process', name: 'Test', resolution: 'resolved', provenance: [], data: {}, ...overrides };
}

function makeGraph(overrides: Partial<EstateGraph> = {}): EstateGraph {
  return {
    nodes: new Map(),
    edges: [],
    outEdges: new Map(),
    inEdges: new Map(),
    byKind: new Map(),
    consumers: new Map(),
    duplicates: [],
    ...overrides,
  };
}

function entry(overrides: Partial<FileEntry>): FileEntry {
  return { id: overrides.fileName ?? 'a', fileName: 'a.bprelease', status: 'done', ...overrides };
}

describe('deriveBatchSummary', () => {
  it('tallies file status counts', () => {
    const entries: FileEntry[] = [
      entry({ status: 'done' }),
      entry({ status: 'done' }),
      entry({ status: 'failed' }),
      entry({ status: 'duplicate' }),
      entry({ status: 'queued' }),
      entry({ status: 'parsing' }),
    ];
    const summary = deriveBatchSummary(entries, null);
    expect(summary.totalFiles).toBe(6);
    expect(summary.done).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.duplicate).toBe(1);
    expect(summary.queued).toBe(1);
    expect(summary.parsing).toBe(1);
  });

  it('sums item counts across all file entries', () => {
    const entries: FileEntry[] = [
      entry({ itemCounts: { processes: 2, objects: 1, workQueues: 0, environmentVariables: 0, credentials: 0, otherItems: 0 } }),
      entry({ itemCounts: { processes: 1, objects: 0, workQueues: 3, environmentVariables: 1, credentials: 1, otherItems: 2 } }),
    ];
    const summary = deriveBatchSummary(entries, null);
    expect(summary.itemsByType).toEqual({
      processes: 3,
      objects: 1,
      workQueues: 3,
      environmentVariables: 1,
      credentials: 1,
      otherItems: 2,
    });
  });

  it('collects distinct, sorted bpversions across file entries', () => {
    const entries: FileEntry[] = [entry({ bpversions: ['7.2', '7.1'] }), entry({ bpversions: ['7.1'] })];
    expect(deriveBatchSummary(entries, null).distinctBpVersions).toEqual(['7.1', '7.2']);
  });

  it('reports zeroed graph-derived fields when there is no graph yet', () => {
    const summary = deriveBatchSummary([], null);
    expect(summary.duplicateConflicts).toBe(0);
    expect(summary.externalOrMissingCount).toBe(0);
    expect(summary.dynamicCount).toBe(0);
  });

  it('reads duplicate conflicts from graph.duplicates', () => {
    const duplicate: DuplicateRecord = {
      kind: 'process',
      name: 'Invoice Bot',
      kept: { fileName: 'b.bprelease', contentHash: 'h2', version: '2.0' },
      discarded: [{ fileName: 'a.bprelease', contentHash: 'h1', version: '1.0' }],
    };
    const graph = makeGraph({ duplicates: [duplicate] });
    expect(deriveBatchSummary([], graph).duplicateConflicts).toBe(1);
  });

  it('counts external and dynamic nodes from the graph', () => {
    const nodes = new Map<string, GraphNode>();
    nodes.set('process:a', makeNode({ id: 'process:a', resolution: 'resolved' }));
    nodes.set('process:b', makeNode({ id: 'process:b', resolution: 'external' }));
    nodes.set('process:c', makeNode({ id: 'process:c', resolution: 'external' }));
    nodes.set('queue:(empty)', makeNode({ id: 'queue:(empty)', kind: 'workQueue', resolution: 'dynamic' }));
    const graph = makeGraph({ nodes });

    const summary = deriveBatchSummary([], graph);
    expect(summary.externalOrMissingCount).toBe(2);
    expect(summary.dynamicCount).toBe(1);
  });
});

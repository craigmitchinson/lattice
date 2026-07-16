import { describe, expect, it } from 'vitest';
import { estateInventoryCsv, impactToCsv } from './csv.ts';
import type { EstateGraph, GraphNode, ImpactResult } from './types.ts';

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'process:test',
    kind: 'process',
    name: 'Test',
    resolution: 'resolved',
    provenance: [],
    data: {},
    ...overrides,
  };
}

function emptyGraph(): EstateGraph {
  return {
    nodes: new Map(),
    edges: [],
    outEdges: new Map(),
    inEdges: new Map(),
    byKind: new Map(),
    consumers: new Map(),
    duplicates: [],
  };
}

describe('impactToCsv', () => {
  it('quotes fields with commas, embedded quotes and newlines', () => {
    const node = makeNode({
      name: 'Invoice, Bot "Prime"\nSecond line',
      provenance: [{ fileName: 'file, a.bprelease', contentHash: 'h1' }],
    });
    const result: ImpactResult = {
      root: makeNode({ id: 'process:root' }),
      upstream: [{ kind: 'process', nodes: [{ node, depth: 1, via: 'calls-process', evidence: ['stage:x:1'] }] }],
      downstream: [],
      depth: 5,
    };

    const csv = impactToCsv(result);
    // The embedded newline means naive line-splitting cuts the row in two;
    // check the header and the full quoted row as substrings instead.
    expect(csv.startsWith('direction,depth,kind,name,resolution,via,evidence_count,source_files\n')).toBe(true);
    expect(csv).toContain(
      'upstream,1,process,"Invoice, Bot ""Prime""\nSecond line",resolved,calls-process,1,"file, a.bprelease"',
    );
  });

  it('leaves a plain field with no special characters unquoted', () => {
    const node = makeNode({ name: 'PlainName', provenance: [{ fileName: 'plain.bprelease', contentHash: 'h1' }] });
    const result: ImpactResult = {
      root: makeNode({ id: 'process:root' }),
      upstream: [{ kind: 'process', nodes: [{ node, depth: 2, via: 'invokes-action', evidence: [] }] }],
      downstream: [],
      depth: 5,
    };
    const csv = impactToCsv(result);
    expect(csv.split('\n')[1]).toBe('upstream,2,process,PlainName,resolved,invokes-action,0,plain.bprelease');
  });

  it('the root node itself is not a row', () => {
    const result: ImpactResult = {
      root: makeNode({ id: 'process:root', name: 'Root' }),
      upstream: [],
      downstream: [],
      depth: 5,
    };
    const csv = impactToCsv(result);
    expect(csv.split('\n')).toHaveLength(1);
    expect(csv).not.toContain('Root');
  });
});

describe('estateInventoryCsv', () => {
  it('quotes fields per RFC 4180', () => {
    const graph = emptyGraph();
    const node = makeNode({
      id: 'process:quoted',
      name: 'Has "Quotes", and comma',
      data: { version: '1.0', bpversion: '7.1' },
      provenance: [
        { fileName: 'a.bprelease', contentHash: 'h1' },
        { fileName: 'b.bprelease', contentHash: 'h2' },
      ],
    });
    graph.nodes.set(node.id, node);
    graph.byKind.set('process', [node.id]);
    graph.consumers.set(node.id, new Set(['process:consumer']));

    const csv = estateInventoryCsv(graph);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('kind,name,resolution,version,bpversion,consumer_count,source_files');
    expect(lines[1]).toBe('process,"Has ""Quotes"", and comma",resolved,1.0,7.1,1,a.bprelease;b.bprelease');
  });

  it('leaves version/bpversion blank when not applicable to the node kind', () => {
    const graph = emptyGraph();
    const node = makeNode({ id: 'queue:x', kind: 'workQueue', name: 'Queue X', data: {} });
    graph.nodes.set(node.id, node);
    graph.byKind.set('workQueue', [node.id]);

    const csv = estateInventoryCsv(graph);
    expect(csv.split('\n')[1]).toBe('workQueue,Queue X,resolved,,,0,');
  });

  it('handles a newline embedded in a source file name', () => {
    const graph = emptyGraph();
    const node = makeNode({
      id: 'credential:x',
      kind: 'credential',
      name: 'Cred',
      provenance: [{ fileName: 'line one\nline two.bprelease', contentHash: 'h1' }],
    });
    graph.nodes.set(node.id, node);
    graph.byKind.set('credential', [node.id]);

    const csv = estateInventoryCsv(graph);
    expect(csv).toContain('"line one\nline two.bprelease"');
  });
});

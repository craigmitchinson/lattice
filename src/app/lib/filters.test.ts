import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../lib/graph/types.ts';
import { DEFAULT_BROWSER_FILTERS, filterBrowserNodes, matchesBrowserFilters } from './filters.ts';

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return { id: 'process:invoice-bot', kind: 'process', name: 'Invoice Bot', resolution: 'resolved', provenance: [], data: {}, ...overrides };
}

describe('matchesBrowserFilters', () => {
  it('matches everything with the default (empty) filters', () => {
    expect(matchesBrowserFilters(makeNode(), DEFAULT_BROWSER_FILTERS)).toBe(true);
  });

  it('matches name substring case-insensitively', () => {
    expect(matchesBrowserFilters(makeNode({ name: 'Invoice Bot' }), { ...DEFAULT_BROWSER_FILTERS, search: 'invoice' })).toBe(true);
    expect(matchesBrowserFilters(makeNode({ name: 'Invoice Bot' }), { ...DEFAULT_BROWSER_FILTERS, search: 'INVOICE' })).toBe(true);
    expect(matchesBrowserFilters(makeNode({ name: 'Invoice Bot' }), { ...DEFAULT_BROWSER_FILTERS, search: 'refund' })).toBe(false);
  });

  it('filters by kind', () => {
    const node = makeNode({ kind: 'object' });
    expect(matchesBrowserFilters(node, { ...DEFAULT_BROWSER_FILTERS, kind: 'object' })).toBe(true);
    expect(matchesBrowserFilters(node, { ...DEFAULT_BROWSER_FILTERS, kind: 'process' })).toBe(false);
    expect(matchesBrowserFilters(node, { ...DEFAULT_BROWSER_FILTERS, kind: 'all' })).toBe(true);
  });

  it('filters by resolution', () => {
    const node = makeNode({ resolution: 'external' });
    expect(matchesBrowserFilters(node, { ...DEFAULT_BROWSER_FILTERS, resolution: 'external' })).toBe(true);
    expect(matchesBrowserFilters(node, { ...DEFAULT_BROWSER_FILTERS, resolution: 'dynamic' })).toBe(false);
    expect(matchesBrowserFilters(node, { ...DEFAULT_BROWSER_FILTERS, resolution: 'all' })).toBe(true);
  });

  it('combines search, kind and resolution as a logical AND', () => {
    const node = makeNode({ name: 'Invoice Bot', kind: 'process', resolution: 'resolved' });
    expect(matchesBrowserFilters(node, { search: 'invoice', kind: 'process', resolution: 'resolved' })).toBe(true);
    expect(matchesBrowserFilters(node, { search: 'invoice', kind: 'object', resolution: 'resolved' })).toBe(false);
    expect(matchesBrowserFilters(node, { search: 'refund', kind: 'process', resolution: 'resolved' })).toBe(false);
  });
});

describe('filterBrowserNodes', () => {
  it('returns only nodes matching every filter', () => {
    const nodes = [
      makeNode({ id: 'process:a', name: 'Invoice Bot', kind: 'process' }),
      makeNode({ id: 'process:b', name: 'Refund Bot', kind: 'process' }),
      makeNode({ id: 'object:a', name: 'Invoice Object', kind: 'object' }),
    ];
    const result = filterBrowserNodes(nodes, { ...DEFAULT_BROWSER_FILTERS, search: 'invoice' });
    expect(result.map((n) => n.id)).toEqual(['process:a', 'object:a']);
  });
});

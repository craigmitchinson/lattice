/**
 * Search and filter predicates for the estate browser. Pure, so they are
 * unit tested without a DOM.
 */

import type { GraphNode, NodeKind, NodeResolution } from '../../lib/graph/types.ts';

/**
 * Node kinds surfaced in the estate browser. page, stage and sourceFile are
 * implementation-level nodes (subsheets, individual stages, imported files)
 * rather than estate items an analyst browses directly, so they are left
 * out of both the inventory list and the kind filter.
 */
export const BROWSER_KINDS: readonly NodeKind[] = [
  'process',
  'object',
  'action',
  'workQueue',
  'environmentVariable',
  'credential',
  'appModelElement',
];

export type KindFilter = NodeKind | 'all';
export type ResolutionFilter = NodeResolution | 'all';

export interface BrowserFilters {
  search: string;
  kind: KindFilter;
  resolution: ResolutionFilter;
}

export const DEFAULT_BROWSER_FILTERS: BrowserFilters = { search: '', kind: 'all', resolution: 'all' };

/** Case-insensitive substring match on name, plus kind/resolution equality. */
export function matchesBrowserFilters(node: GraphNode, filters: BrowserFilters): boolean {
  if (filters.kind !== 'all' && node.kind !== filters.kind) return false;
  if (filters.resolution !== 'all' && node.resolution !== filters.resolution) return false;

  const query = filters.search.trim().toLowerCase();
  if (query.length > 0 && !node.name.toLowerCase().includes(query)) return false;

  return true;
}

export function filterBrowserNodes(nodes: readonly GraphNode[], filters: BrowserFilters): GraphNode[] {
  return nodes.filter((node) => matchesBrowserFilters(node, filters));
}

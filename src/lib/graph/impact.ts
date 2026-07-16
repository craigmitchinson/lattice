/**
 * Bounded, evidence-preserving impact walk over an already-built estate
 * graph. Pure, index-only traversal - never rescans graph.edges. See
 * docs/data-model.md "Indexes" and the final report for the root-hop
 * behaviour when a stage/page node is selected.
 */

import { DEPENDENCY_EDGE_TYPES } from './build.ts';
import { NODE_KINDS, type EdgeType, type EstateGraph, type GraphNode, type ImpactGroup, type ImpactResult, type NodeKind } from './types.ts';

interface ReachedEntry {
  depth: number;
  via: EdgeType;
  evidence: Set<string>;
}

/**
 * Edge types that exist at both an item level (process/object -> target,
 * carrying evidence) and a stage level (stage -> target, same EdgeType).
 * During the downstream ('in') walk, only the item-level edge should
 * surface a reached node - the stage-level edge is the same fact restated
 * from the evidencing stage and must not appear as its own 'stage' kind
 * result, mirroring how build.ts's consumers index resolves a stage `from`
 * back to its owner rather than surfacing the raw stage. action-of,
 * targets-element and element-of have no item-level counterpart, so they
 * are untouched by this and keep surfacing their real (single-level) source.
 */
const DUAL_LEVEL_EDGE_TYPES: ReadonlySet<EdgeType> = new Set([
  'calls-process',
  'invokes-action',
  'references-queue',
  'references-env-var',
  'references-credential',
]);

/**
 * If nodeId is a page or stage, hops to its owning process/object first
 * (page -> page-of target; stage -> stage-of -> page -> page-of target).
 * Any other kind resolves to itself.
 */
function resolveImpactRoot(graph: EstateGraph, nodeId: string): string {
  const node = graph.nodes.get(nodeId);
  if (!node) return nodeId;

  if (node.kind === 'page') {
    const pageOf = graph.outEdges.get(nodeId)?.get('page-of');
    const target = pageOf?.[0];
    return target ? target.to : nodeId;
  }

  if (node.kind === 'stage') {
    const stageOf = graph.outEdges.get(nodeId)?.get('stage-of');
    const pageId = stageOf?.[0]?.to;
    if (pageId) {
      const pageOf = graph.outEdges.get(pageId)?.get('page-of');
      const target = pageOf?.[0];
      if (target) return target.to;
    }
    return nodeId;
  }

  return nodeId;
}

function walk(graph: EstateGraph, startId: string, maxDepth: number, direction: 'out' | 'in'): Map<string, ReachedEntry> {
  const reached = new Map<string, ReachedEntry>();
  let frontier: string[] = [startId];
  let currentDepth = 0;

  while (frontier.length > 0 && currentDepth < maxDepth) {
    const newDepth = currentDepth + 1;
    const nextFrontier = new Set<string>();

    for (const nodeId of frontier) {
      const edgeMap = direction === 'out' ? graph.outEdges.get(nodeId) : graph.inEdges.get(nodeId);
      if (!edgeMap) continue;

      for (const edgeType of DEPENDENCY_EDGE_TYPES) {
        const edgeList = edgeMap.get(edgeType);
        if (!edgeList) continue;

        for (const edge of edgeList) {
          if (direction === 'in' && DUAL_LEVEL_EDGE_TYPES.has(edgeType)) {
            const fromNode = graph.nodes.get(edge.from);
            if (fromNode?.kind === 'stage') continue; // rely on the parallel item-level edge instead
          }

          const targetId = direction === 'out' ? edge.to : edge.from;
          if (targetId === startId) continue;

          let entry = reached.get(targetId);
          if (!entry) {
            entry = { depth: newDepth, via: edgeType, evidence: new Set() };
            reached.set(targetId, entry);
          }
          if (entry.depth !== newDepth) continue; // already reached at a shallower depth

          if (edge.evidence) {
            for (const stageId of edge.evidence) entry.evidence.add(stageId);
          }
          nextFrontier.add(targetId);
        }
      }
    }

    frontier = Array.from(nextFrontier);
    currentDepth = newDepth;
  }

  return reached;
}

function toGroups(graph: EstateGraph, reached: Map<string, ReachedEntry>): ImpactGroup[] {
  const byKind = new Map<NodeKind, { node: GraphNode; depth: number; via: EdgeType; evidence: string[] }[]>();

  for (const [nodeId, entry] of reached) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    const list = byKind.get(node.kind);
    const row = { node, depth: entry.depth, via: entry.via, evidence: Array.from(entry.evidence) };
    if (list) list.push(row);
    else byKind.set(node.kind, [row]);
  }

  const groups: ImpactGroup[] = [];
  for (const kind of NODE_KINDS) {
    const list = byKind.get(kind);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      const na = a.node.name.toLowerCase();
      const nb = b.node.name.toLowerCase();
      if (na !== nb) return na < nb ? -1 : 1;
      return a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0;
    });
    groups.push({ kind, nodes: list });
  }
  return groups;
}

/**
 * Bounded breadth-first impact analysis from nodeId, walking only
 * dependency edge types (see build.ts DEPENDENCY_EDGE_TYPES). If nodeId is
 * a stage or page, the walk actually runs from its owning process/object
 * (ImpactResult.root reflects the resolved owner, not the original
 * selection - see the final report).
 */
export function impact(graph: EstateGraph, nodeId: string, maxDepth: number): ImpactResult {
  if (!graph.nodes.has(nodeId)) {
    throw new Error(`impact: unknown node id "${nodeId}"`);
  }
  const rootId = resolveImpactRoot(graph, nodeId);
  const rootNode = graph.nodes.get(rootId);
  if (!rootNode) {
    throw new Error(`impact: unable to resolve owner node for "${nodeId}"`);
  }

  const upstreamReached = walk(graph, rootId, maxDepth, 'out');
  const downstreamReached = walk(graph, rootId, maxDepth, 'in');

  return {
    root: rootNode,
    upstream: toGroups(graph, upstreamReached),
    downstream: toGroups(graph, downstreamReached),
    depth: maxDepth,
  };
}

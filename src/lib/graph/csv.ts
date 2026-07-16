/**
 * CSV export helpers, RFC 4180 quoting. Pure, no DOM/Node APIs.
 */

import { NODE_KINDS, type EstateGraph, type ImpactGroup, type ImpactResult } from './types.ts';

/** Quotes a field per RFC 4180 when it contains a comma, quote or newline. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\n');
}

const IMPACT_HEADER = ['direction', 'depth', 'kind', 'name', 'resolution', 'via', 'evidence_count', 'source_files'];

/** direction/depth/kind/name/resolution/via/evidence_count/source_files rows. The root itself is not a row. */
export function impactToCsv(result: ImpactResult): string {
  const rows: string[][] = [IMPACT_HEADER];

  const addGroups = (groups: ImpactGroup[], direction: 'upstream' | 'downstream'): void => {
    for (const group of groups) {
      for (const entry of group.nodes) {
        rows.push([
          direction,
          String(entry.depth),
          group.kind,
          entry.node.name,
          entry.node.resolution,
          entry.via,
          String(entry.evidence.length),
          entry.node.provenance.map((p) => p.fileName).join(';'),
        ]);
      }
    }
  };

  addGroups(result.upstream, 'upstream');
  addGroups(result.downstream, 'downstream');

  return toCsv(rows);
}

const INVENTORY_HEADER = ['kind', 'name', 'resolution', 'version', 'bpversion', 'consumer_count', 'source_files'];

/** One row per node in the graph, ordered via byKind for stable output. */
export function estateInventoryCsv(graph: EstateGraph): string {
  const rows: string[][] = [INVENTORY_HEADER];

  for (const kind of NODE_KINDS) {
    const ids = graph.byKind.get(kind) ?? [];
    for (const id of ids) {
      const node = graph.nodes.get(id);
      if (!node) continue;
      const consumerCount = graph.consumers.get(id)?.size ?? 0;
      rows.push([
        node.kind,
        node.name,
        node.resolution,
        node.data.version ?? '',
        node.data.bpversion ?? '',
        String(consumerCount),
        node.provenance.map((p) => p.fileName).join(';'),
      ]);
    }
  }

  return toCsv(rows);
}

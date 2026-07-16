/**
 * JSON export of the estate graph. Pure, no DOM/Node APIs.
 */

import { SCHEMA_VERSION } from '../persist/schema.ts';
import type { EstateGraph, SerialisedGraph } from './types.ts';

export function serialiseGraph(graph: EstateGraph): SerialisedGraph {
  return {
    schemaVersion: SCHEMA_VERSION,
    nodes: Array.from(graph.nodes.values()),
    edges: graph.edges.slice(),
    duplicates: graph.duplicates.slice(),
  };
}

/** Pretty-printed (2-space indent) JSON of the serialised graph. */
export function graphToJson(graph: EstateGraph): string {
  return JSON.stringify(serialiseGraph(graph), null, 2);
}

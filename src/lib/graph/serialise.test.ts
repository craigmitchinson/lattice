import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../persist/schema.ts';
import { buildEstateGraph } from './build.ts';
import { graphToJson, serialiseGraph } from './serialise.ts';
import { makeActionStage, makeObject, makePage, makeProcess, makeRelease } from './testData.ts';

function buildSampleGraph() {
  const actionPage = makePage({ name: 'Do Thing', published: true, stages: [] });
  const object = makeObject({ name: 'Shared Object', pages: [actionPage] });
  const stage = makeActionStage({ action: { objectName: 'Shared Object', actionName: 'Do Thing' } });
  const page = makePage({ stages: [stage] });
  const process = makeProcess({ name: 'Caller Process', pages: [page] });
  const release = makeRelease({ processes: [process], objects: [object] });
  return buildEstateGraph([release]);
}

describe('serialiseGraph', () => {
  it('carries the current schema version and array forms of nodes/duplicates', () => {
    const graph = buildSampleGraph();
    const serialised = serialiseGraph(graph);

    expect(serialised.schemaVersion).toBe(SCHEMA_VERSION);
    expect(serialised.nodes).toHaveLength(graph.nodes.size);
    expect(serialised.edges).toHaveLength(graph.edges.length);
    expect(serialised.duplicates).toEqual(graph.duplicates);
  });
});

describe('graphToJson', () => {
  it('round-trips node and edge counts through JSON.parse', () => {
    const graph = buildSampleGraph();
    const parsed = JSON.parse(graphToJson(graph));

    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.nodes).toHaveLength(graph.nodes.size);
    expect(parsed.edges).toHaveLength(graph.edges.length);
  });

  it('pretty-prints with 2-space indentation', () => {
    const graph = buildEstateGraph([makeRelease({})]);
    const json = graphToJson(graph);
    expect(json.startsWith('{\n  "schemaVersion"')).toBe(true);
  });
});

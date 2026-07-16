import { describe, expect, it } from 'vitest';
import { buildEstateGraph } from './build.ts';
import { impact } from './impact.ts';
import { makeActionStage, makeObject, makePage, makeProcess, makeRelease } from './testData.ts';

function buildCallGraph() {
  const actionPage = makePage({ name: 'Do Thing', published: true, stages: [] });
  const object = makeObject({ name: 'Shared Object', pages: [actionPage] });

  const stage = makeActionStage({ action: { objectName: 'Shared Object', actionName: 'Do Thing' } });
  const page = makePage({ stages: [stage] });
  const process = makeProcess({ name: 'Caller Process', pages: [page] });

  const release = makeRelease({ processes: [process], objects: [object] });
  const graph = buildEstateGraph([release]);
  const processId = 'process:caller process';
  const stageId = `stage:${processId}:${stage.stageId}`;
  return { graph, stage, stageId, processId };
}

describe('impact', () => {
  it('produces different results for upstream and downstream', () => {
    const { graph, processId } = buildCallGraph();
    const result = impact(graph, processId, 5);

    const upstreamIds = result.upstream.flatMap((g) => g.nodes.map((n) => n.node.id));
    expect(upstreamIds).toContain('action:shared object:do thing');
    expect(upstreamIds).toContain('object:shared object');

    // Nothing depends on the caller process.
    expect(result.downstream.flatMap((g) => g.nodes)).toHaveLength(0);
  });

  it('bounds the walk by maxDepth', () => {
    const { graph, processId } = buildCallGraph();
    const shallow = impact(graph, processId, 1);
    const shallowIds = shallow.upstream.flatMap((g) => g.nodes.map((n) => n.node.id));
    expect(shallowIds).toContain('action:shared object:do thing');
    expect(shallowIds).not.toContain('object:shared object');

    const deep = impact(graph, processId, 5);
    const deepIds = deep.upstream.flatMap((g) => g.nodes.map((n) => n.node.id));
    expect(deepIds).toContain('object:shared object');
  });

  it('groups by kind and sorts stably by depth then name', () => {
    const pageA = makePage({ name: 'Action A', published: true, stages: [] });
    const pageB = makePage({ name: 'Action B', published: true, stages: [] });
    const object = makeObject({ name: 'Multi Object', pages: [pageA, pageB] });

    const stageA = makeActionStage({ action: { objectName: 'Multi Object', actionName: 'Action A' } });
    const stageB = makeActionStage({ action: { objectName: 'Multi Object', actionName: 'Action B' } });
    const page = makePage({ stages: [stageB, stageA] }); // deliberately out of alpha order
    const process = makeProcess({ name: 'Multi Caller', pages: [page] });

    const release = makeRelease({ processes: [process], objects: [object] });
    const graph = buildEstateGraph([release]);

    const result = impact(graph, 'process:multi caller', 5);
    const actionGroup = result.upstream.find((g) => g.kind === 'action');
    expect(actionGroup?.nodes.map((n) => n.node.name)).toEqual(['Action A', 'Action B']);
    expect(actionGroup?.nodes.every((n) => n.depth === 1)).toBe(true);
  });

  it('preserves evidence stage ids through to the result', () => {
    const { graph, processId, stageId } = buildCallGraph();
    const result = impact(graph, processId, 5);
    const actionGroup = result.upstream.find((g) => g.kind === 'action');
    const actionEntry = actionGroup?.nodes.find((n) => n.node.id === 'action:shared object:do thing');
    expect(actionEntry?.evidence).toEqual([stageId]);
  });

  it('hops a stage-node selection to its owning process/object before walking', () => {
    const { graph, processId, stageId } = buildCallGraph();
    const fromStage = impact(graph, stageId, 5);
    const fromOwner = impact(graph, processId, 5);

    expect(fromStage.root.id).toBe(processId);
    expect(fromStage.root.id).toBe(fromOwner.root.id);
    expect(fromStage.upstream.flatMap((g) => g.nodes.map((n) => n.node.id))).toEqual(
      fromOwner.upstream.flatMap((g) => g.nodes.map((n) => n.node.id)),
    );
  });

  it('does not surface a spurious stage-kind group in downstream for dual-level edge types', () => {
    const { graph } = buildCallGraph();
    const result = impact(graph, 'action:shared object:do thing', 5);

    const stageGroup = result.downstream.find((g) => g.kind === 'stage');
    expect(stageGroup).toBeUndefined();

    const processGroup = result.downstream.find((g) => g.kind === 'process');
    expect(processGroup?.nodes).toHaveLength(1);
    expect(processGroup?.nodes[0]?.node.id).toBe('process:caller process');
    expect(processGroup?.nodes[0]?.depth).toBe(1);
  });

  it('runs on an unresolved (external) node id without throwing', () => {
    // Reference an action that is never defined anywhere.
    const missingCallStage = makeActionStage({ action: { objectName: 'Nowhere', actionName: 'Missing' } });
    const page = makePage({ stages: [missingCallStage] });
    const process = makeProcess({ name: 'Second Caller', pages: [page] });
    const graph = buildEstateGraph([makeRelease({ processes: [process] })]);

    expect(() => impact(graph, 'action:nowhere:missing', 5)).not.toThrow();
    const result = impact(graph, 'action:nowhere:missing', 5);
    expect(result.root.resolution).toBe('external');
    // Something calls it (the caller process), so downstream is non-empty.
    const downstreamIds = result.downstream.flatMap((g) => g.nodes.map((n) => n.node.id));
    expect(downstreamIds).toContain('process:second caller');
  });
});

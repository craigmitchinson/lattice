import { describe, expect, it } from 'vitest';
import { buildEstateGraph } from './build.ts';
import type { GraphEdge } from './types.ts';
import {
  makeActionStage,
  makeAppModel,
  makeAppModelElement,
  makeAppStep,
  makeAppStepStage,
  makeChoiceLink,
  makeCredential,
  makeDataStage,
  makeEnvVar,
  makeObject,
  makePage,
  makeProcess,
  makeQueue,
  makeRelease,
  makeStage,
  makeSubsheetRefStage,
} from './testData.ts';

function edgesOfType(edges: GraphEdge[], type: GraphEdge['type']): GraphEdge[] {
  return edges.filter((e) => e.type === type);
}

describe('buildEstateGraph: node identities and kinds', () => {
  it('creates every NodeKind with the documented id scheme', () => {
    const stage = makeStage({ name: 'Calc 1' });
    const processPage = makePage({ name: 'Main Page', published: false, stages: [stage] });
    const process = makeProcess({ name: 'Invoice Process', pages: [processPage] });

    const publishedStage = makeStage({ name: 'Do Thing Body' });
    const publishedPage = makePage({ name: 'Do Thing', published: true, stages: [publishedStage] });
    const unpublishedPage = makePage({ name: 'Internal Helper', published: false, stages: [] });
    const element = makeAppModelElement({ elementId: 'el-1', name: 'Button1' });
    const object = makeObject({
      name: 'Invoice Object',
      pages: [publishedPage, unpublishedPage],
      appModel: makeAppModel({ elements: [element] }),
    });

    const queue = makeQueue({ name: 'Invoices' });
    const envVar = makeEnvVar({ name: 'Environment Name' });
    const credential = makeCredential({ name: 'Service Account' });

    const release = makeRelease({
      processes: [process],
      objects: [object],
      workQueues: [queue],
      environmentVariables: [envVar],
      credentials: [credential],
    });

    const graph = buildEstateGraph([release]);

    const processId = 'process:invoice process';
    const objectId = 'object:invoice object';
    expect(graph.nodes.get(processId)?.kind).toBe('process');
    expect(graph.nodes.get(objectId)?.kind).toBe('object');

    const pageId = `page:${processId}:${processPage.subsheetId}`;
    expect(graph.nodes.get(pageId)?.kind).toBe('page');
    const stageId = `stage:${processId}:${stage.stageId}`;
    expect(graph.nodes.get(stageId)?.kind).toBe('stage');

    const actionId = `action:invoice object:do thing`;
    expect(graph.nodes.get(actionId)?.kind).toBe('action');
    expect(graph.nodes.get(actionId)?.resolution).toBe('resolved');

    // Unpublished object page: page node exists, no action node.
    const unpublishedPageId = `page:${objectId}:${unpublishedPage.subsheetId}`;
    expect(graph.nodes.get(unpublishedPageId)?.kind).toBe('page');
    expect(graph.nodes.has(`action:invoice object:internal helper`)).toBe(false);

    const elementId = `element:${objectId}:el-1`;
    expect(graph.nodes.get(elementId)?.kind).toBe('appModelElement');

    expect(graph.nodes.get('queue:invoices')?.kind).toBe('workQueue');
    expect(graph.nodes.get('envvar:environment name')?.kind).toBe('environmentVariable');
    expect(graph.nodes.get('credential:service account')?.kind).toBe('credential');

    const fileId = `file:${release.file.contentHash}`;
    expect(graph.nodes.get(fileId)?.kind).toBe('sourceFile');
  });
});

describe('buildEstateGraph: duplicate resolution', () => {
  it('keeps the higher numeric-aware version ("2.10" beats "2.9")', () => {
    const staleStage = makeStage({ name: 'A-only-stage' });
    const stalePage = makePage({ name: 'Main Page', stages: [staleStage] });
    const staleProcess = makeProcess({ name: 'Invoice Bot', version: '2.9', pages: [stalePage] });
    const staleRelease = makeRelease({ processes: [staleProcess], created: '2024-01-01T00:00:00Z' });

    const freshStage = makeStage({ name: 'B-only-stage' });
    const freshPage = makePage({ name: 'Main Page', stages: [freshStage] });
    const freshProcess = makeProcess({ name: 'Invoice Bot', version: '2.10', pages: [freshPage] });
    const freshRelease = makeRelease({ processes: [freshProcess], created: '2024-02-01T00:00:00Z' });

    const graph = buildEstateGraph([staleRelease, freshRelease]);

    const dup = graph.duplicates.find((d) => d.kind === 'process' && d.name === 'Invoice Bot');
    expect(dup).toBeDefined();
    expect(dup?.kept.version).toBe('2.10');
    expect(dup?.kept.contentHash).toBe(freshRelease.file.contentHash);
    expect(dup?.discarded).toEqual([
      { fileName: staleRelease.file.fileName, contentHash: staleRelease.file.contentHash, version: '2.9' },
    ]);

    // Only the winner's stages/pages contribute to the graph.
    const processId = 'process:invoice bot';
    expect(graph.nodes.has(`stage:${processId}:${freshStage.stageId}`)).toBe(true);
    expect(graph.nodes.has(`stage:${processId}:${staleStage.stageId}`)).toBe(false);

    // But both files show up in the process node's provenance and as defined-in edges.
    const processNode = graph.nodes.get(processId)!;
    expect(processNode.provenance.map((p) => p.contentHash).sort()).toEqual(
      [staleRelease.file.contentHash, freshRelease.file.contentHash].sort(),
    );
    const definedIn = edgesOfType(graph.edges, 'defined-in').filter((e) => e.from === processId);
    expect(definedIn).toHaveLength(2);
  });

  it('falls back to the release created date when versions tie or are absent', () => {
    const earlyProcess = makeProcess({ name: 'Reconciler', version: null });
    const earlyRelease = makeRelease({ processes: [earlyProcess], created: '2024-01-01T00:00:00Z' });

    const lateProcess = makeProcess({ name: 'Reconciler', version: null });
    const lateRelease = makeRelease({ processes: [lateProcess], created: '2024-06-01T00:00:00Z' });

    const graph = buildEstateGraph([earlyRelease, lateRelease]);
    const dup = graph.duplicates.find((d) => d.name === 'Reconciler');
    expect(dup?.kept.contentHash).toBe(lateRelease.file.contentHash);
  });

  it('prefers a present version over an absent one even when the unversioned copy is dated later', () => {
    const unversionedProcess = makeProcess({ name: 'Reconciler', version: null });
    const unversionedRelease = makeRelease({ processes: [unversionedProcess], created: '2024-06-01T00:00:00Z' });

    const versionedProcess = makeProcess({ name: 'Reconciler', version: '3.0' });
    const versionedRelease = makeRelease({ processes: [versionedProcess], created: '2024-01-01T00:00:00Z' });

    // Unversioned-but-later encountered first; versioned-but-earlier is the challenger.
    const graph = buildEstateGraph([unversionedRelease, versionedRelease]);
    const dup = graph.duplicates.find((d) => d.name === 'Reconciler');
    expect(dup?.kept.contentHash).toBe(versionedRelease.file.contentHash);
    expect(dup?.kept.version).toBe('3.0');
  });

  it('keeps a present version over a later-dated but unversioned challenger', () => {
    const versionedProcess = makeProcess({ name: 'Reconciler', version: '3.0' });
    const versionedRelease = makeRelease({ processes: [versionedProcess], created: '2024-01-01T00:00:00Z' });

    const unversionedProcess = makeProcess({ name: 'Reconciler', version: null });
    const unversionedRelease = makeRelease({ processes: [unversionedProcess], created: '2024-06-01T00:00:00Z' });

    // Versioned encountered first (as "current"); unversioned-but-later is the challenger.
    const graph = buildEstateGraph([versionedRelease, unversionedRelease]);
    const dup = graph.duplicates.find((d) => d.name === 'Reconciler');
    expect(dup?.kept.contentHash).toBe(versionedRelease.file.contentHash);
    expect(dup?.kept.version).toBe('3.0');
  });

  it('falls back to file order (first encountered wins) when version and created both tie/absent', () => {
    const firstProcess = makeProcess({ name: 'Reconciler', version: null });
    const firstRelease = makeRelease({ processes: [firstProcess], created: null });

    const secondProcess = makeProcess({ name: 'Reconciler', version: null });
    const secondRelease = makeRelease({ processes: [secondProcess], created: null });

    const graph = buildEstateGraph([firstRelease, secondRelease]);
    const dup = graph.duplicates.find((d) => d.name === 'Reconciler');
    expect(dup?.kept.contentHash).toBe(firstRelease.file.contentHash);
  });
});

describe('buildEstateGraph: action reference resolution', () => {
  it('creates an external placeholder for an unresolved literal action target', () => {
    const stage = makeActionStage({ action: { objectName: 'Missing Object', actionName: 'Missing Action' } });
    const page = makePage({ stages: [stage] });
    const process = makeProcess({ name: 'Caller Process', pages: [page] });
    const release = makeRelease({ processes: [process] });

    const graph = buildEstateGraph([release]);

    const targetId = 'action:missing object:missing action';
    const targetNode = graph.nodes.get(targetId);
    expect(targetNode?.resolution).toBe('external');

    const processId = 'process:caller process';
    const stageId = `stage:${processId}:${stage.stageId}`;
    const itemLevel = edgesOfType(graph.edges, 'invokes-action').find((e) => e.from === processId && e.to === targetId);
    expect(itemLevel?.evidence).toEqual([stageId]);

    const stageLevel = edgesOfType(graph.edges, 'invokes-action').find((e) => e.from === stageId && e.to === targetId);
    expect(stageLevel).toBeDefined();
  });

  it('creates a dynamic node for an interpolated action target', () => {
    const stage = makeActionStage({ action: { objectName: '[Object Name]', actionName: 'Do Something' } });
    const page = makePage({ stages: [stage] });
    const process = makeProcess({ name: 'Caller Process', pages: [page] });
    const release = makeRelease({ processes: [process] });

    const graph = buildEstateGraph([release]);

    const targetId = 'action:[object name]:do something';
    expect(graph.nodes.get(targetId)?.resolution).toBe('dynamic');
  });

  it('resolves a literal action target defined by an imported object', () => {
    const actionPage = makePage({ name: 'Do Thing', published: true, stages: [] });
    const object = makeObject({ name: 'Utility Object', pages: [actionPage] });

    const callerStage = makeActionStage({ action: { objectName: 'Utility Object', actionName: 'Do Thing' } });
    const callerPage = makePage({ stages: [callerStage] });
    const process = makeProcess({ name: 'Caller Process', pages: [callerPage] });

    const release = makeRelease({ processes: [process], objects: [object] });
    const graph = buildEstateGraph([release]);

    const targetId = 'action:utility object:do thing';
    expect(graph.nodes.get(targetId)?.resolution).toBe('resolved');
  });
});

describe('buildEstateGraph: queue and credential references', () => {
  it('resolves a literal queue name to the matching defined queue, else external', () => {
    const resolvedStage = makeActionStage({
      action: { objectName: 'Work Queues', actionName: 'Add To Queue', inputs: [{ name: 'Queue Name', dataType: null, expression: '"Invoices"', storeIn: null }] },
    });
    const externalStage = makeActionStage({
      action: { objectName: 'Internal - Work Queues', actionName: 'Add To Queue', inputs: [{ name: 'Queue Name', dataType: null, expression: '"Unregistered Queue"', storeIn: null }] },
    });
    const dynamicStage = makeActionStage({
      action: { objectName: 'Work Queues', actionName: 'Add To Queue', inputs: [{ name: 'Queue Name', dataType: null, expression: '[Queue Name Data Item]', storeIn: null }] },
    });
    const page = makePage({ stages: [resolvedStage, externalStage, dynamicStage] });
    const process = makeProcess({ name: 'Queue Caller', pages: [page] });
    const queue = makeQueue({ name: 'Invoices' });
    const release = makeRelease({ processes: [process], workQueues: [queue] });

    const graph = buildEstateGraph([release]);

    expect(graph.nodes.get('queue:invoices')?.resolution).toBe('resolved');
    expect(graph.nodes.get('queue:unregistered queue')?.resolution).toBe('external');
    expect(graph.nodes.get('queue:[queue name data item]')?.resolution).toBe('dynamic');

    // Ordinary invokes-action edge still created alongside the queue reference.
    const processId = 'process:queue caller';
    const invokesAction = edgesOfType(graph.edges, 'invokes-action').find((e) => e.from === processId);
    expect(invokesAction).toBeDefined();
  });

  it('resolves credential references the same way', () => {
    const stage = makeActionStage({
      action: { objectName: 'Credentials', actionName: 'Get Password', inputs: [{ name: 'Credential Name', dataType: null, expression: '"Service Account"', storeIn: null }] },
    });
    const page = makePage({ stages: [stage] });
    const process = makeProcess({ name: 'Cred Caller', pages: [page] });
    const credential = makeCredential({ name: 'Service Account' });
    const release = makeRelease({ processes: [process], credentials: [credential] });

    const graph = buildEstateGraph([release]);
    expect(graph.nodes.get('credential:service account')?.resolution).toBe('resolved');

    const processId = 'process:cred caller';
    const refEdge = edgesOfType(graph.edges, 'references-credential').find((e) => e.from === processId);
    expect(refEdge?.to).toBe('credential:service account');
  });
});

describe('buildEstateGraph: environment variables', () => {
  it('resolves a defined environment variable and externalises an undefined one', () => {
    const resolvedStage = makeDataStage({ name: 'Known Setting', data: { exposure: 'environment' } });
    const externalStage = makeDataStage({ name: 'Unknown Setting', data: { exposure: 'Environment' } });
    const page = makePage({ stages: [resolvedStage, externalStage] });
    const process = makeProcess({ name: 'Env Process', pages: [page] });
    const envVar = makeEnvVar({ name: 'Known Setting' });
    const release = makeRelease({ processes: [process], environmentVariables: [envVar] });

    const graph = buildEstateGraph([release]);
    expect(graph.nodes.get('envvar:known setting')?.resolution).toBe('resolved');
    expect(graph.nodes.get('envvar:unknown setting')?.resolution).toBe('external');
  });
});

describe('buildEstateGraph: app model elements', () => {
  it('resolves a matched element and externalises unmatched/missing elementIds', () => {
    const matchedStep = makeAppStep({ elementId: 'el-1' });
    const unmatchedStep = makeAppStep({ elementId: 'el-does-not-exist' });
    const missingStep = makeAppStep({ elementId: null });

    const matchedStage = makeAppStepStage({ appSteps: { steps: [matchedStep] } });
    const unmatchedStage = makeAppStepStage({ appSteps: { steps: [unmatchedStep] } });
    const missingStage = makeAppStepStage({ appSteps: { steps: [missingStep] } });

    const page = makePage({ stages: [matchedStage, unmatchedStage, missingStage] });
    const element = makeAppModelElement({ elementId: 'el-1', name: 'Button1' });
    const object = makeObject({ name: 'App Object', pages: [page], appModel: makeAppModel({ elements: [element] }) });
    const release = makeRelease({ objects: [object] });

    const graph = buildEstateGraph([release]);
    const objectId = 'object:app object';

    const matchedTarget = edgesOfType(graph.edges, 'targets-element').find(
      (e) => e.from === `stage:${objectId}:${matchedStage.stageId}`,
    );
    expect(matchedTarget?.to).toBe(`element:${objectId}:el-1`);
    expect(graph.nodes.get(matchedTarget!.to)?.resolution).toBe('resolved');

    const unmatchedTarget = edgesOfType(graph.edges, 'targets-element').find(
      (e) => e.from === `stage:${objectId}:${unmatchedStage.stageId}`,
    );
    const missingTarget = edgesOfType(graph.edges, 'targets-element').find(
      (e) => e.from === `stage:${objectId}:${missingStage.stageId}`,
    );
    expect(unmatchedTarget?.to).toBe(`element:${objectId}:__unresolved__`);
    expect(missingTarget?.to).toBe(`element:${objectId}:__unresolved__`);
    expect(graph.nodes.get(unmatchedTarget!.to)?.resolution).toBe('external');

    const elementOf = edgesOfType(graph.edges, 'element-of').find((e) => e.from === `element:${objectId}:el-1`);
    expect(elementOf?.to).toBe(objectId);
  });
});

describe('buildEstateGraph: links-to roles', () => {
  it('assigns success/true/false/choice roles from ordinary control flow', () => {
    const target = makeStage({ name: 'Target' });
    const source = makeStage({
      name: 'Source',
      knownType: 'Decision',
      links: { onSuccess: target.stageId, onTrue: target.stageId, onFalse: target.stageId, choices: [] },
    });
    const choiceTarget = makeStage({ name: 'Choice Target' });
    const choiceSource = makeStage({
      name: 'Choice Source',
      knownType: 'ChoiceStart',
      links: { onSuccess: null, onTrue: null, onFalse: null, choices: [makeChoiceLink({ target: choiceTarget.stageId })] },
    });
    const page = makePage({ stages: [target, source, choiceTarget, choiceSource] });
    const process = makeProcess({ name: 'Flow Process', pages: [page] });
    const release = makeRelease({ processes: [process] });

    const graph = buildEstateGraph([release]);
    const processId = 'process:flow process';
    const sourceId = `stage:${processId}:${source.stageId}`;
    const links = edgesOfType(graph.edges, 'links-to').filter((e) => e.from === sourceId);
    expect(links.map((l) => l.role).sort()).toEqual(['false', 'success', 'true']);

    const choiceSourceId = `stage:${processId}:${choiceSource.stageId}`;
    const choiceLinks = edgesOfType(graph.edges, 'links-to').filter((e) => e.from === choiceSourceId);
    expect(choiceLinks).toHaveLength(1);
    expect(choiceLinks[0]?.role).toBe('choice');
  });

  it('marks links from Exception/Recover/Resume stages as role "exception"', () => {
    const target = makeStage({ name: 'Handler' });
    const exceptionStage = makeStage({
      name: 'Boom',
      knownType: 'Exception',
      links: { onSuccess: target.stageId, onTrue: null, onFalse: null, choices: [] },
    });
    const page = makePage({ stages: [target, exceptionStage] });
    const process = makeProcess({ name: 'Exception Process', pages: [page] });
    const release = makeRelease({ processes: [process] });

    const graph = buildEstateGraph([release]);
    const processId = 'process:exception process';
    const exceptionStageId = `stage:${processId}:${exceptionStage.stageId}`;
    const links = edgesOfType(graph.edges, 'links-to').filter((e) => e.from === exceptionStageId);
    expect(links).toHaveLength(1);
    expect(links[0]?.role).toBe('exception');
  });
});

describe('buildEstateGraph: evidence and consumers', () => {
  it('deduplicates evidence on the item-level edge and still creates per-stage edges', () => {
    const actionPage = makePage({ name: 'Do Thing', published: true, stages: [] });
    const object = makeObject({ name: 'Shared Object', pages: [actionPage] });

    const stage1 = makeActionStage({ action: { objectName: 'Shared Object', actionName: 'Do Thing' } });
    const stage2 = makeActionStage({ action: { objectName: 'Shared Object', actionName: 'Do Thing' } });
    const page = makePage({ stages: [stage1, stage2] });
    const process = makeProcess({ name: 'Multi Caller', pages: [page] });

    const release = makeRelease({ processes: [process], objects: [object] });
    const graph = buildEstateGraph([release]);

    const processId = 'process:multi caller';
    const targetId = 'action:shared object:do thing';
    const itemLevel = edgesOfType(graph.edges, 'invokes-action').find((e) => e.from === processId && e.to === targetId);
    expect(itemLevel?.evidence?.sort()).toEqual(
      [`stage:${processId}:${stage1.stageId}`, `stage:${processId}:${stage2.stageId}`].sort(),
    );

    const stageLevelEdges = edgesOfType(graph.edges, 'invokes-action').filter((e) => e.to === targetId && e.from !== processId);
    expect(stageLevelEdges).toHaveLength(2);
  });

  it('counts an object consumed by two different processes as two distinct consumers', () => {
    const actionPage = makePage({ name: 'Do Thing', published: true, stages: [] });
    const object = makeObject({ name: 'Shared Object', pages: [actionPage] });

    const stageA = makeActionStage({ action: { objectName: 'Shared Object', actionName: 'Do Thing' } });
    const pageA = makePage({ stages: [stageA] });
    const processA = makeProcess({ name: 'Process A', pages: [pageA] });

    const stageB = makeActionStage({ action: { objectName: 'Shared Object', actionName: 'Do Thing' } });
    const pageB = makePage({ stages: [stageB] });
    const processB = makeProcess({ name: 'Process B', pages: [pageB] });

    const release = makeRelease({ processes: [processA, processB], objects: [object] });
    const graph = buildEstateGraph([release]);

    const targetId = 'action:shared object:do thing';
    const consumerSet = graph.consumers.get(targetId);
    expect(consumerSet?.size).toBe(2);
    expect(consumerSet).toEqual(new Set(['process:process a', 'process:process b']));
  });
});

describe('buildEstateGraph: internal subsheet calls vs cross-process calls', () => {
  it('creates a calls-process edge only for cross-process references', () => {
    const internalStage = makeSubsheetRefStage({ subsheetRef: { subsheetId: 'internal-page-id', processName: null } });
    const crossStage = makeSubsheetRefStage({ subsheetRef: { processName: 'Other Process' } });
    const page = makePage({ stages: [internalStage, crossStage] });
    const process = makeProcess({ name: 'Caller Process', pages: [page] });
    const release = makeRelease({ processes: [process] });

    const graph = buildEstateGraph([release]);
    const processId = 'process:caller process';
    const callsProcess = edgesOfType(graph.edges, 'calls-process').filter((e) => e.from === processId);
    expect(callsProcess).toHaveLength(1);
    expect(callsProcess[0]?.to).toBe('process:other process');
  });
});

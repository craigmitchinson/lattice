/**
 * Builds the normalised, cross-file estate graph from a batch of parsed
 * releases. Pure function, no DOM, no React - runs in a Web Worker and in
 * Node (tests). See docs/data-model.md for identity schemes and edge
 * semantics, and the module-level comments below for the judgement calls
 * this implementation makes where the spec leaves detail open.
 */

import type { ParsedProcess, ParsedRelease, ParsedStage } from '../model/types.ts';
import {
  NODE_KINDS,
  type DuplicateRecord,
  type EdgeType,
  type EstateGraph,
  type GraphEdge,
  type GraphNode,
  type LinkRole,
  type NodeData,
  type NodeKind,
  type NodeResolution,
  type Provenance,
} from './types.ts';
import {
  compareCreatedDates,
  compareVersionStrings,
  displayOf,
  dynamicKeyOf,
  extractActionRef,
  extractNamedInputRef,
  extractProcessCallRef,
  isCredentialActionTarget,
  isEnvironmentExposure,
  isQueueActionTarget,
} from './refs.ts';

/**
 * Edge types the impact walk (and, by the same judgement, the consumers
 * index) traverses. Structural edges (stage-of, page-of, defined-in,
 * links-to) are excluded from both. Exported so impact.ts uses exactly the
 * same set rather than a duplicated, potentially drifting list.
 */
export const DEPENDENCY_EDGE_TYPES: readonly EdgeType[] = [
  'calls-process',
  'invokes-action',
  'action-of',
  'references-queue',
  'references-env-var',
  'references-credential',
  'targets-element',
  'element-of',
];

// ---------------------------------------------------------------------------
// Duplicate resolution
// ---------------------------------------------------------------------------

interface Candidate<T> {
  item: T;
  release: ParsedRelease;
  fileIndex: number;
  version: string | null;
  created: string | null;
}

/** True when `challenger` should replace `current` as the kept copy. */
function isBetter<T>(challenger: Candidate<T>, current: Candidate<T>): boolean {
  if (challenger.version !== null || current.version !== null) {
    if (challenger.version !== null && current.version !== null) {
      const cmp = compareVersionStrings(challenger.version, current.version);
      if (cmp !== 0) return cmp > 0;
      // Equal version strings: fall through to created-date comparison.
    } else {
      // Exactly one side has a version at all: a present version beats an
      // absent one outright, before any date comparison.
      return challenger.version !== null;
    }
  }
  const createdCmp = compareCreatedDates(challenger.created, current.created);
  if (createdCmp !== 0) return createdCmp > 0;
  // Tie (or nothing to differentiate on): the earlier-encountered copy
  // stays, i.e. the challenger never wins here.
  return false;
}

function pickWinner<T>(group: Candidate<T>[]): Candidate<T> {
  let winner = group[0]!;
  for (let i = 1; i < group.length; i++) {
    const challenger = group[i]!;
    if (isBetter(challenger, winner)) winner = challenger;
  }
  return winner;
}

function groupByName<T>(
  releases: ParsedRelease[],
  extract: (release: ParsedRelease) => T[],
  nameOf: (item: T) => string,
  versionOf: (item: T) => string | null,
): Map<string, Candidate<T>[]> {
  const groups = new Map<string, Candidate<T>[]>();
  releases.forEach((release, fileIndex) => {
    for (const item of extract(release)) {
      const key = nameOf(item).toLowerCase();
      const candidate: Candidate<T> = {
        item,
        release,
        fileIndex,
        version: versionOf(item),
        created: release.created,
      };
      const existing = groups.get(key);
      if (existing) existing.push(candidate);
      else groups.set(key, [candidate]);
    }
  });
  return groups;
}

function toDupEntry<T>(c: Candidate<T>): { fileName: string; contentHash: string; version: string | null } {
  return { fileName: c.release.file.fileName, contentHash: c.release.file.contentHash, version: c.version };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildEstateGraph(releases: ParsedRelease[]): EstateGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const duplicates: DuplicateRecord[] = [];
  /** stage node id -> owning process/object node id. */
  const stageOwner = new Map<string, string>();
  /** owner object node id -> raw appModel elementId -> element node id. */
  const elementsByOwner = new Map<string, Map<string, string>>();
  const definedInSeen = new Set<string>();

  interface AccumEntry {
    from: string;
    to: string;
    type: EdgeType;
    evidence: Set<string>;
  }
  const itemLevelAccum = new Map<string, AccumEntry>();

  interface StageForRefs {
    stageId: string;
    ownerId: string;
    ownerKind: 'process' | 'object';
    ownerFile: Provenance;
    stage: ParsedStage;
  }
  const stagesForRefs: StageForRefs[] = [];

  function ensureNode(
    id: string,
    kind: NodeKind,
    name: string,
    resolution: NodeResolution,
    data: NodeData,
  ): GraphNode {
    let node = nodes.get(id);
    if (!node) {
      node = { id, kind, name, resolution, provenance: [], data };
      nodes.set(id, node);
    }
    return node;
  }

  function addProvenance(node: GraphNode, fileName: string, contentHash: string): void {
    if (!node.provenance.some((p) => p.contentHash === contentHash)) {
      node.provenance.push({ fileName, contentHash });
    }
  }

  function addDefinedIn(id: string, contentHash: string): void {
    const key = `${id}|${contentHash}`;
    if (definedInSeen.has(key)) return;
    definedInSeen.add(key);
    edges.push({ from: id, to: `file:${contentHash}`, type: 'defined-in' });
  }

  function accumulateItemLevel(from: string, to: string, type: EdgeType, stageId: string): void {
    const key = `${from}|${to}|${type}`;
    let entry = itemLevelAccum.get(key);
    if (!entry) {
      entry = { from, to, type, evidence: new Set() };
      itemLevelAccum.set(key, entry);
    }
    entry.evidence.add(stageId);
  }

  // --- 1. source file nodes -------------------------------------------------
  for (const release of releases) {
    const id = `file:${release.file.contentHash}`;
    const node = ensureNode(id, 'sourceFile', release.file.fileName, 'resolved', {});
    addProvenance(node, release.file.fileName, release.file.contentHash);
  }

  // --- 2. duplicate resolution ----------------------------------------------
  const processGroups = groupByName(releases, (r) => r.processes, (p) => p.name, (p) => p.version);
  const objectGroups = groupByName(releases, (r) => r.objects, (p) => p.name, (p) => p.version);
  const queueGroups = groupByName(releases, (r) => r.workQueues, (q) => q.name, () => null);
  const envVarGroups = groupByName(
    releases,
    (r) => r.environmentVariables,
    (e) => e.name,
    () => null,
  );
  const credentialGroups = groupByName(releases, (r) => r.credentials, (c) => c.name, () => null);

  function resolveWinners<T>(
    groups: Map<string, Candidate<T>[]>,
    kind: NodeKind,
    nameOf: (item: T) => string,
  ): Map<string, Candidate<T>> {
    const winners = new Map<string, Candidate<T>>();
    for (const [key, group] of groups) {
      const winner = pickWinner(group);
      winners.set(key, winner);
      if (group.length > 1) {
        const discarded = group.filter((c) => c !== winner).map(toDupEntry);
        duplicates.push({ kind, name: nameOf(winner.item), kept: toDupEntry(winner), discarded });
      }
    }
    return winners;
  }

  const processWinners = resolveWinners(processGroups, 'process', (p) => p.name);
  const objectWinners = resolveWinners(objectGroups, 'object', (p) => p.name);
  const queueWinners = resolveWinners(queueGroups, 'workQueue', (q) => q.name);
  const envVarWinners = resolveWinners(envVarGroups, 'environmentVariable', (e) => e.name);
  const credentialWinners = resolveWinners(credentialGroups, 'credential', (c) => c.name);

  // --- 3. definitional nodes: process/object containers ---------------------
  function buildContainerNode(kind: 'process' | 'object', key: string, winner: Candidate<ParsedProcess>): void {
    const id = `${kind}:${key}`;
    const totalStages = winner.item.pages.reduce((sum, pg) => sum + pg.stages.length, 0);
    const data: NodeData = {
      version: winner.item.version ?? undefined,
      bpversion: winner.item.bpversion ?? undefined,
      published: winner.item.published,
      narrative: winner.item.narrative ?? undefined,
      pageCount: winner.item.pages.length,
      stageCount: totalStages,
    };
    const node = ensureNode(id, kind, winner.item.name, 'resolved', data);
    const group = (kind === 'process' ? processGroups : objectGroups).get(key)!;
    for (const candidate of group) {
      addProvenance(node, candidate.release.file.fileName, candidate.release.file.contentHash);
      addDefinedIn(id, candidate.release.file.contentHash);
    }
  }

  for (const [key, winner] of processWinners) buildContainerNode('process', key, winner);
  for (const [key, winner] of objectWinners) buildContainerNode('object', key, winner);

  // --- 3b. definitional nodes: workQueue/environmentVariable/credential -----
  function buildSimpleDefinedNode<T>(
    kind: NodeKind,
    prefix: string,
    key: string,
    winner: Candidate<T>,
    group: Candidate<T>[],
    nameOf: (item: T) => string,
    detailOf: (item: T) => string | undefined,
  ): void {
    const id = `${prefix}:${key}`;
    const node = ensureNode(id, kind, nameOf(winner.item), 'resolved', { detail: detailOf(winner.item) });
    for (const candidate of group) {
      addProvenance(node, candidate.release.file.fileName, candidate.release.file.contentHash);
      addDefinedIn(id, candidate.release.file.contentHash);
    }
  }

  for (const [key, winner] of queueWinners) {
    buildSimpleDefinedNode(
      'workQueue',
      'queue',
      key,
      winner,
      queueGroups.get(key)!,
      (q) => q.name,
      (q) => q.keyField ?? undefined,
    );
  }
  for (const [key, winner] of envVarWinners) {
    buildSimpleDefinedNode(
      'environmentVariable',
      'envvar',
      key,
      winner,
      envVarGroups.get(key)!,
      (e) => e.name,
      (e) => e.description ?? e.value ?? undefined,
    );
  }
  for (const [key, winner] of credentialWinners) {
    buildSimpleDefinedNode(
      'credential',
      'credential',
      key,
      winner,
      credentialGroups.get(key)!,
      (c) => c.name,
      (c) => c.description ?? undefined,
    );
  }

  // --- 4. pages, stages, actions, app model elements (winners only) --------
  function buildPagesAndStages(kind: 'process' | 'object', key: string, winner: Candidate<ParsedProcess>): void {
    const ownerId = `${kind}:${key}`;
    const ownerFile: Provenance = {
      fileName: winner.release.file.fileName,
      contentHash: winner.release.file.contentHash,
    };

    for (const page of winner.item.pages) {
      const pageId = `page:${ownerId}:${page.subsheetId}`;
      const pageNode = ensureNode(pageId, 'page', page.name, 'resolved', {
        detail: page.type,
        published: page.published,
        stageCount: page.stages.length,
      });
      addProvenance(pageNode, ownerFile.fileName, ownerFile.contentHash);
      edges.push({ from: pageId, to: ownerId, type: 'page-of' });

      if (kind === 'object' && page.published) {
        const actionId = `action:${key}:${page.name.toLowerCase()}`;
        const actionNode = ensureNode(actionId, 'action', page.name, 'resolved', {
          version: winner.item.version ?? undefined,
          bpversion: winner.item.bpversion ?? undefined,
          published: true,
          stageCount: page.stages.length,
        });
        addProvenance(actionNode, ownerFile.fileName, ownerFile.contentHash);
        edges.push({ from: actionId, to: ownerId, type: 'action-of' });
      }

      for (const stage of page.stages) {
        const stageId = `stage:${ownerId}:${stage.stageId}`;
        const stageNode = ensureNode(stageId, 'stage', stage.name, 'resolved', {
          stageType: stage.knownType ?? stage.type,
        });
        addProvenance(stageNode, ownerFile.fileName, ownerFile.contentHash);
        stageOwner.set(stageId, ownerId);
        edges.push({ from: stageId, to: pageId, type: 'stage-of' });
        stagesForRefs.push({ stageId, ownerId, ownerKind: kind, ownerFile, stage });
      }
    }

    if (kind === 'object' && winner.item.appModel) {
      const elementMap = new Map<string, string>();
      elementsByOwner.set(ownerId, elementMap);
      for (const element of winner.item.appModel.elements) {
        const elementId = `element:${ownerId}:${element.elementId}`;
        const detail = element.elementType ? `${element.path} (${element.elementType})` : element.path;
        const elementNode = ensureNode(elementId, 'appModelElement', element.name, 'resolved', { detail });
        addProvenance(elementNode, ownerFile.fileName, ownerFile.contentHash);
        edges.push({ from: elementId, to: ownerId, type: 'element-of' });
        elementMap.set(element.elementId, elementId);
      }
    }
  }

  for (const [key, winner] of processWinners) buildPagesAndStages('process', key, winner);
  for (const [key, winner] of objectWinners) buildPagesAndStages('object', key, winner);

  // --- 5. reference extraction: dependency edges + external/dynamic nodes --

  /** Resolves (creating if necessary) a single-name-keyed target node. */
  function resolveNamedTarget(
    kind: NodeKind,
    prefix: string,
    rawName: string,
    dynamic: boolean,
    referencingFile: Provenance,
  ): string {
    const id = dynamic ? `${prefix}:${dynamicKeyOf(rawName)}` : `${prefix}:${rawName.toLowerCase()}`;
    let node = nodes.get(id);
    if (!node) {
      node = ensureNode(id, kind, dynamic ? displayOf(rawName) : rawName, dynamic ? 'dynamic' : 'external', {});
    }
    addProvenance(node, referencingFile.fileName, referencingFile.contentHash);
    return id;
  }

  function resolveActionTarget(objectNameRaw: string, actionNameRaw: string, referencingFile: Provenance): string {
    const ref = extractActionRef(objectNameRaw, actionNameRaw);
    const id = ref.dynamic
      ? `action:${dynamicKeyOf(objectNameRaw)}:${dynamicKeyOf(actionNameRaw)}`
      : `action:${objectNameRaw.toLowerCase()}:${actionNameRaw.toLowerCase()}`;
    let node = nodes.get(id);
    if (!node) {
      const name = ref.dynamic
        ? `${displayOf(objectNameRaw)}:${displayOf(actionNameRaw)}`
        : `${objectNameRaw}:${actionNameRaw}`;
      node = ensureNode(id, 'action', name, ref.dynamic ? 'dynamic' : 'external', {});
    }
    addProvenance(node, referencingFile.fileName, referencingFile.contentHash);
    return id;
  }

  function resolveElementTarget(ownerId: string, elementIdRaw: string | null, referencingFile: Provenance): string {
    const map = elementsByOwner.get(ownerId);
    if (elementIdRaw && map?.has(elementIdRaw)) {
      const id = map.get(elementIdRaw)!;
      addProvenance(nodes.get(id)!, referencingFile.fileName, referencingFile.contentHash);
      return id;
    }
    // Shared external placeholder, one per owning object, per the judgement
    // call recorded in the final report (granularity of unmatched elements).
    const id = `element:${ownerId}:__unresolved__`;
    let node = nodes.get(id);
    if (!node) {
      node = ensureNode(id, 'appModelElement', 'Unresolved element', 'external', {});
    }
    addProvenance(node, referencingFile.fileName, referencingFile.contentHash);
    return id;
  }

  for (const { stageId, ownerId, ownerKind, ownerFile, stage } of stagesForRefs) {
    // links-to: Exception/Recover/Resume stages mark their outgoing links as
    // role 'exception' rather than their nominal role, since for those
    // stage types any link represents exception-flow linkage (see the
    // final report for why this is a judgement call).
    const exceptionCarrier =
      stage.knownType === 'Exception' || stage.knownType === 'Recover' || stage.knownType === 'Resume';
    const addLink = (targetStageId: string | null, nominalRole: LinkRole): void => {
      if (targetStageId === null) return;
      const targetNodeId = `stage:${ownerId}:${targetStageId}`;
      if (!nodes.has(targetNodeId)) return; // dangling/unrecognised link target; skip defensively
      edges.push({
        from: stageId,
        to: targetNodeId,
        type: 'links-to',
        role: exceptionCarrier ? 'exception' : nominalRole,
      });
    };
    addLink(stage.links.onSuccess, 'success');
    addLink(stage.links.onTrue, 'true');
    addLink(stage.links.onFalse, 'false');
    for (const choice of stage.links.choices) {
      addLink(choice.target, 'choice');
    }

    // Action stages: invokes-action, plus queue/credential references when
    // the target object is one of the built-in special objects.
    if (stage.action) {
      const { objectName, actionName } = stage.action;
      const actionTargetId = resolveActionTarget(objectName, actionName, ownerFile);
      accumulateItemLevel(ownerId, actionTargetId, 'invokes-action', stageId);
      edges.push({ from: stageId, to: actionTargetId, type: 'invokes-action' });

      if (isQueueActionTarget(objectName)) {
        const queueInput = extractNamedInputRef(stage.action.inputs, 'Queue Name');
        const queueTargetId = queueInput.dynamic
          ? resolveNamedTarget('workQueue', 'queue', queueInput.raw ?? '(no expression)', true, ownerFile)
          : resolveNamedTarget('workQueue', 'queue', queueInput.literalValue!, false, ownerFile);
        accumulateItemLevel(ownerId, queueTargetId, 'references-queue', stageId);
        edges.push({ from: stageId, to: queueTargetId, type: 'references-queue' });
      }

      if (isCredentialActionTarget(objectName)) {
        const credInput = extractNamedInputRef(stage.action.inputs, 'Credential Name');
        const credTargetId = credInput.dynamic
          ? resolveNamedTarget('credential', 'credential', credInput.raw ?? '(no expression)', true, ownerFile)
          : resolveNamedTarget('credential', 'credential', credInput.literalValue!, false, ownerFile);
        accumulateItemLevel(ownerId, credTargetId, 'references-credential', stageId);
        edges.push({ from: stageId, to: credTargetId, type: 'references-credential' });
      }
    }

    // SubSheet/Process ref stages: cross-process calls only (processName
    // non-null). Internal-only subsheet calls (processName null) are not
    // modelled as a separate edge type - see the final report.
    if (stage.subsheetRef) {
      const ref = extractProcessCallRef(stage.subsheetRef.processName);
      if (ref) {
        const processTargetId = resolveNamedTarget('process', 'process', ref.processName, ref.dynamic, ownerFile);
        accumulateItemLevel(ownerId, processTargetId, 'calls-process', stageId);
        edges.push({ from: stageId, to: processTargetId, type: 'calls-process' });
      }
    }

    // Data/Collection stages exposed as environment variables.
    if (stage.data && isEnvironmentExposure(stage.data.exposure)) {
      const envTargetId = resolveNamedTarget('environmentVariable', 'envvar', stage.name, false, ownerFile);
      accumulateItemLevel(ownerId, envTargetId, 'references-env-var', stageId);
      edges.push({ from: stageId, to: envTargetId, type: 'references-env-var' });
    }

    // Navigate/Read/Write/WaitStart steps against the owning object's app
    // model. Only meaningful when the owner is an object (see final report).
    if (stage.appSteps && ownerKind === 'object') {
      for (const step of stage.appSteps.steps) {
        const elementTargetId = resolveElementTarget(ownerId, step.elementId, ownerFile);
        edges.push({ from: stageId, to: elementTargetId, type: 'targets-element' });
      }
    }
  }

  for (const entry of itemLevelAccum.values()) {
    edges.push({ from: entry.from, to: entry.to, type: entry.type, evidence: Array.from(entry.evidence) });
  }

  // --- 6. indexes ------------------------------------------------------------
  const outEdges = new Map<string, Map<EdgeType, GraphEdge[]>>();
  const inEdges = new Map<string, Map<EdgeType, GraphEdge[]>>();
  function indexEdge(map: Map<string, Map<EdgeType, GraphEdge[]>>, nodeId: string, edge: GraphEdge): void {
    let byType = map.get(nodeId);
    if (!byType) {
      byType = new Map();
      map.set(nodeId, byType);
    }
    let list = byType.get(edge.type);
    if (!list) {
      list = [];
      byType.set(edge.type, list);
    }
    list.push(edge);
  }
  for (const edge of edges) {
    indexEdge(outEdges, edge.from, edge);
    indexEdge(inEdges, edge.to, edge);
  }

  const byKind = new Map<NodeKind, string[]>();
  for (const kind of NODE_KINDS) byKind.set(kind, []);
  for (const node of nodes.values()) {
    byKind.get(node.kind)!.push(node.id);
  }
  for (const kind of NODE_KINDS) {
    const list = byKind.get(kind)!;
    list.sort((a, b) => {
      const na = nodes.get(a)!.name.toLowerCase();
      const nb = nodes.get(b)!.name.toLowerCase();
      if (na !== nb) return na < nb ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  const consumers = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!DEPENDENCY_EDGE_TYPES.includes(edge.type)) continue;
    const fromNode = nodes.get(edge.from);
    if (!fromNode) continue;
    let consumer: string | null = null;
    if (fromNode.kind === 'process' || fromNode.kind === 'object') {
      consumer = edge.from;
    } else if (fromNode.kind === 'stage') {
      consumer = stageOwner.get(edge.from) ?? null;
    }
    if (consumer === null) continue;
    let set = consumers.get(edge.to);
    if (!set) {
      set = new Set();
      consumers.set(edge.to, set);
    }
    set.add(consumer);
  }

  return { nodes, edges, outEdges, inEdges, byKind, consumers, duplicates };
}

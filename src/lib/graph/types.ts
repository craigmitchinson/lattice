/**
 * Estate graph: the normalised, cross-file graph every analysis runs
 * against. Built from parsed releases by pure functions. See
 * docs/data-model.md for identity schemes and edge semantics.
 */

export type NodeKind =
  | 'process'
  | 'object'
  | 'action'
  | 'page'
  | 'stage'
  | 'workQueue'
  | 'environmentVariable'
  | 'credential'
  | 'appModelElement'
  | 'sourceFile';

export const NODE_KINDS: readonly NodeKind[] = [
  'process',
  'object',
  'action',
  'page',
  'stage',
  'workQueue',
  'environmentVariable',
  'credential',
  'appModelElement',
  'sourceFile',
];

/**
 * resolved: definition present in the import set.
 * external: referenced but not defined in anything imported ("external or missing").
 * dynamic: target comes from an expression, "unresolvable at rest".
 */
export type NodeResolution = 'resolved' | 'external' | 'dynamic';

export interface Provenance {
  fileName: string;
  contentHash: string;
}

/** Kind-specific display payload for the estate browser. */
export interface NodeData {
  version?: string;
  bpversion?: string;
  published?: boolean;
  narrative?: string;
  /** Stage nodes: raw stage type. */
  stageType?: string;
  /** Data-item exposure, queue key field, etc. */
  detail?: string;
  /** Page/stage counts for container nodes. */
  pageCount?: number;
  stageCount?: number;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** Display name, original casing. */
  name: string;
  resolution: NodeResolution;
  provenance: Provenance[];
  data: NodeData;
}

export type EdgeType =
  | 'calls-process'
  | 'invokes-action'
  | 'action-of'
  | 'page-of'
  | 'stage-of'
  | 'references-queue'
  | 'references-env-var'
  | 'references-credential'
  | 'targets-element'
  | 'element-of'
  | 'links-to'
  | 'defined-in';

export type LinkRole = 'success' | 'true' | 'false' | 'choice' | 'exception';

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  /** links-to edges only. */
  role?: LinkRole;
  /**
   * Stage node ids justifying a derived item-level edge (e.g. the action
   * stages behind an invokes-action edge). Traceability requirement:
   * every impact answer points at exact stages.
   */
  evidence?: string[];
}

/** Same item exported in more than one file; latest version wins. */
export interface DuplicateRecord {
  kind: NodeKind;
  name: string;
  kept: { fileName: string; contentHash: string; version: string | null };
  discarded: { fileName: string; contentHash: string; version: string | null }[];
}

export interface EstateGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** node id -> edge type -> edges leaving that node. */
  outEdges: Map<string, Map<EdgeType, GraphEdge[]>>;
  /** node id -> edge type -> edges arriving at that node. */
  inEdges: Map<string, Map<EdgeType, GraphEdge[]>>;
  byKind: Map<NodeKind, string[]>;
  /** node id -> distinct consuming process/object node ids. */
  consumers: Map<string, Set<string>>;
  duplicates: DuplicateRecord[];
}

/** JSON-serialisable form for export and IndexedDB-free transfer. */
export interface SerialisedGraph {
  schemaVersion: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  duplicates: DuplicateRecord[];
}

/** One hop group in an impact result, grouped by kind for display. */
export interface ImpactGroup {
  kind: NodeKind;
  nodes: { node: GraphNode; depth: number; via: EdgeType; evidence: string[] }[];
}

export interface ImpactResult {
  root: GraphNode;
  /** What the root depends on (outgoing walk). */
  upstream: ImpactGroup[];
  /** What depends on the root (incoming walk). */
  downstream: ImpactGroup[];
  depth: number;
}

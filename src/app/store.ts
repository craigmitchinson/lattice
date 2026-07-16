/**
 * Single Zustand store for the whole app. Owns ingest orchestration (via the
 * worker pool), persistence (via src/lib/persist/db.ts) and the derived
 * estate graph. Parsing itself never runs here: this module only dispatches
 * work to parse.worker.ts and reacts to its results.
 */

import { create } from 'zustand';
import { buildEstateGraph } from '../lib/graph/build.ts';
import type { EstateGraph } from '../lib/graph/types.ts';
import { mergeDiscoveryReports, type SchemaDiscoveryReport } from '../lib/discovery/discover.ts';
import { clearAllData, getStoredReleases, putRelease } from '../lib/persist/db.ts';
import type { ParsedRelease, ParseFailure } from '../lib/model/types.ts';
import { WorkerPool, type ParseWorkerResponse } from './ingest/pool.ts';
import { classifyIncomingFile } from './lib/duplicates.ts';
import type { FileEntry, FileStatus } from './lib/fileEntry.ts';
import { deriveItemCounts, distinctBpVersions } from './lib/itemCounts.ts';
import { DEFAULT_BROWSER_FILTERS, type BrowserFilters, type KindFilter, type ResolutionFilter } from './lib/filters.ts';

export type ViewName = 'import' | 'browser' | 'impact' | 'discovery' | 'data';

export interface IngestFile {
  name: string;
  buffer: ArrayBuffer;
}

export interface Selection {
  nodeId: string;
}

const MIN_IMPACT_DEPTH = 1;
const MAX_IMPACT_DEPTH = 5;
const DEFAULT_IMPACT_DEPTH = 3;

function clampDepth(depth: number): number {
  return Math.min(MAX_IMPACT_DEPTH, Math.max(MIN_IMPACT_DEPTH, Math.round(depth)));
}

function describeFailure(failure: ParseFailure): string {
  if (failure.line === undefined) return failure.reason;
  const column = failure.column === undefined ? '' : `, column ${failure.column}`;
  return `${failure.reason} (line ${failure.line}${column})`;
}

let entrySequence = 0;
function nextEntryId(): string {
  entrySequence += 1;
  return `entry-${entrySequence}`;
}

/**
 * Manual type guard: response.outcome.ok is a nested discriminant (the
 * discriminant property lives on response.outcome, not on response itself),
 * which TypeScript's control-flow narrowing does not follow automatically.
 */
function isParseSuccess(
  response: ParseWorkerResponse,
): response is Extract<ParseWorkerResponse, { outcome: { ok: true } }> {
  return response.outcome.ok;
}

export interface LatticeState {
  fileEntries: FileEntry[];
  releases: ParsedRelease[];
  graph: EstateGraph | null;
  discovery: SchemaDiscoveryReport | null;
  selection: Selection | null;
  impactDepth: number;
  view: ViewName;
  /** Cached files discarded at startup because they were stamped with an older schema version. */
  discardedStale: number;
  hydrated: boolean;
  browserFilters: BrowserFilters;

  ingestFiles: (files: IngestFile[]) => void;
  hydrateFromStore: () => Promise<void>;
  clearEverything: () => Promise<void>;
  select: (nodeId: string) => void;
  setDepth: (depth: number) => void;
  setView: (view: ViewName) => void;
  setBrowserSearch: (search: string) => void;
  setBrowserKindFilter: (kind: KindFilter) => void;
  setBrowserResolutionFilter: (resolution: ResolutionFilter) => void;
}

/**
 * In-memory mirror of every content hash already persisted (seeded from
 * IndexedDB at hydrate, kept in sync on every successful persist). This app
 * is the only writer to its IndexedDB database, so the mirror stays
 * authoritative without a hasFile() round trip per parsed file.
 */
let persistedHashes = new Set<string>();

let pool: WorkerPool | null = null;
function ensurePool(): WorkerPool {
  if (!pool) pool = new WorkerPool();
  return pool;
}

export const useLatticeStore = create<LatticeState>()((set, get) => {
  function updateEntry(id: string, patch: Partial<FileEntry>): void {
    set((state) => ({
      fileEntries: state.fileEntries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }));
  }

  /** Applies one worker result to store state. Never rejects: all failure paths are handled internally. */
  async function applyParseResult(entryId: string, response: ParseWorkerResponse, batchHashes: Set<string>): Promise<void> {
    if (!isParseSuccess(response)) {
      updateEntry(entryId, {
        status: 'failed',
        error: describeFailure(response.outcome.failure),
        contentHash: response.contentHash ?? undefined,
      });
      return;
    }

    const { contentHash, discovery } = response;
    const release = response.outcome.release;
    const itemCounts = deriveItemCounts(release);
    const bpversions = distinctBpVersions(release);
    const classification = classifyIncomingFile(contentHash, persistedHashes, batchHashes);

    if (classification === 'duplicate') {
      updateEntry(entryId, { status: 'duplicate', contentHash, itemCounts, bpversions });
      return;
    }

    batchHashes.add(contentHash);
    persistedHashes.add(contentHash);

    try {
      await putRelease(release);
    } catch (err) {
      // Parsing succeeded even if the persistence write failed; keep the
      // release in memory for this session rather than losing the work.
      console.error(`Lattice: failed to persist ${release.file.fileName} locally`, err);
    }

    set((state) => ({ releases: [...state.releases, release] }));
    set((state) => ({
      discovery: state.discovery ? mergeDiscoveryReports([state.discovery, discovery]) : discovery,
    }));

    updateEntry(entryId, { status: 'done', contentHash, itemCounts, bpversions });
  }

  return {
    fileEntries: [],
    releases: [],
    graph: null,
    discovery: null,
    selection: null,
    impactDepth: DEFAULT_IMPACT_DEPTH,
    view: 'import',
    discardedStale: 0,
    hydrated: false,
    browserFilters: DEFAULT_BROWSER_FILTERS,

    ingestFiles: (files) => {
      if (files.length === 0) return;
      const workerPool = ensurePool();

      const batch = files.map((file) => ({
        file,
        entry: { id: nextEntryId(), fileName: file.name, status: 'queued' as FileStatus },
      }));

      set((state) => ({ fileEntries: [...state.fileEntries, ...batch.map((b) => b.entry)] }));

      const batchHashes = new Set<string>();
      let completed = 0;

      for (const { file, entry } of batch) {
        workerPool.enqueue(
          { id: entry.id, fileName: file.name, buffer: file.buffer },
          {
            onStart: () => updateEntry(entry.id, { status: 'parsing' }),
            onResult: (response) => {
              void applyParseResult(entry.id, response, batchHashes).finally(() => {
                completed += 1;
                if (completed === batch.length) {
                  set({ graph: buildEstateGraph(get().releases) });
                }
              });
            },
          },
        );
      }
    },

    hydrateFromStore: async () => {
      const { releases, discardedStale } = await getStoredReleases();
      persistedHashes = new Set(releases.map((r) => r.file.contentHash));
      const graph = releases.length > 0 ? buildEstateGraph(releases) : null;
      set({
        releases,
        graph,
        discardedStale,
        hydrated: true,
        view: releases.length > 0 ? 'browser' : 'import',
      });
    },

    clearEverything: async () => {
      if (pool) {
        pool.dispose();
        pool = null;
      }
      await clearAllData();
      persistedHashes = new Set();
      set({
        fileEntries: [],
        releases: [],
        graph: null,
        discovery: null,
        selection: null,
        impactDepth: DEFAULT_IMPACT_DEPTH,
        view: 'import',
        discardedStale: 0,
        hydrated: true,
        browserFilters: DEFAULT_BROWSER_FILTERS,
      });
    },

    select: (nodeId) => {
      set({ selection: { nodeId }, view: 'impact' });
    },

    setDepth: (depth) => {
      set({ impactDepth: clampDepth(depth) });
    },

    setView: (view) => {
      set({ view });
    },

    setBrowserSearch: (search) => {
      set((state) => ({ browserFilters: { ...state.browserFilters, search } }));
    },

    setBrowserKindFilter: (kind) => {
      set((state) => ({ browserFilters: { ...state.browserFilters, kind } }));
    },

    setBrowserResolutionFilter: (resolution) => {
      set((state) => ({ browserFilters: { ...state.browserFilters, resolution } }));
    },
  };
});

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

/**
 * Hydration runs exactly once; every path that classifies or persists a file
 * awaits this first so an in-flight IndexedDB read can never race an ingest.
 */
let hydrationPromise: Promise<void> | null = null;

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
    // Duplicate classification must see the persisted-hash mirror fully
    // seeded, so results wait for hydration (a no-op once it has run).
    await get().hydrateFromStore();

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

    // Only a confirmed write marks the hash as persisted; marking it early
    // would make a failed write look like a stored file, so a later re-drop
    // of the same file would be skipped as a duplicate with no way to retry.
    let persistWarning: string | undefined;
    try {
      await putRelease(release);
      persistedHashes.add(contentHash);
    } catch (err) {
      // Parsing succeeded even if the persistence write failed; keep the
      // release in memory for this session rather than losing the work.
      persistWarning = 'held in memory only, the local cache write failed';
      console.error(`Lattice: failed to persist ${release.file.fileName} locally`, err);
    }

    set((state) => ({ releases: [...state.releases, release] }));
    set((state) => ({
      discovery: state.discovery ? mergeDiscoveryReports([state.discovery, discovery]) : discovery,
    }));

    updateEntry(entryId, { status: 'done', contentHash, itemCounts, bpversions, error: persistWarning });
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

    hydrateFromStore: () => {
      // Idempotent: concurrent callers (mount effect, parse results) share
      // one hydration run and simply await its completion.
      hydrationPromise ??= (async () => {
        let stored: ParsedRelease[] = [];
        let discardedStale = 0;
        try {
          const result = await getStoredReleases();
          stored = result.releases;
          discardedStale = result.discardedStale;
        } catch (err) {
          // IndexedDB being unavailable must not block importing; the app
          // simply runs without a cache for this session.
          console.error('Lattice: could not read the local cache', err);
        }

        for (const release of stored) persistedHashes.add(release.file.contentHash);

        // Merge rather than replace: an ingest may already have added
        // releases while the cache read was in flight.
        const current = get();
        const inMemory = new Set(current.releases.map((r) => r.file.contentHash));
        const releases = [...current.releases, ...stored.filter((r) => !inMemory.has(r.file.contentHash))];

        const untouched = current.fileEntries.length === 0 && current.view === 'import';
        set({
          releases,
          graph: releases.length > 0 ? buildEstateGraph(releases) : null,
          discardedStale,
          hydrated: true,
          // Navigate to the estate only when the user has not started anything.
          ...(untouched && releases.length > 0 ? { view: 'browser' as ViewName } : {}),
        });
      })();
      return hydrationPromise;
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

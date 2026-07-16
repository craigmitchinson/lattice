/**
 * Per-file ingest state shown in the import batch table. Kept separate from
 * store.ts so the pure summary/filter helpers can import it without pulling
 * in the store's browser-only dependencies (the worker pool, IndexedDB).
 */

import type { ItemCounts } from './itemCounts.ts';

export type FileStatus = 'queued' | 'parsing' | 'done' | 'failed' | 'duplicate';

export interface FileEntry {
  /** Stable per-batch-entry identity, distinct from fileName (names can repeat within a drop). */
  id: string;
  fileName: string;
  status: FileStatus;
  contentHash?: string;
  /** Set when status is 'failed': the parse failure reason. */
  error?: string;
  itemCounts?: ItemCounts;
  /** Distinct bpversion values found in this file's processes and objects. */
  bpversions?: string[];
}

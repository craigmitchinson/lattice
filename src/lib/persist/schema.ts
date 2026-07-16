/**
 * Persistence schema. Only the parsed model is ever stored (never raw
 * bytes); the estate graph is rebuilt from parsed releases at startup. See
 * docs/data-model.md "Persistence".
 */

import type { ParsedRelease, SourceFileMeta } from '../model/types.ts';

export const SCHEMA_VERSION = 1;

/** One record in the 'files' IndexedDB object store, keyed by contentHash. */
export interface PersistedFileRecord {
  schemaVersion: number;
  meta: SourceFileMeta;
  release: ParsedRelease;
}

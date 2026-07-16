/**
 * Duplicate-hash classification for incoming files. A file is a duplicate
 * import (not a data-model duplicate item, see graph DuplicateRecord) when
 * its content hash is already in IndexedDB, or already seen earlier in the
 * same ingest batch (two identical files dropped together).
 */

export type IncomingFileClassification = 'new' | 'duplicate';

export function classifyIncomingFile(
  contentHash: string,
  hashesAlreadyStored: ReadonlySet<string>,
  hashesSeenThisBatch: ReadonlySet<string>,
): IncomingFileClassification {
  if (hashesAlreadyStored.has(contentHash) || hashesSeenThisBatch.has(contentHash)) {
    return 'duplicate';
  }
  return 'new';
}

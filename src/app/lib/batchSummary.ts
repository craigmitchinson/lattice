/**
 * Rolls up per-file ingest state and the built estate graph into the batch
 * summary panel shown under the import progress table. Pure, so it is
 * tested without a DOM.
 */

import type { EstateGraph } from '../../lib/graph/types.ts';
import type { FileEntry } from './fileEntry.ts';
import { addItemCounts, emptyItemCounts, type ItemCounts } from './itemCounts.ts';

export interface BatchSummary {
  totalFiles: number;
  done: number;
  failed: number;
  duplicate: number;
  queued: number;
  parsing: number;
  itemsByType: ItemCounts;
  distinctBpVersions: string[];
  /** graph.duplicates.length: same item exported in more than one file. */
  duplicateConflicts: number;
  /** Count of nodes referenced but never defined in the imported set. */
  externalOrMissingCount: number;
  /** Count of nodes whose target is an expression, unresolvable at rest. */
  dynamicCount: number;
}

export function deriveBatchSummary(fileEntries: readonly FileEntry[], graph: EstateGraph | null): BatchSummary {
  let done = 0;
  let failed = 0;
  let duplicate = 0;
  let queued = 0;
  let parsing = 0;
  let itemsByType = emptyItemCounts();
  const bpVersions = new Set<string>();

  for (const entry of fileEntries) {
    switch (entry.status) {
      case 'done':
        done++;
        break;
      case 'failed':
        failed++;
        break;
      case 'duplicate':
        duplicate++;
        break;
      case 'queued':
        queued++;
        break;
      case 'parsing':
        parsing++;
        break;
    }
    if (entry.itemCounts) itemsByType = addItemCounts(itemsByType, entry.itemCounts);
    if (entry.bpversions) for (const version of entry.bpversions) bpVersions.add(version);
  }

  let duplicateConflicts = 0;
  let externalOrMissingCount = 0;
  let dynamicCount = 0;

  if (graph) {
    duplicateConflicts = graph.duplicates.length;
    for (const node of graph.nodes.values()) {
      if (node.resolution === 'external') externalOrMissingCount++;
      else if (node.resolution === 'dynamic') dynamicCount++;
    }
  }

  return {
    totalFiles: fileEntries.length,
    done,
    failed,
    duplicate,
    queued,
    parsing,
    itemsByType,
    distinctBpVersions: Array.from(bpVersions).sort(),
    duplicateConflicts,
    externalOrMissingCount,
    dynamicCount,
  };
}

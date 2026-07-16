/**
 * Per-file item tallies and bpversion extraction, derived from a parsed
 * release. Pure; used both for the per-file row in the import batch table
 * and rolled up into the batch summary.
 */

import type { ParsedRelease } from '../../lib/model/types.ts';

export interface ItemCounts {
  processes: number;
  objects: number;
  workQueues: number;
  environmentVariables: number;
  credentials: number;
  otherItems: number;
}

export function deriveItemCounts(release: ParsedRelease): ItemCounts {
  return {
    processes: release.processes.length,
    objects: release.objects.length,
    workQueues: release.workQueues.length,
    environmentVariables: release.environmentVariables.length,
    credentials: release.credentials.length,
    otherItems: release.otherItems.length,
  };
}

export function addItemCounts(a: ItemCounts, b: ItemCounts): ItemCounts {
  return {
    processes: a.processes + b.processes,
    objects: a.objects + b.objects,
    workQueues: a.workQueues + b.workQueues,
    environmentVariables: a.environmentVariables + b.environmentVariables,
    credentials: a.credentials + b.credentials,
    otherItems: a.otherItems + b.otherItems,
  };
}

export function emptyItemCounts(): ItemCounts {
  return { processes: 0, objects: 0, workQueues: 0, environmentVariables: 0, credentials: 0, otherItems: 0 };
}

/** Distinct, sorted bpversion values across a release's processes and objects. */
export function distinctBpVersions(release: ParsedRelease): string[] {
  const versions = new Set<string>();
  for (const item of [...release.processes, ...release.objects]) {
    if (item.bpversion) versions.add(item.bpversion);
  }
  return Array.from(versions).sort();
}

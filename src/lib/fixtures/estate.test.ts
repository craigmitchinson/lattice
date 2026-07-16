import { describe, expect, it } from 'vitest';
import { parseRelease } from '../parser/parseRelease';
import { syntheticEstate } from './estate';

describe('syntheticEstate', () => {
  it('is deterministic for a given (fileCount, seed) pair', () => {
    const a = syntheticEstate(6, 42);
    const b = syntheticEstate(6, 42);
    expect(a.map((f) => f.fileName)).toEqual(b.map((f) => f.fileName));
    expect(a.map((f) => f.xml)).toEqual(b.map((f) => f.xml));
  });

  it('produces exactly fileCount files, all parseable', () => {
    const files = syntheticEstate(12, 7);
    expect(files).toHaveLength(12);

    for (const file of files) {
      const outcome = parseRelease({
        fileName: file.fileName,
        content: file.xml,
        contentHash: `hash-${file.fileName}`,
        byteSize: file.xml.length,
        importedAt: '2026-07-16T09:00:00Z',
      });
      expect(outcome.ok, `${file.fileName} should parse cleanly`).toBe(true);
    }
  });

  it('includes a duplicate process pair and at least one unresolved-looking action reference', () => {
    const files = syntheticEstate(6, 3);
    let sawDuplicateName = 0;
    let sawWorkQueuesAction = false;

    for (const file of files) {
      const outcome = parseRelease({
        fileName: file.fileName,
        content: file.xml,
        contentHash: `hash-${file.fileName}`,
        byteSize: file.xml.length,
        importedAt: '2026-07-16T09:00:00Z',
      });
      if (!outcome.ok) continue;

      for (const process of outcome.release.processes) {
        if (process.name === 'Shared Utility Process') sawDuplicateName += 1;
        for (const page of process.pages) {
          for (const stage of page.stages) {
            if (stage.action?.objectName === 'Work Queues') sawWorkQueuesAction = true;
          }
        }
      }
    }

    expect(sawDuplicateName).toBe(2);
    expect(sawWorkQueuesAction).toBe(true);
  });

  it('performance smoke test: parses a 150-file estate in well under 30 seconds', () => {
    const files = syntheticEstate(150, 42);
    expect(files).toHaveLength(150);

    const start = performance.now();
    let okCount = 0;
    for (const file of files) {
      const outcome = parseRelease({
        fileName: file.fileName,
        content: file.xml,
        contentHash: `hash-${file.fileName}`,
        byteSize: file.xml.length,
        importedAt: '2026-07-16T09:00:00Z',
      });
      if (outcome.ok) okCount += 1;
    }
    const durationMs = performance.now() - start;

    console.info(`[estate perf] parsed ${files.length} files in ${durationMs.toFixed(1)} ms`);

    expect(okCount).toBe(files.length);
    expect(durationMs).toBeLessThan(30_000);
  });
});

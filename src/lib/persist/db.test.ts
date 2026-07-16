import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeRelease } from '../graph/testData.ts';
import { clearAllData, getSetting, getStoredReleases, hasFile, openLatticeDb, putRelease, putSetting } from './db.ts';
import { SCHEMA_VERSION, type PersistedFileRecord } from './schema.ts';

describe('persist/db', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('put/get round-trip preserves a ParsedRelease deeply', async () => {
    const release = makeRelease({ releaseName: 'Round Trip' });
    await putRelease(release);

    const { releases, discardedStale } = await getStoredReleases();
    expect(discardedStale).toBe(0);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toEqual(release);
  });

  it('excludes a stale-schemaVersion record from getStoredReleases and physically deletes it', async () => {
    const release = makeRelease({ releaseName: 'Stale' });
    const db = await openLatticeDb();
    const staleRecord: PersistedFileRecord = {
      schemaVersion: SCHEMA_VERSION - 1,
      meta: release.file,
      release,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(staleRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('failed to seed stale record'));
    });
    db.close();

    const first = await getStoredReleases();
    expect(first.releases).toHaveLength(0);
    expect(first.discardedStale).toBe(1);

    // The stale record was deleted as part of the previous call.
    const second = await getStoredReleases();
    expect(second.releases).toHaveLength(0);
    expect(second.discardedStale).toBe(0);
  });

  it('hasFile reports true only once the file has been stored', async () => {
    const release = makeRelease();
    expect(await hasFile(release.file.contentHash)).toBe(false);
    await putRelease(release);
    expect(await hasFile(release.file.contentHash)).toBe(true);
  });

  it('clearAllData wipes everything, including settings', async () => {
    const release = makeRelease();
    await putRelease(release);
    await putSetting('theme', 'dark');

    await clearAllData();

    const { releases } = await getStoredReleases();
    expect(releases).toHaveLength(0);
    expect(await getSetting('theme')).toBeUndefined();
  });

  it('settings get/put round-trip, and a never-set key returns undefined', async () => {
    expect(await getSetting('never-set')).toBeUndefined();
    await putSetting('impact-max-depth', { maxDepth: 5, labels: ['a', 'b'] });
    expect(await getSetting('impact-max-depth')).toEqual({ maxDepth: 5, labels: ['a', 'b'] });
  });
});

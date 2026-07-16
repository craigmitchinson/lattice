/**
 * Hand-rolled promise wrapper over the native IndexedDB API. No external
 * IndexedDB dependency is used in the app itself (fake-indexeddb is a
 * dev-only test shim, see the *.test.ts files in this folder).
 *
 * This module is browser/IndexedDB-only by nature (unlike the rest of
 * src/lib/graph and src/lib/persist, which are pure) - that is expected.
 */

import type { ParsedRelease } from '../model/types.ts';
import { SCHEMA_VERSION, type PersistedFileRecord } from './schema.ts';

const DB_NAME = 'lattice';
const DB_VERSION = 1;
const FILES_STORE = 'files';
const SETTINGS_STORE = 'settings';

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in this environment');
  }
  return indexedDB;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Opens (and if necessary creates) the lattice database and its object stores. */
export function openLatticeDb(): Promise<IDBDatabase> {
  const idb = requireIndexedDb();
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: 'meta.contentHash' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open the lattice database'));
  });
}

/** Persists a parsed release, keyed by its file's content hash. */
export async function putRelease(release: ParsedRelease): Promise<void> {
  const db = await openLatticeDb();
  try {
    const record: PersistedFileRecord = {
      schemaVersion: SCHEMA_VERSION,
      meta: release.file,
      release,
    };
    const tx = db.transaction(FILES_STORE, 'readwrite');
    tx.objectStore(FILES_STORE).put(record);
    await promisifyTransaction(tx);
  } finally {
    db.close();
  }
}

/**
 * Reads all stored releases. Records stamped with an old schema version are
 * excluded from the result, counted, and deleted from the store so stale
 * data never lingers.
 */
export async function getStoredReleases(): Promise<{ releases: ParsedRelease[]; discardedStale: number }> {
  const db = await openLatticeDb();
  try {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const store = tx.objectStore(FILES_STORE);
    const all = await promisifyRequest<PersistedFileRecord[]>(store.getAll());

    const releases: ParsedRelease[] = [];
    let discardedStale = 0;
    for (const record of all) {
      if (record.schemaVersion !== SCHEMA_VERSION) {
        discardedStale++;
        store.delete(record.meta.contentHash);
      } else {
        releases.push(record.release);
      }
    }

    await promisifyTransaction(tx);
    return { releases, discardedStale };
  } finally {
    db.close();
  }
}

/** True when a file with the given content hash is already stored. */
export async function hasFile(contentHash: string): Promise<boolean> {
  const db = await openLatticeDb();
  try {
    const tx = db.transaction(FILES_STORE, 'readonly');
    const key = await promisifyRequest(tx.objectStore(FILES_STORE).getKey(contentHash));
    return key !== undefined;
  } finally {
    db.close();
  }
}

/** Deletes the entire lattice database (not merely its store contents). */
export function clearAllData(): Promise<void> {
  const idb = requireIndexedDb();
  return new Promise((resolve, reject) => {
    const request = idb.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to delete the lattice database'));
  });
}

export async function getSetting(key: string): Promise<unknown | undefined> {
  const db = await openLatticeDb();
  try {
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    return await promisifyRequest<unknown>(tx.objectStore(SETTINGS_STORE).get(key));
  } finally {
    db.close();
  }
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  const db = await openLatticeDb();
  try {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).put(value, key);
    await promisifyTransaction(tx);
  } finally {
    db.close();
  }
}

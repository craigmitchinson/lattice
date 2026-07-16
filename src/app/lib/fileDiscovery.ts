/**
 * Browser-only helpers that turn the various file-selection sources (drag
 * and drop, the native file picker, the native directory picker, and the
 * <input type="file"> fallbacks) into a flat list of IngestFile records the
 * store can consume. None of this is unit tested: it depends on real
 * browser File / FileSystem APIs that jsdom does not provide.
 */

import type { IngestFile } from '../store.ts';
import {
  getEntryFromDataTransferItem,
  showDirectoryPicker,
  showOpenFilePicker,
  supportsDirectoryPicker,
  supportsFilePicker,
  type FileSystemDirectoryEntryLike,
  type FileSystemDirectoryHandleLike,
  type FileSystemEntryLike,
  type FileSystemFileEntryLike,
} from './fileSystemTypes.ts';

/** True when the error is the DOMException a cancelled native picker throws. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

const BPRELEASE_EXTENSION = /\.bprelease$/i;

function isBpRelease(name: string): boolean {
  return BPRELEASE_EXTENSION.test(name);
}

async function toIngestFile(file: File): Promise<IngestFile> {
  const buffer = await file.arrayBuffer();
  return { name: file.name, buffer };
}

/** Reads a FileList (from an <input type="file"> change event) into IngestFiles, filtering to .bprelease. */
export async function filesFromFileList(list: FileList): Promise<IngestFile[]> {
  const files: File[] = [];
  for (let i = 0; i < list.length; i++) {
    const file = list.item(i);
    if (file && isBpRelease(file.name)) files.push(file);
  }
  return Promise.all(files.map(toIngestFile));
}

function readFileEntry(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function collectFromEntry(entry: FileSystemEntryLike, out: File[]): Promise<void> {
  if (entry.isFile) {
    if (isBpRelease(entry.name)) {
      const file = await readFileEntry(entry as FileSystemFileEntryLike);
      out.push(file);
    }
    return;
  }
  if (entry.isDirectory) {
    // Pagination state lives on the reader instance, so one reader must be
    // reused across the whole polling loop; readEntries() on a fresh reader
    // restarts from the beginning of the directory and never drains.
    const reader = (entry as FileSystemDirectoryEntryLike).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (batch.length === 0) break;
      for (const child of batch) {
        await collectFromEntry(child, out);
      }
    }
  }
}

/** Recursively walks the entries dropped onto the drop zone, falling back to the flat FileList when the entry API is unavailable. */
export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<IngestFile[]> {
  const files: File[] = [];
  let usedEntryApi = false;

  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = getEntryFromDataTransferItem(item);
    if (entry) {
      usedEntryApi = true;
      await collectFromEntry(entry, files);
    }
  }

  if (!usedEntryApi) {
    return filesFromFileList(dataTransfer.files);
  }

  return Promise.all(files.map(toIngestFile));
}

/** Opens the native multi-file picker restricted to .bprelease files. Resolves to [] if the user cancels. */
export async function filesFromFilePicker(): Promise<IngestFile[]> {
  if (!supportsFilePicker()) return [];

  try {
    const handles = await showOpenFilePicker({
      multiple: true,
      types: [{ description: 'Blue Prism release', accept: { 'application/xml': ['.bprelease'] } }],
    });
    const files = await Promise.all(handles.map((handle) => handle.getFile()));
    return Promise.all(files.filter((file) => isBpRelease(file.name)).map(toIngestFile));
  } catch (error) {
    // Cancelling the picker is normal and silent; anything else is a real
    // failure that must not masquerade as "no files were chosen".
    if (!isAbortError(error)) console.error('File picker failed:', error);
    return [];
  }
}

async function collectFromDirectoryHandle(handle: FileSystemDirectoryHandleLike, out: File[]): Promise<void> {
  for await (const child of handle.values()) {
    if (child.kind === 'file') {
      if (isBpRelease(child.name)) out.push(await child.getFile());
    } else {
      await collectFromDirectoryHandle(child, out);
    }
  }
}

/** Opens the native directory picker and recursively collects .bprelease files. Resolves to [] if the user cancels. */
export async function filesFromDirectoryPicker(): Promise<IngestFile[]> {
  if (!supportsDirectoryPicker()) return [];

  try {
    const root = await showDirectoryPicker();
    const files: File[] = [];
    await collectFromDirectoryHandle(root, files);
    return Promise.all(files.map(toIngestFile));
  } catch (error) {
    if (!isAbortError(error)) console.error('Directory picker failed:', error);
    return [];
  }
}

/**
 * Minimal local type declarations for browser file-access APIs the standard
 * TypeScript DOM lib does not (fully) cover: the File System Access API
 * (showOpenFilePicker / showDirectoryPicker) and the nonstandard but widely
 * supported drag-and-drop entry API (DataTransferItem.webkitGetAsEntry).
 * Only the members Lattice actually uses are declared; everything is
 * feature-detected at runtime, so browsers without these APIs simply fall
 * back to <input type="file">.
 */

export interface FileSystemFileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

export interface FileSystemDirectoryHandleLike {
  kind: 'directory';
  name: string;
  values(): AsyncIterableIterator<FileSystemFileHandleLike | FileSystemDirectoryHandleLike>;
}

export interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

interface FileSystemAccessWindow {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandleLike[]>;
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
}

function fileSystemAccessWindow(): FileSystemAccessWindow {
  return window as unknown as FileSystemAccessWindow;
}

export function supportsFilePicker(): boolean {
  return typeof fileSystemAccessWindow().showOpenFilePicker === 'function';
}

export function supportsDirectoryPicker(): boolean {
  return typeof fileSystemAccessWindow().showDirectoryPicker === 'function';
}

/** Opens the native multi-file picker. Only call after supportsFilePicker() is true. */
export async function showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandleLike[]> {
  const picker = fileSystemAccessWindow().showOpenFilePicker;
  if (!picker) throw new Error('showOpenFilePicker is not available in this browser');
  return picker(options);
}

/** Opens the native directory picker. Only call after supportsDirectoryPicker() is true. */
export async function showDirectoryPicker(): Promise<FileSystemDirectoryHandleLike> {
  const picker = fileSystemAccessWindow().showDirectoryPicker;
  if (!picker) throw new Error('showDirectoryPicker is not available in this browser');
  return picker();
}

/** Nonstandard drag-and-drop entry API (webkitGetAsEntry), supported by all evergreen browsers. */
export interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

export interface FileSystemFileEntryLike extends FileSystemEntryLike {
  isFile: true;
  file(callback: (file: File) => void, errback?: (err: DOMException) => void): void;
}

export interface FileSystemDirectoryReaderLike {
  readEntries(callback: (entries: FileSystemEntryLike[]) => void, errback?: (err: DOMException) => void): void;
}

export interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  isDirectory: true;
  createReader(): FileSystemDirectoryReaderLike;
}

/** Reads the dropped entry (file or directory) off a DataTransferItem, if the browser supports it. */
export function getEntryFromDataTransferItem(item: DataTransferItem): FileSystemEntryLike | null {
  const withEntry = item as unknown as { webkitGetAsEntry?: () => FileSystemEntryLike | null };
  return typeof withEntry.webkitGetAsEntry === 'function' ? withEntry.webkitGetAsEntry() : null;
}

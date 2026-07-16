import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { useLatticeStore } from '../store.ts';
import {
  filesFromDataTransfer,
  filesFromDirectoryPicker,
  filesFromFileList,
  filesFromFilePicker,
} from '../lib/fileDiscovery.ts';
import { supportsDirectoryPicker, supportsFilePicker } from '../lib/fileSystemTypes.ts';
import type { FileStatus } from '../lib/fileEntry.ts';
import type { ItemCounts } from '../lib/itemCounts.ts';
import { deriveBatchSummary } from '../lib/batchSummary.ts';
import type { IngestFile } from '../store.ts';

const STATUS_LABELS: Record<FileStatus, string> = {
  queued: 'queued',
  parsing: 'parsing',
  done: 'done',
  failed: 'failed',
  duplicate: 'already imported',
};

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatItemCounts(counts: ItemCounts): string {
  const parts: string[] = [];
  if (counts.processes > 0) parts.push(pluralize(counts.processes, 'process', 'processes'));
  if (counts.objects > 0) parts.push(pluralize(counts.objects, 'object', 'objects'));
  if (counts.workQueues > 0) parts.push(pluralize(counts.workQueues, 'queue', 'queues'));
  if (counts.environmentVariables > 0) {
    parts.push(pluralize(counts.environmentVariables, 'environment variable', 'environment variables'));
  }
  if (counts.credentials > 0) parts.push(pluralize(counts.credentials, 'credential', 'credentials'));
  if (counts.otherItems > 0) parts.push(pluralize(counts.otherItems, 'other item', 'other items'));
  return parts.length > 0 ? parts.join(', ') : 'no items';
}

export function ImportView() {
  const fileEntries = useLatticeStore((s) => s.fileEntries);
  const graph = useLatticeStore((s) => s.graph);
  const ingestFiles = useLatticeStore((s) => s.ingestFiles);

  const [dragActive, setDragActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // webkitdirectory is nonstandard and not part of React's typed input
    // attributes, so it has to be set imperatively on the underlying node.
    folderInputRef.current?.setAttribute('webkitdirectory', 'true');
  }, []);

  const summary = useMemo(() => deriveBatchSummary(fileEntries, graph), [fileEntries, graph]);

  function applyFiles(files: IngestFile[]): void {
    if (files.length === 0) {
      setNotice('No .bprelease files found');
      return;
    }
    setNotice(null);
    ingestFiles(files);
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(true);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(false);
  }

  async function onDrop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    setDragActive(false);
    try {
      const files = await filesFromDataTransfer(event.dataTransfer);
      applyFiles(files);
    } catch (error) {
      // Reading a dropped entry can fail (for example a permission error on
      // a file); surface it rather than leaving an unhandled rejection.
      console.error('Reading dropped items failed:', error);
      setNotice('Some dropped items could not be read. Try the file picker instead.');
    }
  }

  async function handleChooseFiles(): Promise<void> {
    if (supportsFilePicker()) {
      const files = await filesFromFilePicker();
      applyFiles(files);
    } else {
      fileInputRef.current?.click();
    }
  }

  async function handleChooseFolder(): Promise<void> {
    if (supportsDirectoryPicker()) {
      const files = await filesFromDirectoryPicker();
      applyFiles(files);
    } else {
      folderInputRef.current?.click();
    }
  }

  async function onFileInputChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const list = event.target.files;
    event.target.value = '';
    if (!list) return;
    applyFiles(await filesFromFileList(list));
  }

  async function onFolderInputChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const list = event.target.files;
    event.target.value = '';
    if (!list) return;
    applyFiles(await filesFromFileList(list));
  }

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Import</h1>
        <span className="view-subtitle">Blue Prism release files</span>
      </div>

      <div
        className={`drop-zone${dragActive ? ' drop-zone-active' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={(event) => void onDrop(event)}
      >
        <p className="drop-zone-title">Drop .bprelease files or a folder here</p>
        <p className="view-note">
          Individual .bprelease files and whole folders are both accepted. Folders are searched recursively; any
          file that is not a .bprelease export is skipped.
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => void handleChooseFiles()}>
            Choose files
          </button>
          <button type="button" className="btn" onClick={() => void handleChooseFolder()}>
            Choose folder
          </button>
        </div>
        {notice && <p className="view-note">{notice}</p>}
      </div>

      <p className="privacy-note">Files are parsed locally in your browser. Nothing leaves this machine.</p>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".bprelease"
        style={{ display: 'none' }}
        onChange={(event) => void onFileInputChange(event)}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => void onFolderInputChange(event)}
      />

      {fileEntries.length === 0 ? (
        <p className="empty-state">No files imported yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {fileEntries.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{entry.fileName}</td>
                  <td>
                    <span className={`chip chip-${entry.status}`}>{STATUS_LABELS[entry.status]}</span>
                  </td>
                  <td className="mono">
                    {entry.status === 'failed' && entry.error}
                    {(entry.status === 'done' || entry.status === 'duplicate') &&
                      entry.itemCounts &&
                      formatItemCounts(entry.itemCounts)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fileEntries.length > 0 && (
        <div className="panel">
          <p className="panel-title">Batch summary</p>
          <div className="stat-grid">
            <div className="stat-tile">
              <span className="stat-value">{summary.done}</span>
              <span className="stat-label">files done</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{summary.failed}</span>
              <span className="stat-label">files failed</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{summary.duplicate}</span>
              <span className="stat-label">files already imported</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{summary.distinctBpVersions.length}</span>
              <span className="stat-label">bpversions seen</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">
                <span className="mono">{formatItemCounts(summary.itemsByType)}</span>
              </span>
              <span className="stat-label">items found</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{summary.duplicateConflicts}</span>
              <span className="stat-label">items in more than one file</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{summary.externalOrMissingCount}</span>
              <span className="stat-label">external or missing references</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{summary.dynamicCount}</span>
              <span className="stat-label">dynamic references</span>
            </div>
          </div>
          {summary.distinctBpVersions.length > 0 && (
            <p className="view-note mono">{summary.distinctBpVersions.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}

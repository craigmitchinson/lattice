/**
 * A small round-robin pool over parse.worker.ts instances. Kept independent
 * of any particular Worker construction so the queue/dispatch logic can be
 * unit tested in Node with a stub factory (see pool.test.ts); the browser
 * default factory lives in defaultWorkerFactory below and is only exercised
 * at runtime, never in tests.
 */

import type { ParseWorkerRequest, ParseWorkerResponse } from '../../workers/parse.worker.ts';

export type { ParseWorkerRequest, ParseWorkerResponse } from '../../workers/parse.worker.ts';

/**
 * The subset of the DOM Worker interface the pool relies on. Lets tests
 * supply an in-memory stub instead of a real Worker/MessagePort.
 */
export interface PoolWorkerLike {
  postMessage(message: ParseWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ParseWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type WorkerFactory = () => PoolWorkerLike;

export interface ParseTask {
  id: string;
  fileName: string;
  buffer: ArrayBuffer;
}

export interface ParseTaskCallbacks {
  /** Called the moment a worker starts on this task (queue -> in progress). */
  onStart?: () => void;
  onResult: (response: ParseWorkerResponse) => void;
}

/** Real worker factory. Only ever invoked in the browser; never used by tests. */
export function defaultWorkerFactory(): PoolWorkerLike {
  return new Worker(new URL('../../workers/parse.worker.ts', import.meta.url), { type: 'module' });
}

function defaultPoolSize(): number {
  const cores = typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
    ? navigator.hardwareConcurrency
    : 4;
  return Math.min(4, Math.max(1, cores - 1));
}

interface QueuedTask {
  task: ParseTask;
  callbacks: ParseTaskCallbacks;
}

interface WorkerSlot {
  worker: PoolWorkerLike;
  busy: boolean;
  /** The task and callbacks this slot is currently running, if any. */
  current: QueuedTask | null;
}

/**
 * Round-robin pool of parse workers. Callers enqueue files; each dispatched
 * task gets its own callbacks so results route back to the right caller
 * regardless of completion order.
 */
export class WorkerPool {
  private readonly slots: WorkerSlot[];
  private readonly queue: QueuedTask[] = [];
  private disposed = false;

  constructor(options: { size?: number; workerFactory?: WorkerFactory } = {}) {
    const size = options.size ?? defaultPoolSize();
    const factory = options.workerFactory ?? defaultWorkerFactory;

    this.slots = Array.from({ length: size }, () => {
      const worker = factory();
      const slot: WorkerSlot = { worker, busy: false, current: null };
      worker.onmessage = (event) => {
        this.handleResult(slot, event.data);
      };
      worker.onerror = (event) => {
        this.handleWorkerError(slot, event);
      };
      return slot;
    });
  }

  /** Queues a file for parsing. Dispatches immediately if a worker is free. */
  enqueue(task: ParseTask, callbacks: ParseTaskCallbacks): void {
    if (this.disposed) {
      throw new Error('WorkerPool: cannot enqueue after dispose()');
    }
    this.queue.push({ task, callbacks });
    this.pump();
  }

  /** Terminates every worker and drops any queued-but-undispatched tasks. */
  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    for (const slot of this.slots) {
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.terminate();
    }
  }

  private pump(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (this.queue.length === 0) return;
      if (slot.busy) continue;

      const next = this.queue.shift();
      if (!next) return;

      slot.busy = true;
      slot.current = next;
      next.callbacks.onStart?.();

      const transfer = next.task.buffer.byteLength > 0 ? [next.task.buffer] : undefined;
      const request: ParseWorkerRequest = { id: next.task.id, fileName: next.task.fileName, buffer: next.task.buffer };
      slot.worker.postMessage(request, transfer);
    }
  }

  private handleResult(slot: WorkerSlot, response: ParseWorkerResponse): void {
    const current = slot.current;
    slot.busy = false;
    slot.current = null;
    current?.callbacks.onResult(response);
    this.pump();
  }

  private handleWorkerError(slot: WorkerSlot, event: ErrorEvent): void {
    const current = slot.current;
    slot.busy = false;
    slot.current = null;
    if (current) {
      const message = event.message || 'worker crashed while parsing this file';
      current.callbacks.onResult({
        id: current.task.id,
        fileName: current.task.fileName,
        contentHash: null,
        byteSize: current.task.buffer.byteLength,
        outcome: { ok: false, failure: { fileName: current.task.fileName, contentHash: null, reason: message } },
      });
    }
    this.pump();
  }
}

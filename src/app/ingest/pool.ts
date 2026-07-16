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
  /** Watchdog for the current task; a worker that never responds must not stall the batch. */
  timer: ReturnType<typeof setTimeout> | null;
}

/** How long a single file may parse before its worker is declared hung and restarted. */
const DEFAULT_TASK_TIMEOUT_MS = 60_000;

/**
 * Round-robin pool of parse workers. Callers enqueue files; each dispatched
 * task gets its own callbacks so results route back to the right caller
 * regardless of completion order. A worker that errors or stops responding
 * fails only its current task and is replaced; the batch always completes.
 */
export class WorkerPool {
  private readonly slots: WorkerSlot[];
  private readonly queue: QueuedTask[] = [];
  private readonly factory: WorkerFactory;
  private readonly taskTimeoutMs: number;
  private disposed = false;

  constructor(options: { size?: number; workerFactory?: WorkerFactory; taskTimeoutMs?: number } = {}) {
    const size = options.size ?? defaultPoolSize();
    this.factory = options.workerFactory ?? defaultWorkerFactory;
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;

    this.slots = Array.from({ length: size }, () => {
      const slot: WorkerSlot = { worker: this.factory(), busy: false, current: null, timer: null };
      this.wireWorker(slot);
      return slot;
    });
  }

  private wireWorker(slot: WorkerSlot): void {
    slot.worker.onmessage = (event) => {
      this.handleResult(slot, event.data);
    };
    slot.worker.onerror = (event) => {
      this.handleWorkerError(slot, event);
    };
  }

  /** Detaches and terminates the slot's worker and puts a fresh one in its place. */
  private replaceWorker(slot: WorkerSlot): void {
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.terminate();
    slot.worker = this.factory();
    this.wireWorker(slot);
  }

  private clearTimer(slot: WorkerSlot): void {
    if (slot.timer !== null) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }
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
      this.clearTimer(slot);
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
      slot.timer = setTimeout(() => this.handleTimeout(slot), this.taskTimeoutMs);
    }
  }

  /** Fails the slot's current task with the given reason and frees the slot. */
  private failCurrent(slot: WorkerSlot, reason: string): void {
    const current = slot.current;
    slot.busy = false;
    slot.current = null;
    if (current) {
      current.callbacks.onResult({
        id: current.task.id,
        fileName: current.task.fileName,
        contentHash: null,
        byteSize: current.task.buffer.byteLength,
        outcome: { ok: false, failure: { fileName: current.task.fileName, contentHash: null, reason } },
      });
    }
  }

  private handleResult(slot: WorkerSlot, response: ParseWorkerResponse): void {
    this.clearTimer(slot);
    const current = slot.current;
    slot.busy = false;
    slot.current = null;
    current?.callbacks.onResult(response);
    this.pump();
  }

  private handleWorkerError(slot: WorkerSlot, event: ErrorEvent): void {
    this.clearTimer(slot);
    // The worker may be unusable after an error (for example a failed module
    // load), so replace it; keeping it would silently swallow later tasks.
    this.replaceWorker(slot);
    this.failCurrent(slot, event.message || 'worker crashed while parsing this file');
    this.pump();
  }

  private handleTimeout(slot: WorkerSlot): void {
    if (this.disposed) return;
    slot.timer = null;
    this.replaceWorker(slot);
    this.failCurrent(slot, `worker did not respond within ${Math.round(this.taskTimeoutMs / 1000)} seconds and was restarted`);
    this.pump();
  }
}

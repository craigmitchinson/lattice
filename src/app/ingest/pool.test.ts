import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerPool, type ParseWorkerResponse, type PoolWorkerLike } from './pool.ts';

/** In-memory stand-in for a DOM Worker, driven manually from tests. */
class StubWorker implements PoolWorkerLike {
  postMessages: unknown[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<ParseWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: unknown): void {
    this.postMessages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Test helper: simulates the worker completing its current task. */
  respond(response: ParseWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<ParseWorkerResponse>);
  }

  /** Test helper: simulates the worker itself crashing. */
  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function successResponse(id: string): ParseWorkerResponse {
  return {
    id,
    fileName: `${id}.bprelease`,
    contentHash: `hash-${id}`,
    byteSize: 10,
    outcome: {
      ok: true,
      release: {
        file: { fileName: `${id}.bprelease`, contentHash: `hash-${id}`, byteSize: 10, importedAt: '2024-01-01T00:00:00Z' },
        releaseName: null,
        packageName: null,
        created: null,
        processes: [],
        objects: [],
        workQueues: [],
        environmentVariables: [],
        credentials: [],
        otherItems: [],
        warnings: [],
      },
    },
    discovery: { paths: {} },
  };
}

function makeStubPool(size: number): { pool: WorkerPool; workers: StubWorker[] } {
  const workers: StubWorker[] = [];
  const pool = new WorkerPool({
    size,
    workerFactory: () => {
      const worker = new StubWorker();
      workers.push(worker);
      return worker;
    },
  });
  return { pool, workers };
}

describe('WorkerPool', () => {
  it('dispatches immediately up to pool size and queues the rest', () => {
    const { pool, workers } = makeStubPool(2);
    const started: string[] = [];

    pool.enqueue({ id: 'a', fileName: 'a.bprelease', buffer: new ArrayBuffer(0) }, { onStart: () => started.push('a'), onResult: () => {} });
    pool.enqueue({ id: 'b', fileName: 'b.bprelease', buffer: new ArrayBuffer(0) }, { onStart: () => started.push('b'), onResult: () => {} });
    pool.enqueue({ id: 'c', fileName: 'c.bprelease', buffer: new ArrayBuffer(0) }, { onStart: () => started.push('c'), onResult: () => {} });

    expect(started).toEqual(['a', 'b']);
    expect(workers[0]?.postMessages).toHaveLength(1);
    expect(workers[1]?.postMessages).toHaveLength(1);
  });

  it('dispatches a queued task to a worker as soon as it frees up', () => {
    const { pool, workers } = makeStubPool(1);
    const started: string[] = [];
    const results: string[] = [];

    pool.enqueue(
      { id: 'a', fileName: 'a.bprelease', buffer: new ArrayBuffer(0) },
      { onStart: () => started.push('a'), onResult: (r) => results.push(r.id) },
    );
    pool.enqueue(
      { id: 'b', fileName: 'b.bprelease', buffer: new ArrayBuffer(0) },
      { onStart: () => started.push('b'), onResult: (r) => results.push(r.id) },
    );

    expect(started).toEqual(['a']);

    workers[0]?.respond(successResponse('a'));

    expect(started).toEqual(['a', 'b']);
    expect(results).toEqual(['a']);

    workers[0]?.respond(successResponse('b'));
    expect(results).toEqual(['a', 'b']);
  });

  it('routes results back to the callback for the correct task regardless of completion order', () => {
    const { pool, workers } = makeStubPool(2);
    const results: string[] = [];

    pool.enqueue({ id: 'a', fileName: 'a.bprelease', buffer: new ArrayBuffer(0) }, { onResult: (r) => results.push(r.id) });
    pool.enqueue({ id: 'b', fileName: 'b.bprelease', buffer: new ArrayBuffer(0) }, { onResult: (r) => results.push(r.id) });

    // Second-dispatched worker responds first.
    workers[1]?.respond(successResponse('b'));
    workers[0]?.respond(successResponse('a'));

    expect(results).toEqual(['b', 'a']);
  });

  it('reports a failure outcome when a worker crashes mid-task', () => {
    const { pool, workers } = makeStubPool(1);
    const received: ParseWorkerResponse[] = [];

    pool.enqueue({ id: 'a', fileName: 'a.bprelease', buffer: new ArrayBuffer(0) }, { onResult: (r) => received.push(r) });
    workers[0]?.crash('boom');

    expect(received).toHaveLength(1);
    const response = received[0]!;
    expect(response.outcome.ok).toBe(false);
    expect(response.id).toBe('a');
    if (!response.outcome.ok) {
      expect(response.outcome.failure.reason).toBe('boom');
    }
  });

  it('frees the slot after a crash so the next queued task still runs', () => {
    const { pool, workers } = makeStubPool(1);
    const started: string[] = [];

    pool.enqueue({ id: 'a', fileName: 'a.bprelease', buffer: new ArrayBuffer(0) }, { onStart: () => started.push('a'), onResult: () => {} });
    pool.enqueue({ id: 'b', fileName: 'b.bprelease', buffer: new ArrayBuffer(0) }, { onStart: () => started.push('b'), onResult: () => {} });

    workers[0]?.crash('boom');

    expect(started).toEqual(['a', 'b']);
  });

  it('dispose terminates every worker and rejects further enqueues', () => {
    const { pool, workers } = makeStubPool(2);
    pool.dispose();

    expect(workers.every((w) => w.terminated)).toBe(true);
    expect(() => pool.enqueue({ id: 'x', fileName: 'x.bprelease', buffer: new ArrayBuffer(0) }, { onResult: () => {} })).toThrow();
  });

  it('replaces a crashed worker so later tasks are not sent to a dead one', () => {
    const { pool, workers } = makeStubPool(1);

    pool.enqueue({ id: 'a', fileName: 'a.bprelease', buffer: new ArrayBuffer(0) }, { onResult: () => {} });
    workers[0]?.crash('boom');

    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);

    pool.enqueue({ id: 'b', fileName: 'b.bprelease', buffer: new ArrayBuffer(0) }, { onResult: () => {} });
    expect(workers[1]?.postMessages).toHaveLength(1);
  });

  describe('watchdog', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('fails the task and restarts the worker when it never responds, so the batch completes', () => {
      vi.useFakeTimers();
      const workers: StubWorker[] = [];
      const pool = new WorkerPool({
        size: 1,
        taskTimeoutMs: 100,
        workerFactory: () => {
          const worker = new StubWorker();
          workers.push(worker);
          return worker;
        },
      });

      const received: ParseWorkerResponse[] = [];
      const started: string[] = [];
      pool.enqueue(
        { id: 'a', fileName: 'a.bprelease', buffer: new ArrayBuffer(0) },
        { onResult: (r) => received.push(r) },
      );
      pool.enqueue(
        { id: 'b', fileName: 'b.bprelease', buffer: new ArrayBuffer(0) },
        { onStart: () => started.push('b'), onResult: (r) => received.push(r) },
      );

      vi.advanceTimersByTime(150);

      expect(received).toHaveLength(1);
      const response = received[0]!;
      expect(response.id).toBe('a');
      expect(response.outcome.ok).toBe(false);
      if (!response.outcome.ok) {
        expect(response.outcome.failure.reason).toContain('did not respond');
      }

      // The queued task moved on to the replacement worker.
      expect(started).toEqual(['b']);
      expect(workers).toHaveLength(2);
      expect(workers[1]?.postMessages).toHaveLength(1);

      workers[1]?.respond(successResponse('b'));
      expect(received).toHaveLength(2);
    });

    it('does not fire after a task completes in time', () => {
      vi.useFakeTimers();
      const { pool, workers } = makeStubPool(1);
      const received: ParseWorkerResponse[] = [];

      pool.enqueue({ id: 'a', fileName: 'a.bprelease', buffer: new ArrayBuffer(0) }, { onResult: (r) => received.push(r) });
      workers[0]?.respond(successResponse('a'));

      vi.advanceTimersByTime(120_000);

      expect(received).toHaveLength(1);
      expect(received[0]?.outcome.ok).toBe(true);
      expect(workers).toHaveLength(1);
    });
  });
});

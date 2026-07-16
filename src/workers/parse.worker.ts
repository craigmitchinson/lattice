/**
 * Parse worker: runs entirely off the UI thread. Receives one file per
 * message, computes its SHA-256 content hash, decodes it as UTF-8, then
 * runs the tolerant parser and schema discovery over the text. Every code
 * path (including unexpected exceptions) posts back a structured result;
 * the worker never throws in a way that would surface as an uncaught
 * worker error, so a single bad file never kills the pool slot.
 */

import { parseRelease } from '../lib/parser/parseRelease.ts';
import { discoverSchema } from '../lib/discovery/discover.ts';
import type { ParseFailure } from '../lib/model/types.ts';
import type { SchemaDiscoveryReport } from '../lib/discovery/discover.ts';
import type { ParseOutcome } from '../lib/parser/parseRelease.ts';

/** Message received from the pool: one file's raw bytes, transferred. */
export interface ParseWorkerRequest {
  id: string;
  fileName: string;
  buffer: ArrayBuffer;
}

/** Message posted back to the pool for a successfully parsed file. */
export interface ParseWorkerSuccess {
  id: string;
  fileName: string;
  contentHash: string;
  byteSize: number;
  outcome: { ok: true; release: import('../lib/model/types.ts').ParsedRelease };
  discovery: SchemaDiscoveryReport;
}

/** Message posted back to the pool for a file that failed to parse or crashed. */
export interface ParseWorkerFailure {
  id: string;
  fileName: string;
  contentHash: string | null;
  byteSize: number;
  outcome: { ok: false; failure: ParseFailure };
}

export type ParseWorkerResponse = ParseWorkerSuccess | ParseWorkerFailure;

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function handleMessage(request: ParseWorkerRequest): Promise<ParseWorkerResponse> {
  const { id, fileName, buffer } = request;
  const byteSize = buffer.byteLength;
  let contentHash: string | null = null;

  try {
    contentHash = await sha256Hex(buffer);
    const content = new TextDecoder('utf-8').decode(buffer);
    const importedAt = new Date().toISOString();

    const outcome: ParseOutcome = parseRelease({ fileName, content, contentHash, byteSize, importedAt });

    if (outcome.ok) {
      const discovery = discoverSchema(content);
      return { id, fileName, contentHash, byteSize, outcome, discovery };
    }
    return { id, fileName, contentHash, byteSize, outcome };
  } catch (err) {
    const failure: ParseFailure = {
      fileName,
      contentHash,
      reason: err instanceof Error ? err.message : 'unexpected worker error while parsing this file',
    };
    return { id, fileName, contentHash, byteSize, outcome: { ok: false, failure } };
  }
}

onmessage = (event: MessageEvent<ParseWorkerRequest>) => {
  handleMessage(event.data)
    .then((response) => {
      postMessage(response);
    })
    .catch((err: unknown) => {
      // handleMessage itself is wrapped in try/catch and should never reject,
      // but guard the message handler itself so a truly unforeseen failure
      // still reports rather than silently dropping the file.
      const { id, fileName, buffer } = event.data;
      const failure: ParseFailure = {
        fileName,
        contentHash: null,
        reason: err instanceof Error ? err.message : 'unexpected worker error',
      };
      postMessage({ id, fileName, contentHash: null, byteSize: buffer.byteLength, outcome: { ok: false, failure } });
    });
};

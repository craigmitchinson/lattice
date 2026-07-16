/**
 * Pure reference-extraction helpers used by the graph builder. These
 * functions look only at a single stage's payload (or a fragment of it)
 * and describe *what* is being referenced, without knowing anything about
 * the rest of the estate. Resolution against known definitions (deciding
 * `resolved` vs `external`) happens in build.ts, which has the whole-estate
 * view.
 *
 * No DOM, no React, no Node-only APIs - this module must run in a Web
 * Worker as well as in Vitest.
 */

import type { ActionParameter } from '../model/types.ts';

/** True when a Blue Prism name/expression is not a plain literal name. */
export function isDynamicName(name: string): boolean {
  return name.trim().length === 0 || name.includes('[');
}

/** Extracted reference from an Action stage's target (object.action). */
export interface ActionStageRef {
  /** Raw object name exactly as exported. */
  objectName: string;
  /** Raw action name exactly as exported. */
  actionName: string;
  /** True when either half is empty or contains data item interpolation. */
  dynamic: boolean;
}

export function extractActionRef(objectName: string, actionName: string): ActionStageRef {
  return {
    objectName,
    actionName,
    dynamic: isDynamicName(objectName) || isDynamicName(actionName),
  };
}

/** Extracted reference from a SubSheetRef stage's cross-process call. */
export interface ProcessCallRef {
  /** Raw process name exactly as exported. */
  processName: string;
  dynamic: boolean;
}

/**
 * Returns null when this is an internal-only page call (no processName),
 * i.e. not a cross-process reference at all.
 */
export function extractProcessCallRef(processName: string | null): ProcessCallRef | null {
  if (processName === null) return null;
  return { processName, dynamic: isDynamicName(processName) };
}

const QUEUE_OBJECT_NAMES = new Set(['work queues', 'internal - work queues']);
const CREDENTIAL_OBJECT_NAMES = new Set(['credentials', 'internal - credentials']);

/** True when an Action stage's target object is the built-in work queues object. */
export function isQueueActionTarget(objectName: string): boolean {
  return QUEUE_OBJECT_NAMES.has(objectName.trim().toLowerCase());
}

/** True when an Action stage's target object is the built-in credentials object. */
export function isCredentialActionTarget(objectName: string): boolean {
  return CREDENTIAL_OBJECT_NAMES.has(objectName.trim().toLowerCase());
}

/**
 * A double-quoted string literal with no interpolation or concatenation:
 * the whole expression is exactly `"..."` with no embedded quotes. Anything
 * else (data item reference, concatenation, missing quotes, null) is
 * treated as dynamic - this is a deliberately strict, easy-to-reason-about
 * reading of "string literal" per docs/data-model.md.
 */
const STRING_LITERAL_RE = /^"[^"]*"$/;

export function isQuotedStringLiteral(expression: string): boolean {
  return STRING_LITERAL_RE.test(expression);
}

export function unquoteStringLiteral(expression: string): string {
  return expression.slice(1, -1);
}

/** Resolution of a named input parameter used for queue/credential names. */
export interface NamedInputRef {
  /** False when the expression is a plain quoted string literal. */
  dynamic: boolean;
  /** Present only when not dynamic. */
  literalValue?: string;
  /** Raw expression as exported, null when the input was absent or had no expression. */
  raw: string | null;
}

/** Finds an input parameter by name (case-insensitive) and classifies its expression. */
export function extractNamedInputRef(inputs: ActionParameter[], inputName: string): NamedInputRef {
  const target = inputName.toLowerCase();
  const param = inputs.find((p) => p.name.toLowerCase() === target);
  const raw = param?.expression ?? null;
  if (raw !== null && isQuotedStringLiteral(raw)) {
    return { dynamic: false, literalValue: unquoteStringLiteral(raw), raw };
  }
  return { dynamic: true, raw };
}

/** True when a Data/Collection stage's exposure marks it as an environment variable. */
export function isEnvironmentExposure(exposure: string): boolean {
  return exposure.trim().toLowerCase() === 'environment';
}

/** Numeric-aware, dot-segment version comparison ("2.10" > "2.9"). Returns <0, 0, >0. */
export function compareVersionStrings(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const an = Number(as[i] ?? '0');
    const bn = Number(bs[i] ?? '0');
    const av = Number.isNaN(an) ? 0 : an;
    const bv = Number.isNaN(bn) ? 0 : bn;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Best-effort created-date comparison: parses as a real date when possible,
 * falls back to plain string comparison, and is a tie (0) when either side
 * is missing (the caller then falls back further to file order).
 */
export function compareCreatedDates(a: string | null, b: string | null): number {
  if (a === null || b === null) return 0;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

/** Lower-cased id-safe key for a raw name/expression; empty text gets a stable placeholder. */
export function dynamicKeyOf(raw: string): string {
  const trimmed = raw.trim();
  return trimmed === '' ? '(empty)' : raw.toLowerCase();
}

/** Display text for a raw name/expression, with empty text made visible. */
export function displayOf(raw: string): string {
  return raw.trim() === '' ? '(empty)' : raw;
}

/**
 * Deterministic GUID-like id generation for fixtures. Given the same key,
 * `deterministicId` always returns the same id, so fixture specs that omit
 * explicit ids still produce stable, reproducible XML across runs and
 * across machines. This is not a cryptographically random UUID generator;
 * it only needs to look plausible and never collide across the small
 * fixture surfaces this project builds.
 */

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Derives a stable, GUID-shaped id from an arbitrary string key. */
export function deterministicId(key: string): string {
  // Expand a 32-bit FNV-1a hash into 128 bits by re-hashing salted variants
  // of the key, giving 32 hex digits without pulling in a crypto dependency.
  const hex = [`${key}#a`, `${key}#b`, `${key}#c`, `${key}#d`]
    .map((salted) => fnv1a(salted).toString(16).padStart(8, '0'))
    .join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

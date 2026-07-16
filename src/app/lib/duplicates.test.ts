import { describe, expect, it } from 'vitest';
import { classifyIncomingFile } from './duplicates.ts';

describe('classifyIncomingFile', () => {
  it('classifies a hash not seen anywhere as new', () => {
    expect(classifyIncomingFile('hash-a', new Set(), new Set())).toBe('new');
  });

  it('classifies a hash already in IndexedDB as duplicate', () => {
    expect(classifyIncomingFile('hash-a', new Set(['hash-a']), new Set())).toBe('duplicate');
  });

  it('classifies a hash repeated within the same batch as duplicate', () => {
    expect(classifyIncomingFile('hash-a', new Set(), new Set(['hash-a']))).toBe('duplicate');
  });

  it('treats stored and in-batch duplication the same way', () => {
    expect(classifyIncomingFile('hash-a', new Set(['hash-a']), new Set(['hash-a']))).toBe('duplicate');
  });

  it('does not match on unrelated hashes', () => {
    expect(classifyIncomingFile('hash-a', new Set(['hash-b']), new Set(['hash-c']))).toBe('new');
  });
});

import { describe, expect, it } from 'vitest';
import {
  compareCreatedDates,
  compareVersionStrings,
  displayOf,
  dynamicKeyOf,
  extractActionRef,
  extractNamedInputRef,
  extractProcessCallRef,
  isCredentialActionTarget,
  isDynamicName,
  isEnvironmentExposure,
  isQueueActionTarget,
  isQuotedStringLiteral,
  unquoteStringLiteral,
} from './refs.ts';
import { makeActionParameter } from './testData.ts';

describe('isDynamicName', () => {
  it('is dynamic for empty or whitespace-only names', () => {
    expect(isDynamicName('')).toBe(true);
    expect(isDynamicName('   ')).toBe(true);
  });

  it('is dynamic when the name contains data item interpolation', () => {
    expect(isDynamicName('[Object Name]')).toBe(true);
    expect(isDynamicName('Prefix [Data Item] Suffix')).toBe(true);
  });

  it('is not dynamic for a plain literal name', () => {
    expect(isDynamicName('Utility - General')).toBe(false);
  });
});

describe('extractActionRef', () => {
  it('is not dynamic when both names are literal', () => {
    const ref = extractActionRef('Utility - General', 'Get Text');
    expect(ref).toEqual({ objectName: 'Utility - General', actionName: 'Get Text', dynamic: false });
  });

  it('is dynamic when the object name is interpolated', () => {
    expect(extractActionRef('[Object Name]', 'Get Text').dynamic).toBe(true);
  });

  it('is dynamic when the action name is empty', () => {
    expect(extractActionRef('Utility - General', '').dynamic).toBe(true);
  });
});

describe('extractProcessCallRef', () => {
  it('returns null for an internal-only subsheet call (no processName)', () => {
    expect(extractProcessCallRef(null)).toBeNull();
  });

  it('is not dynamic for a literal process name', () => {
    expect(extractProcessCallRef('Sub Process')).toEqual({ processName: 'Sub Process', dynamic: false });
  });

  it('is dynamic for an interpolated process name', () => {
    expect(extractProcessCallRef('[Process Name]')?.dynamic).toBe(true);
  });
});

describe('isQueueActionTarget / isCredentialActionTarget', () => {
  it('matches the built-in queue object names case-insensitively', () => {
    expect(isQueueActionTarget('Work Queues')).toBe(true);
    expect(isQueueActionTarget('INTERNAL - WORK QUEUES')).toBe(true);
    expect(isQueueActionTarget('Some Other Object')).toBe(false);
  });

  it('matches the built-in credential object names case-insensitively', () => {
    expect(isCredentialActionTarget('Credentials')).toBe(true);
    expect(isCredentialActionTarget('internal - credentials')).toBe(true);
    expect(isCredentialActionTarget('Some Other Object')).toBe(false);
  });
});

describe('isQuotedStringLiteral / unquoteStringLiteral', () => {
  it('accepts a plain double-quoted literal', () => {
    expect(isQuotedStringLiteral('"Invoices"')).toBe(true);
    expect(unquoteStringLiteral('"Invoices"')).toBe('Invoices');
  });

  it('rejects concatenation even if it starts and ends with a quote', () => {
    expect(isQuotedStringLiteral('"Invoices" & [Suffix]')).toBe(false);
  });

  it('rejects a data item reference', () => {
    expect(isQuotedStringLiteral('[Queue Name]')).toBe(false);
  });

  it('rejects an unquoted expression', () => {
    expect(isQuotedStringLiteral('Invoices')).toBe(false);
  });
});

describe('extractNamedInputRef', () => {
  it('resolves a literal string input case-insensitively by name', () => {
    const inputs = [makeActionParameter({ name: 'Queue Name', expression: '"Invoices"' })];
    const ref = extractNamedInputRef(inputs, 'queue name');
    expect(ref).toEqual({ dynamic: false, literalValue: 'Invoices', raw: '"Invoices"' });
  });

  it('is dynamic when the input is missing entirely', () => {
    const ref = extractNamedInputRef([], 'Queue Name');
    expect(ref.dynamic).toBe(true);
    expect(ref.raw).toBeNull();
  });

  it('is dynamic when the expression is a data item reference', () => {
    const inputs = [makeActionParameter({ name: 'Queue Name', expression: '[Queue Name Data Item]' })];
    expect(extractNamedInputRef(inputs, 'Queue Name').dynamic).toBe(true);
  });
});

describe('isEnvironmentExposure', () => {
  it('matches "environment" case-insensitively', () => {
    expect(isEnvironmentExposure('Environment')).toBe(true);
    expect(isEnvironmentExposure('environment')).toBe(true);
    expect(isEnvironmentExposure('session')).toBe(false);
    expect(isEnvironmentExposure('none')).toBe(false);
  });
});

describe('compareVersionStrings', () => {
  it('compares numeric segments, not lexicographically', () => {
    expect(compareVersionStrings('2.10', '2.9')).toBeGreaterThan(0);
    expect(compareVersionStrings('2.9', '2.10')).toBeLessThan(0);
  });

  it('treats equal versions as equal', () => {
    expect(compareVersionStrings('1.0', '1.0')).toBe(0);
  });

  it('treats missing trailing segments as zero', () => {
    expect(compareVersionStrings('1.2.0', '1.2')).toBe(0);
    expect(compareVersionStrings('1.2.1', '1.2')).toBeGreaterThan(0);
  });
});

describe('compareCreatedDates', () => {
  it('is a tie when either side is null', () => {
    expect(compareCreatedDates(null, '2024-01-01T00:00:00Z')).toBe(0);
    expect(compareCreatedDates('2024-01-01T00:00:00Z', null)).toBe(0);
  });

  it('orders parseable dates chronologically', () => {
    expect(compareCreatedDates('2024-02-01T00:00:00Z', '2024-01-01T00:00:00Z')).toBeGreaterThan(0);
  });
});

describe('dynamicKeyOf / displayOf', () => {
  it('gives empty text a stable placeholder', () => {
    expect(dynamicKeyOf('')).toBe('(empty)');
    expect(dynamicKeyOf('   ')).toBe('(empty)');
    expect(displayOf('')).toBe('(empty)');
  });

  it('lower-cases non-empty keys but preserves display casing', () => {
    expect(dynamicKeyOf('[Object Name]')).toBe('[object name]');
    expect(displayOf('[Object Name]')).toBe('[Object Name]');
  });
});

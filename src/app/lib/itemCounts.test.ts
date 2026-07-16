import { describe, expect, it } from 'vitest';
import { makeCredential, makeEnvVar, makeObject, makeProcess, makeQueue, makeRelease } from '../../lib/graph/testData.ts';
import { addItemCounts, deriveItemCounts, distinctBpVersions, emptyItemCounts } from './itemCounts.ts';

describe('deriveItemCounts', () => {
  it('counts each item collection independently', () => {
    const release = makeRelease({
      processes: [makeProcess(), makeProcess()],
      objects: [makeObject()],
      workQueues: [makeQueue()],
      environmentVariables: [makeEnvVar(), makeEnvVar()],
      credentials: [makeCredential()],
      otherItems: [{ itemType: 'font', name: 'Arial' }],
    });

    expect(deriveItemCounts(release)).toEqual({
      processes: 2,
      objects: 1,
      workQueues: 1,
      environmentVariables: 2,
      credentials: 1,
      otherItems: 1,
    });
  });

  it('reports all zeros for an empty release', () => {
    expect(deriveItemCounts(makeRelease())).toEqual(emptyItemCounts());
  });
});

describe('addItemCounts', () => {
  it('sums each field independently', () => {
    const a = { processes: 1, objects: 2, workQueues: 0, environmentVariables: 3, credentials: 1, otherItems: 0 };
    const b = { processes: 4, objects: 0, workQueues: 2, environmentVariables: 0, credentials: 1, otherItems: 5 };
    expect(addItemCounts(a, b)).toEqual({
      processes: 5,
      objects: 2,
      workQueues: 2,
      environmentVariables: 3,
      credentials: 2,
      otherItems: 5,
    });
  });
});

describe('distinctBpVersions', () => {
  it('collects distinct, sorted bpversion values across processes and objects', () => {
    const release = makeRelease({
      processes: [makeProcess({ bpversion: '7.2' }), makeProcess({ bpversion: '7.1' })],
      objects: [makeObject({ bpversion: '7.1' })],
    });
    expect(distinctBpVersions(release)).toEqual(['7.1', '7.2']);
  });

  it('ignores null bpversion values', () => {
    const release = makeRelease({ processes: [makeProcess({ bpversion: null })] });
    expect(distinctBpVersions(release)).toEqual([]);
  });
});

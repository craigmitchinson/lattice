import { describe, expect, it } from 'vitest';
import { buildReleaseXml } from '../fixtures/buildXml';
import type { ReleaseSpec, StageSpec } from '../fixtures/spec';
import { discoverSchema, mergeDiscoveryReports } from './discover';

function makeStage(name: string, type: string): StageSpec {
  return { name, type, display: { x: 20, y: 20 } };
}

function releaseWithStages(releaseName: string, processName: string, stageTypes: string[]): ReleaseSpec {
  const stages: StageSpec[] = stageTypes.map((t, i) => makeStage(`${t} ${i}`, t));
  return {
    name: releaseName,
    processes: [{ name: processName, version: '1.0', pages: [{ name: 'Main Page', type: 'MainPage', stages }] }],
  };
}

describe('discoverSchema', () => {
  const xml = buildReleaseXml(releaseWithStages('Discovery Release', 'Discovery Process', ['Start', 'Data', 'Action', 'Calculation', 'End']));
  const report = discoverSchema(xml);

  it('records every distinct element path with an occurrence count', () => {
    const stagePath = 'bpr:release/bpr:process/process/stage';
    expect(report.paths[stagePath]).toBeTruthy();
    expect(report.paths[stagePath]?.count).toBe(5);

    const releasePath = 'bpr:release';
    expect(report.paths[releasePath]?.count).toBe(1);

    const namePath = 'bpr:release/bpr:name';
    expect(report.paths[namePath]?.count).toBe(1);
  });

  it('records attribute names, counts, and up to 3 distinct example values', () => {
    const stagePath = 'bpr:release/bpr:process/process/stage';
    const typeAttr = report.paths[stagePath]?.attributes.type;
    expect(typeAttr).toBeTruthy();
    expect(typeAttr?.count).toBe(5);
    expect(typeAttr?.examples).toHaveLength(3);
    expect(typeAttr?.examples).toEqual(['Start', 'Data', 'Action']);
  });

  it('records whether text content occurs, truncated and capped at 3 examples', () => {
    const namePath = 'bpr:release/bpr:name';
    const info = report.paths[namePath];
    expect(info?.hasText).toBe(true);
    expect(info?.textExamples).toEqual(['Discovery Release']);
  });

  it('records the namespace seen at a path', () => {
    const releasePath = 'bpr:release';
    expect(report.paths[releasePath]?.namespaces).toEqual(['http://www.blueprism.co.uk/product/release']);

    // The inner <process> definition element carries no namespace at all.
    const innerProcessPath = 'bpr:release/bpr:process/process';
    expect(report.paths[innerProcessPath]?.namespaces).toEqual(['(no namespace)']);
  });
});

describe('mergeDiscoveryReports', () => {
  it('aggregates counts, attribute examples and namespaces across files', () => {
    const reportA = discoverSchema(buildReleaseXml(releaseWithStages('Release A', 'Process A', ['Start', 'End'])));
    const reportB = discoverSchema(buildReleaseXml(releaseWithStages('Release B', 'Process B', ['Start', 'Data', 'End'])));

    const merged = mergeDiscoveryReports([reportA, reportB]);

    const stagePath = 'bpr:release/bpr:process/process/stage';
    expect(merged.paths[stagePath]?.count).toBe(5);

    const releasePath = 'bpr:release';
    expect(merged.paths[releasePath]?.count).toBe(2);

    const namePath = 'bpr:release/bpr:name';
    expect(merged.paths[namePath]?.textExamples).toEqual(expect.arrayContaining(['Release A', 'Release B']));
  });
});

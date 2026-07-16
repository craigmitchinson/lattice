import { describe, expect, it } from 'vitest';
import { parseRelease } from '../parser/parseRelease';
import { buildReleaseXml } from './buildXml';
import { everyStageTypeRelease } from './presets';
import type { ReleaseSpec } from './spec';

describe('buildReleaseXml', () => {
  it('escapes special characters in text and attribute values, round-tripping exactly', () => {
    const spec: ReleaseSpec = {
      name: 'Special <chars> & "quotes"',
      processes: [
        {
          name: 'Escaping Process',
          version: '1.0',
          pages: [
            {
              name: 'Main Page',
              type: 'MainPage',
              stages: [
                {
                  name: 'Note Stage',
                  type: 'Note',
                  narrative: 'A narrative with <tags>, an & ampersand, and "quotes".',
                  display: { x: 20, y: 20 },
                },
              ],
            },
          ],
        },
      ],
    };

    const xml = buildReleaseXml(spec);
    expect(xml).toContain('&lt;chars&gt;');
    expect(xml).toContain('&amp;');

    const outcome = parseRelease({
      fileName: 'escaping.bprelease',
      content: xml,
      contentHash: 'hash',
      byteSize: xml.length,
      importedAt: '2026-07-16T09:00:00Z',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.release.releaseName).toBe('Special <chars> & "quotes"');
    const stage = outcome.release.processes[0]?.pages[0]?.stages[0];
    expect(stage?.narrative).toBe('A narrative with <tags>, an & ampersand, and "quotes".');
  });

  it('is deterministic: the same spec always produces the same XML', () => {
    const specA = everyStageTypeRelease();
    const specB = everyStageTypeRelease();
    expect(buildReleaseXml(specA)).toBe(buildReleaseXml(specB));
  });

  it('produces well-formed, parseable XML for every named preset', () => {
    const spec = everyStageTypeRelease();
    const xml = buildReleaseXml(spec);
    const outcome = parseRelease({
      fileName: 'preset.bprelease',
      content: xml,
      contentHash: 'hash',
      byteSize: xml.length,
      importedAt: '2026-07-16T09:00:00Z',
    });
    expect(outcome.ok).toBe(true);
  });
});

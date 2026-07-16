/**
 * Deliberately broken "release" text, for exercising parseRelease's failure
 * path. Every entry here is expected to produce `ParseOutcome.ok === false`
 * with a useful reason (and line/column where the underlying XML parser can
 * supply one).
 */

export interface MalformedFixture {
  name: string;
  content: string;
  expectFailure: true;
}

const BPR_NS = 'http://www.blueprism.co.uk/product/release';

export function malformedFixtures(): MalformedFixture[] {
  return [
    {
      name: 'truncated XML (unclosed elements)',
      content: `<?xml version="1.0" encoding="utf-8"?>\n<bpr:release xmlns:bpr="${BPR_NS}"><bpr:name>Truncated`,
      expectFailure: true,
    },
    {
      name: 'wrong root element',
      content: `<?xml version="1.0" encoding="utf-8"?>\n<foo:bar xmlns:foo="urn:not-blue-prism">not a release</foo:bar>`,
      expectFailure: true,
    },
    {
      name: 'invalid entity reference',
      content: `<?xml version="1.0" encoding="utf-8"?>\n<bpr:release xmlns:bpr="${BPR_NS}"><bpr:name>Bad &undefinedentity; value</bpr:name></bpr:release>`,
      expectFailure: true,
    },
    {
      name: 'empty file',
      content: '',
      expectFailure: true,
    },
    {
      name: 'binary junk',
      content: '\x00\x01\x02\x03BINARY-NOT-XML\xFF\xFE\x07\x08',
      expectFailure: true,
    },
  ];
}

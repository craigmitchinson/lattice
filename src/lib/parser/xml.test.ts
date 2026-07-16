import { describe, expect, it } from 'vitest';
import { attr, child, children, parseXmlDocument, text, XmlParseError } from './xml';

describe('parseXmlDocument', () => {
  it('parses a namespaced element tree, stripping prefixes but keeping raw names and namespaces', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<bpr:release xmlns:bpr="http://www.blueprism.co.uk/product/release">' +
      '<bpr:name>Sample</bpr:name>' +
      '<bpr:process id="p1" name="Proc"><process id="p1" name="Proc" version="1.0"><subsheet subsheetid="s1" type="MainPage" published="False"><name>Main Page</name></subsheet></process></bpr:process>' +
      '</bpr:release>';

    const root = parseXmlDocument(xml);

    expect(root.name).toBe('release');
    expect(root.rawName).toBe('bpr:release');
    expect(root.prefix).toBe('bpr');
    expect(root.namespace).toBe('http://www.blueprism.co.uk/product/release');

    const nameEl = child(root, 'name');
    expect(nameEl).not.toBeNull();
    expect(text(nameEl!)).toBe('Sample');
    expect(nameEl!.namespace).toBe('http://www.blueprism.co.uk/product/release');

    const processWrapper = child(root, 'process');
    expect(processWrapper).not.toBeNull();
    expect(attr(processWrapper!, 'name')).toBe('Proc');

    // The inner <process> element carries no prefix and no xmlns of its own,
    // so it must not inherit the bpr namespace from its ancestor.
    const inner = child(processWrapper!, 'process');
    expect(inner).not.toBeNull();
    expect(inner!.prefix).toBeNull();
    expect(inner!.namespace).toBeNull();

    const subsheet = child(inner!, 'subsheet');
    expect(subsheet).not.toBeNull();
    expect(attr(subsheet!, 'subsheetid')).toBe('s1');
    expect(children(inner!, 'subsheet')).toHaveLength(1);
  });

  it('handles CDATA content via the text helper', () => {
    const xml = '<root><code><![CDATA[return a < b && c > d;]]></code></root>';
    const root = parseXmlDocument(xml);
    const codeEl = child(root, 'code');
    expect(codeEl).not.toBeNull();
    expect(text(codeEl!)).toBe('return a < b && c > d;');
  });

  it('tolerates a missing namespace prefix entirely', () => {
    const xml = '<release><name>No namespace</name></release>';
    const root = parseXmlDocument(xml);
    expect(root.name).toBe('release');
    expect(root.namespace).toBeNull();
  });

  it('throws XmlParseError with a line and column on malformed XML', () => {
    const xml = '<root><unclosed></root>';
    expect(() => parseXmlDocument(xml)).toThrow(XmlParseError);

    try {
      parseXmlDocument(xml);
      expect.unreachable('expected parseXmlDocument to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(XmlParseError);
      const parseErr = err as XmlParseError;
      expect(parseErr.line).toBeGreaterThanOrEqual(1);
      expect(parseErr.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('throws XmlParseError for an empty document', () => {
    expect(() => parseXmlDocument('')).toThrow(XmlParseError);
  });
});

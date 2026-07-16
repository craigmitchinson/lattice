/**
 * Thin wrapper over `@rgrove/parse-xml`, the only module in the codebase
 * allowed to import it directly. The rest of the parser and the discovery
 * module work against the simple element tree exposed here (`XmlEl`), never
 * against the underlying library's node classes. This keeps the dependency
 * swappable and keeps parsing usable inside Web Workers (no DOMParser).
 */

import { parseXml, XmlElement, XmlError } from '@rgrove/parse-xml';

/**
 * A parsed XML element. Namespace-aware but tolerant of missing prefixes:
 * `name` is always the local name (prefix stripped), while `rawName` and
 * `prefix` preserve exactly what was written and `namespace` carries the
 * resolved URI when one could be determined from an `xmlns`/`xmlns:*`
 * declaration in scope.
 */
export interface XmlEl {
  /** Local name with any namespace prefix stripped, e.g. 'release'. */
  name: string;
  /** Original name exactly as written, e.g. 'bpr:release'. */
  rawName: string;
  /** Namespace prefix as written, or null when unprefixed. */
  prefix: string | null;
  /** Resolved namespace URI for this element's prefix, or null when unknown/undeclared. */
  namespace: string | null;
  attributes: Record<string, string>;
  children: XmlEl[];
  /** Concatenation of this element's direct text/CDATA children, raw (untrimmed). */
  text: string;
  /** 1-based line of the element's opening tag, best effort. */
  line: number;
  /** 1-based column of the element's opening tag, best effort. */
  column: number;
}

/** Thrown by `parseXmlDocument` on malformed XML; carries a best-effort position. */
export class XmlParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'XmlParseError';
    this.line = line;
    this.column = column;
  }
}

/** First direct child with the given local name, or null. */
export function child(el: XmlEl, name: string): XmlEl | null {
  return el.children.find((c) => c.name === name) ?? null;
}

/** All direct children, optionally filtered by local name. */
export function children(el: XmlEl, name?: string): XmlEl[] {
  return name === undefined ? el.children : el.children.filter((c) => c.name === name);
}

/** Attribute value by name, or null when absent. */
export function attr(el: XmlEl, name: string): string | null {
  return el.attributes[name] ?? null;
}

/** Direct text content of the element (see `XmlEl.text`). */
export function text(el: XmlEl): string {
  return el.text;
}

/** Builds a line/column lookup for 0-based character offsets into a source string. */
class LineIndex {
  private readonly lineStarts: number[];

  constructor(source: string) {
    const starts = [0];
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === '\n') starts.push(i + 1);
    }
    this.lineStarts = starts;
  }

  locate(offset: number): { line: number; column: number } {
    if (offset < 0) return { line: 1, column: 1 };

    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if ((this.lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }

    const lineStart = this.lineStarts[lo] ?? 0;
    return { line: lo + 1, column: offset - lineStart + 1 };
  }
}

/** prefix ('' for the default namespace) -> resolved URI, inherited down the tree. */
type NsScope = Record<string, string>;

function splitName(rawName: string): { prefix: string | null; name: string } {
  const idx = rawName.indexOf(':');
  if (idx === -1) return { prefix: null, name: rawName };
  return { prefix: rawName.slice(0, idx), name: rawName.slice(idx + 1) };
}

function collectDirectText(node: XmlElement): string {
  let out = '';
  for (const c of node.children) {
    if (c.type === 'text' || c.type === 'cdata') {
      out += (c as { text: string }).text;
    }
  }
  return out;
}

function convertElement(node: XmlElement, lineIndex: LineIndex, parentScope: NsScope): XmlEl {
  const { prefix, name } = splitName(node.name);

  const scope: NsScope = { ...parentScope };
  for (const [attrName, value] of Object.entries(node.attributes)) {
    if (attrName === 'xmlns') scope[''] = value;
    else if (attrName.startsWith('xmlns:')) scope[attrName.slice('xmlns:'.length)] = value;
  }

  const namespace = scope[prefix ?? ''] ?? null;
  const { line, column } = lineIndex.locate(node.start);

  const childElements: XmlEl[] = [];
  for (const c of node.children) {
    if (c instanceof XmlElement) childElements.push(convertElement(c, lineIndex, scope));
  }

  return {
    name,
    rawName: node.name,
    prefix,
    namespace,
    attributes: { ...node.attributes },
    children: childElements,
    text: collectDirectText(node),
    line,
    column,
  };
}

/**
 * Parses XML text into a simple element tree rooted at the document
 * element. Throws `XmlParseError` (never the raw library error) on
 * malformed XML or a missing root element, with a best-effort line/column.
 */
export function parseXmlDocument(source: string): XmlEl {
  let doc;
  try {
    doc = parseXml(source, { includeOffsets: true, preserveCdata: true });
  } catch (err) {
    if (err instanceof XmlError) {
      throw new XmlParseError(err.message.split('\n')[0] ?? err.message, err.line, err.column);
    }
    throw err;
  }

  const root = doc.root;
  if (!root) {
    throw new XmlParseError('document has no root element', 1, 1);
  }

  const lineIndex = new LineIndex(source);
  return convertElement(root, lineIndex, {});
}

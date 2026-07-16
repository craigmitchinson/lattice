/**
 * Schema-discovery mode: walks every element and attribute of a .bprelease
 * (or any XML) document and reports the shape it found, independent of
 * whether the parser understands any of it. Used to explore real exports
 * and to spot format deviations the tolerant parser should handle.
 */

import type { XmlEl } from '../parser/xml';
import { parseXmlDocument } from '../parser/xml';

const MAX_EXAMPLES = 3;
const TEXT_TRUNCATE_LENGTH = 80;

export interface AttributeInfo {
  count: number;
  /** Up to 3 distinct example values. */
  examples: string[];
}

export interface PathInfo {
  /** Element path from the document root, joined by '/', using names exactly as exported (prefix included). */
  path: string;
  count: number;
  attributes: Record<string, AttributeInfo>;
  hasText: boolean;
  /** Up to 3 distinct example values, truncated to 80 characters. */
  textExamples: string[];
  /** Distinct namespace URIs seen for this path; '(no namespace)' when none was declared. */
  namespaces: string[];
}

export interface SchemaDiscoveryReport {
  paths: Record<string, PathInfo>;
}

function addExample(examples: string[], value: string): void {
  if (examples.length >= MAX_EXAMPLES) return;
  if (examples.includes(value)) return;
  examples.push(value);
}

function truncate(s: string): string {
  return s.length > TEXT_TRUNCATE_LENGTH ? `${s.slice(0, TEXT_TRUNCATE_LENGTH)}…` : s;
}

function namespaceLabel(ns: string | null): string {
  return ns ?? '(no namespace)';
}

function emptyPathInfo(path: string): PathInfo {
  return { path, count: 0, attributes: {}, hasText: false, textExamples: [], namespaces: [] };
}

function visit(el: XmlEl, path: string, paths: Record<string, PathInfo>): void {
  let info = paths[path];
  if (!info) {
    info = emptyPathInfo(path);
    paths[path] = info;
  }

  info.count += 1;

  const ns = namespaceLabel(el.namespace);
  if (!info.namespaces.includes(ns)) info.namespaces.push(ns);

  for (const [attrName, value] of Object.entries(el.attributes)) {
    let attrInfo = info.attributes[attrName];
    if (!attrInfo) {
      attrInfo = { count: 0, examples: [] };
      info.attributes[attrName] = attrInfo;
    }
    attrInfo.count += 1;
    addExample(attrInfo.examples, value);
  }

  const trimmedText = el.text.trim();
  if (trimmedText.length > 0) {
    info.hasText = true;
    addExample(info.textExamples, truncate(trimmedText));
  }

  for (const child of el.children) {
    visit(child, `${path}/${child.rawName}`, paths);
  }
}

/** Walks the whole document, recording one PathInfo per distinct element path. */
export function discoverSchema(xmlText: string): SchemaDiscoveryReport {
  const root = parseXmlDocument(xmlText);
  const paths: Record<string, PathInfo> = {};
  visit(root, root.rawName, paths);
  return { paths };
}

/** Aggregates discovery reports from multiple files into one combined report. */
export function mergeDiscoveryReports(reports: SchemaDiscoveryReport[]): SchemaDiscoveryReport {
  const paths: Record<string, PathInfo> = {};

  for (const report of reports) {
    for (const info of Object.values(report.paths)) {
      let merged = paths[info.path];
      if (!merged) {
        merged = emptyPathInfo(info.path);
        paths[info.path] = merged;
      }

      merged.count += info.count;
      merged.hasText = merged.hasText || info.hasText;

      for (const ns of info.namespaces) {
        if (!merged.namespaces.includes(ns)) merged.namespaces.push(ns);
      }

      for (const example of info.textExamples) addExample(merged.textExamples, example);

      for (const [attrName, attrInfo] of Object.entries(info.attributes)) {
        let mergedAttr = merged.attributes[attrName];
        if (!mergedAttr) {
          mergedAttr = { count: 0, examples: [] };
          merged.attributes[attrName] = mergedAttr;
        }
        mergedAttr.count += attrInfo.count;
        for (const example of attrInfo.examples) addExample(mergedAttr.examples, example);
      }
    }
  }

  return { paths };
}

/**
 * Builds synthetic .bprelease XML text from a declarative ReleaseSpec (see
 * spec.ts). This is the fixture generator: every test in the parser and
 * discovery suites gets its input XML from here (directly or via presets.ts
 * / estate.ts), never from a real release file.
 */

import { deterministicId } from './ids';
import type {
  ActionParamSpec,
  AppDefSpec,
  AppElementSpec,
  AppStepSpec,
  ChoiceSpec,
  ObjectSpec,
  PageSpec,
  ProcessSpec,
  ReleaseSpec,
  StageSpec,
} from './spec';

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

function pad(depth: number): string {
  return '  '.repeat(depth);
}

function attrsToString(attrs: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    parts.push(`${k}="${escapeAttr(v)}"`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/** Minimal indenting XML text builder. Not a DOM; just produces valid text. */
class XmlWriter {
  private readonly lines: string[] = [];
  private indent = 0;

  open(tag: string, attrs: Record<string, string | undefined> = {}): void {
    this.lines.push(`${pad(this.indent)}<${tag}${attrsToString(attrs)}>`);
    this.indent += 1;
  }

  close(tag: string): void {
    this.indent -= 1;
    this.lines.push(`${pad(this.indent)}</${tag}>`);
  }

  empty(tag: string, attrs: Record<string, string | undefined> = {}): void {
    this.lines.push(`${pad(this.indent)}<${tag}${attrsToString(attrs)}/>`);
  }

  /** A single-line element with escaped text content and no inner whitespace. */
  leaf(tag: string, textContent: string, attrs: Record<string, string | undefined> = {}): void {
    this.lines.push(`${pad(this.indent)}<${tag}${attrsToString(attrs)}>${escapeText(textContent)}</${tag}>`);
  }

  /** A single-line element wrapping raw (unescaped) content in a CDATA section. */
  leafCdata(tag: string, raw: string, attrs: Record<string, string | undefined> = {}): void {
    this.lines.push(`${pad(this.indent)}<${tag}${attrsToString(attrs)}><![CDATA[${raw}]]></${tag}>`);
  }

  /** A single pre-built line, indented at the current depth (e.g. the XML declaration). */
  raw(line: string): void {
    this.lines.push(`${pad(this.indent)}${line}`);
  }

  /** Appends a pre-built multi-line block, indenting every line at the current depth. */
  rawBlock(block: string): void {
    for (const line of block.split('\n')) {
      this.lines.push(`${pad(this.indent)}${line}`);
    }
  }

  toString(): string {
    return this.lines.join('\n');
  }
}

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`fixture builder: expected key '${String(key)}' to be present`);
  }
  return value;
}

function assertNever(x: never): never {
  throw new Error(`fixture builder: unreachable stage payload: ${JSON.stringify(x)}`);
}

function buildParams(
  w: XmlWriter,
  direction: 'input' | 'output',
  params: ActionParamSpec[] | undefined,
): void {
  if (!params || params.length === 0) return;

  const wrapperTag = direction === 'input' ? 'inputs' : 'outputs';
  w.open(wrapperTag);
  for (const p of params) {
    if (direction === 'input') {
      w.empty('input', { name: p.name, type: p.dataType, expr: p.expr });
    } else {
      w.empty('output', { name: p.name, type: p.dataType, stage: p.storeIn });
    }
  }
  w.close(wrapperTag);
}

function buildAppStep(
  w: XmlWriter,
  stageType: string,
  step: AppStepSpec,
  elementIdByName: Map<string, string>,
): void {
  w.open('step');

  const elementId = step.elementId ?? (step.elementRef ? (elementIdByName.get(step.elementRef) ?? step.elementRef) : undefined);
  if (elementId !== undefined) w.empty('element', { id: elementId });

  if (stageType === 'WaitStart') {
    if (step.actionOrCondition !== undefined) w.empty('condition', { name: step.actionOrCondition });
  } else {
    if (step.actionOrCondition !== undefined) w.empty('action', { name: step.actionOrCondition });

    if (step.arguments && step.arguments.length > 0) {
      w.open('arguments');
      for (const a of step.arguments) w.leaf('argument', a.value, { name: a.name });
      w.close('arguments');
    }

    if (stageType === 'Read' && step.storeIn !== undefined) w.leaf('storein', step.storeIn);
    if (stageType === 'Write' && step.expr !== undefined) w.leaf('expr', step.expr);
  }

  w.close('step');
}

function buildChoice(w: XmlWriter, choice: ChoiceSpec, stageIdByName: Map<string, string>): void {
  const attrs: Record<string, string | undefined> = {
    name: choice.name,
    expression: choice.expression,
  };
  if (choice.onTrue !== undefined) {
    attrs.ontrue = stageIdByName.get(choice.onTrue) ?? choice.onTrue;
  }
  w.empty('choice', attrs);
}

function buildStage(
  stage: StageSpec,
  w: XmlWriter,
  pageId: string,
  stageId: string,
  stageIdByName: Map<string, string>,
  pageIdByName: Map<string, string>,
  elementIdByName: Map<string, string>,
): void {
  const attrs: Record<string, string | undefined> = {
    stageid: stageId,
    name: stage.name,
    type: stage.type,
    ...(stage.extraAttributes ?? {}),
  };
  w.open('stage', attrs);

  if (stage.narrative !== undefined) w.leaf('narrative', stage.narrative);
  w.leaf('subsheetid', pageId);

  const d = stage.display;
  if (d) {
    w.empty('display', { x: String(d.x), y: String(d.y), w: d.w !== undefined ? String(d.w) : undefined, h: d.h !== undefined ? String(d.h) : undefined });
  }

  if (stage.loginhibit) w.empty('loginhibit');

  if (stage.onSuccess !== undefined) {
    w.leaf('onsuccess', stageIdByName.get(stage.onSuccess) ?? stage.onSuccess);
  }

  const payload = stage.payload;
  if (payload) {
    switch (payload.kind) {
      case 'decision':
        w.empty('decision', { expression: payload.expression });
        break;

      case 'calculation':
        w.empty('calculation', { expression: payload.expression, stage: payload.storeIn });
        break;

      case 'multipleCalculation':
        w.open('steps');
        for (const step of payload.steps) {
          w.empty('calculation', { expression: step.expression, stage: step.storeIn });
        }
        w.close('steps');
        break;

      case 'data':
        if (payload.dataType !== undefined) w.leaf('datatype', payload.dataType);
        if (payload.initialValue !== undefined) w.leaf('initialvalue', payload.initialValue);
        w.leaf('exposure', payload.exposure ?? 'None');
        if (payload.alwaysInit) w.empty('alwaysinit');
        if (payload.fields && payload.fields.length > 0) {
          w.open('collectioninfo');
          for (const f of payload.fields) w.empty('field', { name: f.name, type: f.type });
          w.close('collectioninfo');
        }
        break;

      case 'action':
        w.empty('resource', { object: payload.objectName, action: payload.actionName });
        buildParams(w, 'input', payload.inputs);
        buildParams(w, 'output', payload.outputs);
        break;

      case 'subSheetCall': {
        const targetId = payload.targetSubsheetId ?? pageIdByName.get(payload.targetSubsheet) ?? payload.targetSubsheet;
        w.empty('target', { subsheetid: targetId });
        buildParams(w, 'input', payload.inputs);
        buildParams(w, 'output', payload.outputs);
        break;
      }

      case 'processCall':
        w.empty('target', { processname: payload.targetProcessName, processid: payload.targetProcessId });
        buildParams(w, 'input', payload.inputs);
        buildParams(w, 'output', payload.outputs);
        break;

      case 'code':
        w.leafCdata('code', payload.code, { language: payload.language });
        buildParams(w, 'input', payload.inputs);
        buildParams(w, 'output', payload.outputs);
        break;

      case 'appSteps':
        if (payload.timeout !== undefined) w.leaf('timeout', payload.timeout);
        for (const step of payload.steps) buildAppStep(w, stage.type, step, elementIdByName);
        break;

      case 'exception':
        // .NET-style casing ('True'/'False'), matching how Blue Prism writes
        // boolean attributes elsewhere; the parser accepts either casing.
        w.empty('exception', {
          type: payload.exceptionType,
          detail: payload.detail,
          usecurrent: payload.useCurrent !== undefined ? (payload.useCurrent ? 'True' : 'False') : undefined,
          savedetail: payload.saveDetail !== undefined ? (payload.saveDetail ? 'True' : 'False') : undefined,
        });
        break;

      case 'alert':
        w.empty('alert', { expression: payload.expression });
        break;

      default:
        assertNever(payload);
    }
  }

  if (stage.type === 'Decision') {
    if (stage.onTrue !== undefined) w.leaf('ontrue', stageIdByName.get(stage.onTrue) ?? stage.onTrue);
    if (stage.onFalse !== undefined) w.leaf('onfalse', stageIdByName.get(stage.onFalse) ?? stage.onFalse);
  }

  if (stage.choices && stage.choices.length > 0) {
    for (const choice of stage.choices) buildChoice(w, choice, stageIdByName);
  }

  for (const extra of stage.extraChildren ?? []) {
    if (extra.text !== undefined) w.leaf(extra.tag, extra.text);
    else w.empty(extra.tag);
  }

  w.close('stage');
}

function resolvePageIds(pages: PageSpec[], ownerKey: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of pages) {
    map.set(p.name, p.id ?? deterministicId(`${ownerKey}/page:${p.name}`));
  }
  return map;
}

function resolveStageIds(stages: StageSpec[], ownerKey: string, pageName: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of stages) {
    map.set(s.name, s.id ?? deterministicId(`${ownerKey}/page:${pageName}/stage:${s.name}`));
  }
  return map;
}

function buildAppElements(
  elements: AppElementSpec[],
  ownerKey: string,
  pathPrefix: string,
  w: XmlWriter,
  idByName: Map<string, string>,
): void {
  for (const el of elements) {
    const path = pathPrefix ? `${pathPrefix}/${el.name}` : el.name;
    const id = el.id ?? deterministicId(`${ownerKey}/element:${path}`);
    idByName.set(el.name, id);

    w.open('element', { id, name: el.name });
    if (el.elementType !== undefined) w.leaf('type', el.elementType);
    if (el.children && el.children.length > 0) {
      buildAppElements(el.children, ownerKey, path, w, idByName);
    }
    w.close('element');
  }
}

function buildAppDef(appDef: AppDefSpec, ownerKey: string, w: XmlWriter): Map<string, string> {
  const idByName = new Map<string, string>();
  w.open('appdef');
  if (appDef.applicationName !== undefined) w.leaf('applicationname', appDef.applicationName);
  buildAppElements(appDef.elements, ownerKey, '', w, idByName);
  w.close('appdef');
  return idByName;
}

function buildProcessInner(
  spec: ProcessSpec,
  kind: 'process' | 'object',
  id: string,
  appDef: AppDefSpec | undefined,
): string {
  const w = new XmlWriter();
  const attrs: Record<string, string | undefined> = {
    id,
    name: spec.name,
    version: spec.version,
    bpversion: spec.bpversion,
    narrative: spec.narrative,
    type: kind === 'object' ? 'object' : undefined,
  };
  w.open('process', attrs);

  const ownerKey = `${kind}:${spec.name}`;
  const pageIdByName = resolvePageIds(spec.pages, ownerKey);

  for (const page of spec.pages) {
    const pageId = mustGet(pageIdByName, page.name);
    w.open('subsheet', {
      subsheetid: pageId,
      type: page.type ?? 'Normal',
      published: (page.published ?? false) ? 'True' : 'False',
    });
    w.leaf('name', page.name);
    w.close('subsheet');
  }

  const elementIdByName = appDef ? buildAppDef(appDef, ownerKey, w) : new Map<string, string>();

  for (const page of spec.pages) {
    const pageId = mustGet(pageIdByName, page.name);
    const stageIdByName = resolveStageIds(page.stages, ownerKey, page.name);
    for (const stage of page.stages) {
      const stageId = mustGet(stageIdByName, stage.name);
      buildStage(stage, w, pageId, stageId, stageIdByName, pageIdByName, elementIdByName);
    }
  }

  for (const extra of spec.extraChildren ?? []) {
    if (extra.text !== undefined) w.leaf(extra.tag, extra.text);
    else w.empty(extra.tag);
  }

  w.close('process');
  return w.toString();
}

function buildProcessWrapper(
  spec: ProcessSpec,
  kind: 'process' | 'object',
  id: string,
  appDef: AppDefSpec | undefined,
  w: XmlWriter,
): void {
  const innerXml = buildProcessInner(spec, kind, id, appDef);
  const wrapperTag = kind === 'process' ? 'bpr:process' : 'bpr:object';
  const attrs: Record<string, string | undefined> = {
    id,
    name: spec.name,
    bpversion: spec.bpversion,
    ...(spec.extraWrapperAttributes ?? {}),
  };

  w.open(wrapperTag, attrs);
  w.rawBlock(spec.embedAsEscapedText ? escapeText(innerXml) : innerXml);
  w.close(wrapperTag);
}

/** Builds a complete, valid .bprelease XML document from a declarative spec. */
export function buildReleaseXml(spec: ReleaseSpec): string {
  const w = new XmlWriter();
  w.raw('<?xml version="1.0" encoding="utf-8"?>');

  const releaseName = spec.name ?? 'Synthetic release';
  const rootAttrs: Record<string, string | undefined> = {
    'xmlns:bpr': 'http://www.blueprism.co.uk/product/release',
    ...(spec.extraRootAttributes ?? {}),
  };
  w.open('bpr:release', rootAttrs);

  w.leaf('bpr:name', releaseName);
  if (spec.releaseNotes !== undefined) w.leaf('bpr:release-notes', spec.releaseNotes);
  w.leaf('bpr:created', spec.created ?? '2026-01-01T09:00:00Z');
  w.leaf('bpr:package-id', spec.packageId ?? deterministicId(`package:${releaseName}`));
  if (spec.packageName !== undefined) w.leaf('bpr:package-name', spec.packageName);
  if (spec.userCreatedBy !== undefined) w.leaf('bpr:user-created-by', spec.userCreatedBy);

  const processes = spec.processes ?? [];
  const objects: ObjectSpec[] = spec.objects ?? [];
  const queues = spec.workQueues ?? [];
  const envVars = spec.environmentVariables ?? [];
  const credentials = spec.credentials ?? [];
  const otherItems = spec.otherItems ?? [];

  const processEntries = processes.map((item) => ({ item, id: item.id ?? deterministicId(`process:${item.name}`) }));
  const objectEntries = objects.map((item) => ({ item, id: item.id ?? deterministicId(`object:${item.name}`) }));
  const queueEntries = queues.map((item) => ({ item, id: item.id ?? deterministicId(`queue:${item.name}`) }));
  const credentialEntries = credentials.map((item) => ({ item, id: item.id ?? deterministicId(`credential:${item.name}`) }));
  const otherItemEntries = otherItems.map((item) => ({
    item,
    id:
      item.itemType === 'tile' || item.itemType === 'dashboard'
        ? (item.id ?? deterministicId(`${item.itemType}:${item.name}`))
        : null,
  }));

  const contentsCount =
    processEntries.length +
    objectEntries.length +
    queueEntries.length +
    envVars.length +
    credentialEntries.length +
    otherItemEntries.length;

  w.open('bpr:contents', { count: String(contentsCount) });
  for (const { item, id } of processEntries) w.empty('bpr:process', { id, name: item.name });
  for (const { item, id } of objectEntries) w.empty('bpr:object', { id, name: item.name });
  for (const { item, id } of queueEntries) w.empty('bpr:work-queue', { id, name: item.name });
  for (const v of envVars) w.empty('bpr:environment-variable', { name: v.name });
  for (const { item, id } of credentialEntries) w.empty('bpr:credential', { id, name: item.name });
  for (const { item, id } of otherItemEntries) {
    w.empty(`bpr:${item.itemType}`, id !== null ? { id, name: item.name } : { name: item.name });
  }
  w.close('bpr:contents');

  for (const { item, id } of processEntries) buildProcessWrapper(item, 'process', id, undefined, w);
  for (const { item, id } of objectEntries) buildProcessWrapper(item, 'object', id, item.appDef, w);

  for (const { item, id } of queueEntries) {
    w.open('bpr:work-queue', { id, name: item.name });
    if (item.keyField !== undefined) w.leaf('keyfield', item.keyField);
    if (item.maxAttempts !== undefined) w.leaf('maxattempts', String(item.maxAttempts));
    w.close('bpr:work-queue');
  }

  for (const v of envVars) {
    w.empty('bpr:environment-variable', {
      name: v.name,
      datatype: v.dataType,
      value: v.value,
      description: v.description,
    });
  }

  for (const { item, id } of credentialEntries) {
    w.open('bpr:credential', { id, name: item.name });
    if (item.description !== undefined) w.leaf('description', item.description);
    w.close('bpr:credential');
  }

  for (const { item, id } of otherItemEntries) {
    w.empty(`bpr:${item.itemType}`, id !== null ? { id, name: item.name } : { name: item.name });
  }

  for (const extra of spec.extraRootChildren ?? []) {
    if (extra.text !== undefined) w.leaf(extra.tag, extra.text);
    else w.empty(extra.tag);
  }

  w.close('bpr:release');
  return w.toString();
}

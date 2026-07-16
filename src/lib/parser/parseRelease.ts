/**
 * Parses .bprelease XML text into a ParsedRelease. Tolerant by design: order
 * of elements never matters, missing-optional content degrades gracefully,
 * and unknown elements/attributes/stage types are recorded as warnings and
 * never fail the parse. Only structurally broken XML (or an unexpected root
 * element) produces a ParseFailure, and even then only for that one file;
 * callers parse files independently so a bad file never affects a good one.
 *
 * Namespace-aware: matching is by local element name throughout (see
 * xml.ts), so a missing or different `bpr:` prefix is tolerated entirely.
 */

import type {
  ActionParameter,
  AppModelElement,
  KnownStageType,
  ParseFailure,
  ParsedAppModel,
  ParsedCredential,
  ParsedEnvironmentVariable,
  ParsedOtherItem,
  ParsedPage,
  ParsedProcess,
  ParsedRelease,
  ParsedStage,
  ParsedWorkQueue,
  ParseWarning,
  SourceFileMeta,
  StageDisplay,
  StageLinks,
  StagePayloads,
} from '../model/types';
import { narrowStageType } from '../model/types';
import type { XmlEl } from './xml';
import { attr, child, children, parseXmlDocument, text, XmlParseError } from './xml';

export interface ParseReleaseInput {
  fileName: string;
  content: string;
  contentHash: string;
  byteSize: number;
  importedAt: string;
}

export type ParseOutcome = { ok: true; release: ParsedRelease } | { ok: false; failure: ParseFailure };

// --- Known-shape tables used to detect (and warn about) unrecognised content ---

const ROOT_ATTRS = new Set<string>();
const OTHER_ITEM_NAMES = new Set(['font', 'tile', 'dashboard', 'process-group']);

const WRAPPER_ATTRS = new Set(['id', 'name', 'bpversion']);
const INNER_PROCESS_ATTRS = new Set(['id', 'name', 'version', 'bpversion', 'narrative', 'type']);
const INNER_PROCESS_CHILDREN = new Set(['subsheet', 'stage', 'appdef']);
const SUBSHEET_ATTRS = new Set(['subsheetid', 'type', 'published']);
const SUBSHEET_CHILDREN = new Set(['name']);

const STAGE_ATTRS = new Set(['stageid', 'name', 'type']);

// Allowed attributes on payload sub-elements, so that a misspelt or
// unexpected attribute inside a stage payload warns instead of silently
// producing a default value.
const PAYLOAD_ATTRS: Record<string, ReadonlySet<string>> = {
  decision: new Set(['expression']),
  calculation: new Set(['expression', 'stage']),
  resource: new Set(['object', 'action']),
  target: new Set(['subsheetid', 'processname', 'processid']),
  code: new Set(['language']),
  exception: new Set(['type', 'detail', 'usecurrent', 'savedetail']),
  alert: new Set(['expression']),
  input: new Set(['name', 'type', 'expr']),
  output: new Set(['name', 'type', 'stage']),
  element: new Set(['id']),
  action: new Set(['name']),
  condition: new Set(['name']),
  argument: new Set(['name']),
  field: new Set(['name', 'type']),
  choice: new Set(['name', 'expression', 'ontrue']),
  display: new Set(['x', 'y', 'w', 'h']),
};

/** Warns about unrecognised attributes on a payload sub-element, if we know its shape. */
function checkPayloadEl(el: XmlEl | null, path: string, warnings: ParseWarning[]): XmlEl | null {
  if (el) {
    const allowed = PAYLOAD_ATTRS[el.name];
    if (allowed) warnUnknownAttributes(el, allowed, `${path}/${el.rawName}`, warnings);
  }
  return el;
}

const QUEUE_ATTRS = new Set(['id', 'name']);
const QUEUE_CHILDREN = new Set(['keyfield', 'maxattempts']);
const ENVVAR_ATTRS = new Set(['name', 'datatype', 'value', 'description']);
const CREDENTIAL_ATTRS = new Set(['id', 'name']);
const CREDENTIAL_CHILDREN = new Set(['description']);

/** Children considered known for a stage of the given (narrowed) type. */
function expectedStageChildren(knownType: KnownStageType | null): Set<string> {
  const common = ['narrative', 'subsheetid', 'display', 'loginhibit', 'onsuccess'];
  const extra: string[] = [];

  if (knownType === null) {
    return new Set(common);
  }

  switch (knownType) {
    case 'Decision':
      extra.push('decision', 'ontrue', 'onfalse');
      break;
    case 'ChoiceStart':
      extra.push('choice');
      break;
    case 'Calculation':
      extra.push('calculation');
      break;
    case 'MultipleCalculation':
      extra.push('steps');
      break;
    case 'Data':
    case 'Collection':
      extra.push('datatype', 'initialvalue', 'exposure', 'alwaysinit', 'collectioninfo');
      break;
    case 'Action':
      extra.push('resource', 'inputs', 'outputs');
      break;
    case 'SubSheet':
    case 'Process':
      extra.push('target', 'inputs', 'outputs');
      break;
    case 'Code':
      extra.push('code', 'inputs', 'outputs');
      break;
    case 'Navigate':
    case 'Read':
    case 'Write':
    case 'WaitStart':
      extra.push('step', 'timeout');
      break;
    case 'Exception':
      extra.push('exception');
      break;
    case 'Alert':
      extra.push('alert');
      break;
    case 'LoopStart':
      // Real exports may carry <groupinfo> here; treat it as a known,
      // silently-ignored child rather than warning about it.
      extra.push('groupinfo');
      break;
    case 'Start':
    case 'End':
    case 'Anchor':
    case 'Note':
    case 'Recover':
    case 'Resume':
    case 'ChoiceEnd':
    case 'WaitEnd':
    case 'LoopEnd':
    case 'Block':
    case 'SubSheetInfo':
    case 'ProcessInfo':
      break;
    default: {
      const exhaustive: never = knownType;
      throw new Error(`unreachable known stage type: ${String(exhaustive)}`);
    }
  }

  return new Set([...common, ...extra]);
}

function makeWarning(code: string, message: string, path: string, el: XmlEl): ParseWarning {
  return { code, message, path, line: el.line, column: el.column };
}

/**
 * Reads a boolean-like attribute tolerantly. Blue Prism exports use .NET-style
 * casing ('True'/'False') in some places and lower case in others, so matching
 * is case-insensitive. An absent attribute is false.
 */
function boolAttr(el: XmlEl, name: string): boolean {
  return (attr(el, name) ?? '').toLowerCase() === 'true';
}

function warnUnknownAttributes(el: XmlEl, allowed: ReadonlySet<string>, path: string, warnings: ParseWarning[]): void {
  for (const attrName of Object.keys(el.attributes)) {
    if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) continue;
    if (!allowed.has(attrName)) {
      warnings.push(makeWarning('unknown-attribute', `unrecognised attribute '${attrName}' on <${el.rawName}>`, path, el));
    }
  }
}

function warnUnknownChildren(el: XmlEl, allowed: ReadonlySet<string>, path: string, warnings: ParseWarning[]): void {
  for (const c of el.children) {
    if (!allowed.has(c.name)) {
      warnings.push(makeWarning('unknown-element', `unrecognised element '<${c.rawName}>' under <${el.rawName}>`, `${path}/${c.rawName}`, c));
    }
  }
}

function parseParams(stageEl: XmlEl, direction: 'input' | 'output', path: string, warnings: ParseWarning[]): ActionParameter[] {
  const wrapper = child(stageEl, direction === 'input' ? 'inputs' : 'outputs');
  if (!wrapper) return [];

  return children(wrapper, direction).map((item) => {
    checkPayloadEl(item, path, warnings);
    return {
      name: attr(item, 'name') ?? '',
      dataType: attr(item, 'type'),
      expression: direction === 'input' ? attr(item, 'expr') : null,
      storeIn: direction === 'output' ? attr(item, 'stage') : null,
    };
  });
}

function parseAppStep(stepEl: XmlEl, knownType: 'Navigate' | 'Read' | 'Write' | 'WaitStart', path: string, warnings: ParseWarning[]): {
  elementId: string | null;
  actionOrProperty: string | null;
  arguments: Record<string, string>;
  storeIn: string | null;
  expression: string | null;
} {
  const elementEl = checkPayloadEl(child(stepEl, 'element'), path, warnings);
  const elementId = elementEl ? attr(elementEl, 'id') : null;

  let actionOrProperty: string | null = null;
  if (knownType === 'WaitStart') {
    const conditionEl = checkPayloadEl(child(stepEl, 'condition'), path, warnings);
    actionOrProperty = conditionEl ? attr(conditionEl, 'name') : null;
  } else {
    const actionEl = checkPayloadEl(child(stepEl, 'action'), path, warnings);
    actionOrProperty = actionEl ? attr(actionEl, 'name') : null;
  }

  const argumentValues: Record<string, string> = {};
  const argsEl = child(stepEl, 'arguments');
  if (argsEl) {
    for (const a of children(argsEl, 'argument')) {
      checkPayloadEl(a, path, warnings);
      const argName = attr(a, 'name');
      if (argName !== null) argumentValues[argName] = text(a);
    }
  }

  const storeInEl = knownType === 'Read' ? child(stepEl, 'storein') : null;
  const exprEl = knownType === 'Write' ? child(stepEl, 'expr') : null;

  return {
    elementId,
    actionOrProperty,
    arguments: argumentValues,
    storeIn: storeInEl ? text(storeInEl) : null,
    expression: exprEl ? text(exprEl) : null,
  };
}

function parsePayload(stageEl: XmlEl, knownType: KnownStageType | null, warnings: ParseWarning[], path: string): StagePayloads {
  if (knownType === null) return {};

  switch (knownType) {
    case 'Start':
    case 'End':
    case 'Anchor':
    case 'Note':
    case 'Recover':
    case 'Resume':
    case 'ChoiceEnd':
    case 'WaitEnd':
    case 'LoopEnd':
    case 'Block':
    case 'SubSheetInfo':
    case 'ProcessInfo':
    case 'ChoiceStart':
    case 'LoopStart':
      return {};

    case 'Decision': {
      const el = checkPayloadEl(child(stageEl, 'decision'), path, warnings);
      if (!el) warnings.push(makeWarning('missing-expected', 'Decision stage missing <decision> element', path, stageEl));
      return { decision: { expression: el ? (attr(el, 'expression') ?? '') : '' } };
    }

    case 'Calculation': {
      const el = checkPayloadEl(child(stageEl, 'calculation'), path, warnings);
      if (!el) warnings.push(makeWarning('missing-expected', 'Calculation stage missing <calculation> element', path, stageEl));
      return { calculation: { expression: el ? (attr(el, 'expression') ?? '') : '', storeIn: el ? attr(el, 'stage') : null } };
    }

    case 'MultipleCalculation': {
      const stepsEl = child(stageEl, 'steps');
      const steps = stepsEl
        ? children(stepsEl, 'calculation').map((c) => {
            checkPayloadEl(c, path, warnings);
            return { expression: attr(c, 'expression') ?? '', storeIn: attr(c, 'stage') };
          })
        : [];
      return { multipleCalculation: { steps } };
    }

    case 'Data':
    case 'Collection': {
      const dataTypeEl = child(stageEl, 'datatype');
      const initialValueEl = child(stageEl, 'initialvalue');
      const exposureEl = child(stageEl, 'exposure');
      const fieldsEl = child(stageEl, 'collectioninfo');
      const fields = fieldsEl
        ? children(fieldsEl, 'field').map((f) => {
            checkPayloadEl(f, path, warnings);
            return { name: attr(f, 'name') ?? '', dataType: attr(f, 'type') };
          })
        : [];

      return {
        data: {
          dataType: dataTypeEl ? text(dataTypeEl) : null,
          initialValue: initialValueEl ? text(initialValueEl) : null,
          exposure: exposureEl ? text(exposureEl) : 'None',
          alwaysInit: child(stageEl, 'alwaysinit') !== null,
          fields,
        },
      };
    }

    case 'Action': {
      const resourceEl = checkPayloadEl(child(stageEl, 'resource'), path, warnings);
      if (!resourceEl) warnings.push(makeWarning('missing-expected', 'Action stage missing <resource> element', path, stageEl));
      return {
        action: {
          objectName: resourceEl ? (attr(resourceEl, 'object') ?? '') : '',
          actionName: resourceEl ? (attr(resourceEl, 'action') ?? '') : '',
          inputs: parseParams(stageEl, 'input', path, warnings),
          outputs: parseParams(stageEl, 'output', path, warnings),
        },
      };
    }

    case 'SubSheet': {
      const targetEl = checkPayloadEl(child(stageEl, 'target'), path, warnings);
      if (!targetEl) warnings.push(makeWarning('missing-expected', 'SubSheet stage missing <target> element', path, stageEl));
      return {
        subsheetRef: {
          subsheetId: targetEl ? attr(targetEl, 'subsheetid') : null,
          processName: null,
          processId: null,
          inputs: parseParams(stageEl, 'input', path, warnings),
          outputs: parseParams(stageEl, 'output', path, warnings),
        },
      };
    }

    case 'Process': {
      const targetEl = checkPayloadEl(child(stageEl, 'target'), path, warnings);
      if (!targetEl) warnings.push(makeWarning('missing-expected', 'Process stage missing <target> element', path, stageEl));
      return {
        subsheetRef: {
          subsheetId: null,
          processName: targetEl ? attr(targetEl, 'processname') : null,
          processId: targetEl ? attr(targetEl, 'processid') : null,
          inputs: parseParams(stageEl, 'input', path, warnings),
          outputs: parseParams(stageEl, 'output', path, warnings),
        },
      };
    }

    case 'Code': {
      const codeEl = checkPayloadEl(child(stageEl, 'code'), path, warnings);
      if (!codeEl) warnings.push(makeWarning('missing-expected', 'Code stage missing <code> element', path, stageEl));
      return {
        code: {
          language: codeEl ? attr(codeEl, 'language') : null,
          code: codeEl ? text(codeEl) : '',
          inputs: parseParams(stageEl, 'input', path, warnings),
          outputs: parseParams(stageEl, 'output', path, warnings),
        },
      };
    }

    case 'Navigate':
    case 'Read':
    case 'Write':
    case 'WaitStart': {
      const timeoutEl = child(stageEl, 'timeout');
      const steps = children(stageEl, 'step').map((s) => parseAppStep(s, knownType, path, warnings));
      return { appSteps: { steps, timeout: timeoutEl ? text(timeoutEl) : null } };
    }

    case 'Exception': {
      const el = checkPayloadEl(child(stageEl, 'exception'), path, warnings);
      if (!el) warnings.push(makeWarning('missing-expected', 'Exception stage missing <exception> element', path, stageEl));
      return {
        exception: {
          exceptionType: el ? attr(el, 'type') : null,
          detail: el ? attr(el, 'detail') : null,
          useCurrent: el ? boolAttr(el, 'usecurrent') : false,
          savedetail: el ? boolAttr(el, 'savedetail') : false,
        },
      };
    }

    case 'Alert': {
      const el = checkPayloadEl(child(stageEl, 'alert'), path, warnings);
      if (!el) warnings.push(makeWarning('missing-expected', 'Alert stage missing <alert> element', path, stageEl));
      return { alert: { expression: el ? attr(el, 'expression') : null } };
    }

    default: {
      const exhaustive: never = knownType;
      throw new Error(`unreachable known stage type: ${String(exhaustive)}`);
    }
  }
}

function parseStage(stageEl: XmlEl, warnings: ParseWarning[], ownerPath: string): ParsedStage {
  const name = attr(stageEl, 'name') ?? '';
  const rawType = attr(stageEl, 'type') ?? '';
  const knownType = narrowStageType(rawType);
  const path = `${ownerPath}/stage[${name}]`;

  warnUnknownAttributes(stageEl, STAGE_ATTRS, path, warnings);
  warnUnknownChildren(stageEl, expectedStageChildren(knownType), path, warnings);

  if (knownType === null && rawType !== '') {
    warnings.push(makeWarning('unknown-stage-type', `unrecognised stage type '${rawType}'`, path, stageEl));
  }

  const narrativeEl = child(stageEl, 'narrative');
  const subsheetIdEl = child(stageEl, 'subsheetid');
  const displayEl = checkPayloadEl(child(stageEl, 'display'), path, warnings);

  let display: StageDisplay | null = null;
  if (displayEl) {
    const wAttr = attr(displayEl, 'w');
    const hAttr = attr(displayEl, 'h');
    display = {
      x: Number(attr(displayEl, 'x') ?? '0'),
      y: Number(attr(displayEl, 'y') ?? '0'),
      width: wAttr !== null ? Number(wAttr) : undefined,
      height: hAttr !== null ? Number(hAttr) : undefined,
    };
  }

  const onSuccessEl = child(stageEl, 'onsuccess');
  const onTrueEl = child(stageEl, 'ontrue');
  const onFalseEl = child(stageEl, 'onfalse');

  const links: StageLinks = {
    onSuccess: onSuccessEl ? text(onSuccessEl) : null,
    onTrue: onTrueEl ? text(onTrueEl) : null,
    onFalse: onFalseEl ? text(onFalseEl) : null,
    choices: children(stageEl, 'choice').map((c) => {
      checkPayloadEl(c, path, warnings);
      return {
        name: attr(c, 'name') ?? '',
        expression: attr(c, 'expression') ?? '',
        target: attr(c, 'ontrue'),
      };
    }),
  };

  const payload = parsePayload(stageEl, knownType, warnings, path);

  return {
    stageId: attr(stageEl, 'stageid') ?? '',
    name,
    type: rawType,
    knownType,
    narrative: narrativeEl ? text(narrativeEl) : null,
    subsheetId: subsheetIdEl ? text(subsheetIdEl) : null,
    display,
    loggingInhibited: child(stageEl, 'loginhibit') !== null,
    links,
    ...payload,
  };
}

function parseAppModelElements(el: XmlEl, ancestorPath: string): AppModelElement[] {
  const results: AppModelElement[] = [];
  for (const elChild of children(el, 'element')) {
    const name = attr(elChild, 'name') ?? '';
    const path = ancestorPath ? `${ancestorPath}/${name}` : name;
    const typeEl = child(elChild, 'type');

    results.push({
      elementId: attr(elChild, 'id') ?? '',
      name,
      path,
      elementType: typeEl ? text(typeEl) : null,
    });
    results.push(...parseAppModelElements(elChild, path));
  }
  return results;
}

function parseAppDef(appDefEl: XmlEl): ParsedAppModel {
  const nameEl = child(appDefEl, 'applicationname');
  return {
    applicationName: nameEl ? text(nameEl) : null,
    elements: parseAppModelElements(appDefEl, ''),
  };
}

function parseProcessLike(wrapperEl: XmlEl, kind: 'process' | 'object', warnings: ParseWarning[]): ParsedProcess {
  const wrapperPath = `bpr:${kind}[${attr(wrapperEl, 'name') ?? '?'}]`;
  warnUnknownAttributes(wrapperEl, WRAPPER_ATTRS, wrapperPath, warnings);

  let defEl = child(wrapperEl, 'process');

  if (!defEl) {
    // Some real exports escape the entire inner <process> definition as
    // text rather than nesting it as XML. Detect and re-parse it.
    const raw = wrapperEl.text.trim();
    if (raw.length > 0 && raw.startsWith('<')) {
      try {
        defEl = parseXmlDocument(raw);
      } catch (err) {
        warnings.push({
          code: 'escaped-process-parse-failed',
          message: `embedded process definition text could not be re-parsed: ${err instanceof Error ? err.message : String(err)}`,
          path: wrapperPath,
          line: wrapperEl.line,
          column: wrapperEl.column,
        });
      }
    }
  }

  if (!defEl) {
    warnings.push({
      code: 'missing-expected',
      message: `no inner <process> definition found for '${attr(wrapperEl, 'name') ?? ''}'`,
      path: wrapperPath,
      line: wrapperEl.line,
      column: wrapperEl.column,
    });

    return {
      kind,
      id: attr(wrapperEl, 'id') ?? '',
      name: attr(wrapperEl, 'name') ?? '',
      version: null,
      bpversion: attr(wrapperEl, 'bpversion'),
      narrative: null,
      published: false,
      pages: [],
      appModel: null,
    };
  }

  warnUnknownAttributes(defEl, INNER_PROCESS_ATTRS, wrapperPath, warnings);
  warnUnknownChildren(defEl, INNER_PROCESS_CHILDREN, wrapperPath, warnings);

  const pages: ParsedPage[] = [];
  const pageById = new Map<string, ParsedPage>();

  for (const subsheetEl of children(defEl, 'subsheet')) {
    warnUnknownAttributes(subsheetEl, SUBSHEET_ATTRS, `${wrapperPath}/subsheet`, warnings);
    warnUnknownChildren(subsheetEl, SUBSHEET_CHILDREN, `${wrapperPath}/subsheet`, warnings);

    const subsheetId = attr(subsheetEl, 'subsheetid') ?? '';
    const nameEl = child(subsheetEl, 'name');
    const page: ParsedPage = {
      subsheetId,
      name: nameEl ? text(nameEl) : '',
      type: attr(subsheetEl, 'type') ?? 'Normal',
      published: boolAttr(subsheetEl, 'published'),
      stages: [],
    };
    pages.push(page);
    pageById.set(subsheetId, page);
  }

  let appModel: ParsedAppModel | null = null;
  const appDefEl = child(defEl, 'appdef');
  if (appDefEl) appModel = parseAppDef(appDefEl);

  for (const stageEl of children(defEl, 'stage')) {
    const stage = parseStage(stageEl, warnings, wrapperPath);
    const owner = stage.subsheetId !== null ? pageById.get(stage.subsheetId) : undefined;

    if (owner) {
      owner.stages.push(stage);
    } else {
      warnings.push({
        code: 'orphan-stage',
        message: `stage '${stage.name}' has no matching subsheet (subsheetid '${stage.subsheetId ?? ''}')`,
        path: `${wrapperPath}/stage[${stage.name}]`,
        line: stageEl.line,
        column: stageEl.column,
      });
    }
  }

  return {
    kind,
    id: attr(wrapperEl, 'id') ?? attr(defEl, 'id') ?? '',
    name: attr(wrapperEl, 'name') ?? attr(defEl, 'name') ?? '',
    version: attr(defEl, 'version'),
    bpversion: attr(wrapperEl, 'bpversion') ?? attr(defEl, 'bpversion'),
    narrative: attr(defEl, 'narrative'),
    // ParsedProcess.published has no single dedicated XML attribute in the
    // exported format; it is derived here as "has at least one published
    // page", which is the property the UI actually cares about (published
    // pages are business object actions).
    published: pages.some((p) => p.published),
    pages,
    appModel: kind === 'object' ? appModel : null,
  };
}

function parseWorkQueue(el: XmlEl, warnings: ParseWarning[]): ParsedWorkQueue {
  const path = `bpr:work-queue[${attr(el, 'name') ?? '?'}]`;
  warnUnknownAttributes(el, QUEUE_ATTRS, path, warnings);
  warnUnknownChildren(el, QUEUE_CHILDREN, path, warnings);

  const keyFieldEl = child(el, 'keyfield');
  const maxAttemptsEl = child(el, 'maxattempts');

  return {
    id: attr(el, 'id') ?? '',
    name: attr(el, 'name') ?? '',
    keyField: keyFieldEl ? text(keyFieldEl) : null,
    maxAttempts: maxAttemptsEl ? Number(text(maxAttemptsEl)) : null,
  };
}

function parseEnvironmentVariable(el: XmlEl, warnings: ParseWarning[]): ParsedEnvironmentVariable {
  const path = `bpr:environment-variable[${attr(el, 'name') ?? '?'}]`;
  warnUnknownAttributes(el, ENVVAR_ATTRS, path, warnings);
  warnUnknownChildren(el, new Set<string>(), path, warnings);

  return {
    name: attr(el, 'name') ?? '',
    dataType: attr(el, 'datatype'),
    value: attr(el, 'value'),
    description: attr(el, 'description'),
  };
}

function parseCredential(el: XmlEl, warnings: ParseWarning[]): ParsedCredential {
  const path = `bpr:credential[${attr(el, 'name') ?? '?'}]`;
  warnUnknownAttributes(el, CREDENTIAL_ATTRS, path, warnings);
  warnUnknownChildren(el, CREDENTIAL_CHILDREN, path, warnings);

  const descEl = child(el, 'description');
  return {
    id: attr(el, 'id') ?? '',
    name: attr(el, 'name') ?? '',
    description: descEl ? text(descEl) : null,
  };
}

/**
 * Parses one .bprelease file's XML text into a ParsedRelease. Never throws:
 * malformed XML or an unexpected root element yields `{ ok: false }` with a
 * structured, actionable failure; everything else the parser doesn't
 * recognise is recorded as a warning on an otherwise successful parse.
 */
export function parseRelease(input: ParseReleaseInput): ParseOutcome {
  let root: XmlEl;
  try {
    root = parseXmlDocument(input.content);
  } catch (err) {
    if (err instanceof XmlParseError) {
      return {
        ok: false,
        failure: { fileName: input.fileName, contentHash: input.contentHash, reason: err.message, line: err.line, column: err.column },
      };
    }
    return {
      ok: false,
      failure: { fileName: input.fileName, contentHash: input.contentHash, reason: err instanceof Error ? err.message : 'unknown parse error' },
    };
  }

  if (root.name !== 'release') {
    return {
      ok: false,
      failure: {
        fileName: input.fileName,
        contentHash: input.contentHash,
        reason: `unexpected root element '<${root.rawName}>', expected 'release' (any namespace prefix)`,
        line: root.line,
        column: root.column,
      },
    };
  }

  const warnings: ParseWarning[] = [];
  warnUnknownAttributes(root, ROOT_ATTRS, 'bpr:release', warnings);

  const file: SourceFileMeta = {
    fileName: input.fileName,
    contentHash: input.contentHash,
    byteSize: input.byteSize,
    importedAt: input.importedAt,
  };

  const nameEl = child(root, 'name');
  const packageNameEl = child(root, 'package-name');
  const createdEl = child(root, 'created');

  const processes: ParsedProcess[] = [];
  const objects: ParsedProcess[] = [];
  const workQueues: ParsedWorkQueue[] = [];
  const environmentVariables: ParsedEnvironmentVariable[] = [];
  const credentials: ParsedCredential[] = [];
  const otherItems: ParsedOtherItem[] = [];

  for (const el of root.children) {
    if (OTHER_ITEM_NAMES.has(el.name)) {
      otherItems.push({ itemType: el.name, name: attr(el, 'name') ?? '' });
      continue;
    }

    switch (el.name) {
      case 'name':
      case 'release-notes':
      case 'created':
      case 'package-id':
      case 'package-name':
      case 'user-created-by':
      case 'contents':
        // Recognised, but either read separately (header fields) or a pure
        // manifest of items fully defined elsewhere (contents).
        break;

      case 'process':
        processes.push(parseProcessLike(el, 'process', warnings));
        break;

      case 'object':
        objects.push(parseProcessLike(el, 'object', warnings));
        break;

      case 'work-queue':
        workQueues.push(parseWorkQueue(el, warnings));
        break;

      case 'environment-variable':
        environmentVariables.push(parseEnvironmentVariable(el, warnings));
        break;

      case 'credential':
        credentials.push(parseCredential(el, warnings));
        break;

      default:
        warnings.push(makeWarning('unknown-element', `unrecognised top-level element '<${el.rawName}>'`, `bpr:release/${el.rawName}`, el));
        break;
    }
  }

  const release: ParsedRelease = {
    file,
    releaseName: nameEl ? text(nameEl) : null,
    packageName: packageNameEl ? text(packageNameEl) : null,
    created: createdEl ? text(createdEl) : null,
    processes,
    objects,
    workQueues,
    environmentVariables,
    credentials,
    otherItems,
    warnings,
  };

  return { ok: true, release };
}

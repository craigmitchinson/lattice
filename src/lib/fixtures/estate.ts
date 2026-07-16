/**
 * Generates a synthetic, realistically-shaped multi-file .bprelease estate:
 * shared objects consumed by many processes, work queues, environment
 * variables, credentials, application-model usage, a couple of duplicate
 * items and a couple of unresolved references. Used for the discovery and
 * parser performance smoke tests. Fully deterministic given (fileCount, seed)
 * via a small PRNG; never uses Math.random.
 */

import { buildReleaseXml } from './buildXml';
import type { AppDefSpec, ObjectSpec, PageSpec, ProcessSpec, ReleaseSpec, StageSpec } from './spec';

export interface EstateFile {
  fileName: string;
  xml: string;
}

/** mulberry32: a small, fast, deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  const idx = Math.min(arr.length - 1, Math.floor(rng() * arr.length));
  const value = arr[idx];
  if (value === undefined) throw new Error('estate generator: pick from an empty array');
  return value;
}

const SHARED_OBJECT_NAMES = ['Data Access Object', 'Email Object', 'SAP Object', 'Excel Object', 'Utility Object'] as const;
const UNRESOLVED_OBJECT_NAMES = ['Legacy Mainframe Object', 'Retired Scheduler Object'] as const;
const QUEUE_NAMES = ['Invoices', 'Refunds', 'Onboarding'] as const;
const ENV_VAR_NAMES = ['Environment Name', 'Config Threshold'] as const;
const CREDENTIAL_NAMES = ['SAP Login', 'Email Login'] as const;
const PROCESS_TOPICS = ['Invoice', 'Payroll', 'Onboarding', 'Reconciliation', 'Reporting', 'Claims', 'Procurement', 'Renewals'] as const;

function chainSequential(stages: StageSpec[]): StageSpec[] {
  return stages.map((s, i) => {
    const next = stages[i + 1];
    if (!next || s.onSuccess !== undefined || s.type === 'Decision' || s.type === 'End') return s;
    return { ...s, onSuccess: next.name };
  });
}

let stageCounter = 0;
function nextStageName(prefix: string): string {
  stageCounter += 1;
  return `${prefix} ${stageCounter}`;
}

function buildFillerStage(
  rng: () => number,
  display: { x: number; y: number },
  pageStageNames: string[],
  elementNames: string[],
): StageSpec {
  const roll = rng();

  if (roll < 0.3) {
    return {
      name: nextStageName('Data'),
      type: 'Data',
      display,
      loginhibit: rng() < 0.05,
      payload: { kind: 'data', dataType: pick(rng, ['text', 'number', 'flag', 'date']), initialValue: '', exposure: 'None' },
    };
  }

  if (roll < 0.5) {
    return {
      name: nextStageName('Calc'),
      type: 'Calculation',
      display,
      payload: { kind: 'calculation', expression: '[a]+[b]', storeIn: 'Result' },
    };
  }

  if (roll < 0.75) {
    const useUnresolved = rng() < 0.08;
    const useEnvVarAction = rng() < 0.1;
    const useQueue = rng() < 0.15;
    const useCredential = rng() < 0.1;

    let objectName: string;
    let actionName: string;
    const inputs: { name: string; dataType?: string; expr?: string }[] = [];

    if (useQueue) {
      objectName = 'Work Queues';
      actionName = 'Add To Queue';
      const literal = rng() < 0.8;
      inputs.push({
        name: 'Queue Name',
        dataType: 'text',
        expr: literal ? `"${pick(rng, QUEUE_NAMES)}"` : '[Queue Name Variable]',
      });
    } else if (useCredential) {
      objectName = 'Credentials';
      actionName = 'Get Credential';
      inputs.push({ name: 'Credential Name', dataType: 'text', expr: `"${pick(rng, CREDENTIAL_NAMES)}"` });
    } else if (useUnresolved) {
      objectName = pick(rng, UNRESOLVED_OBJECT_NAMES);
      actionName = 'Do Legacy Thing';
    } else if (useEnvVarAction) {
      objectName = pick(rng, SHARED_OBJECT_NAMES);
      actionName = 'Configure';
      inputs.push({ name: 'Setting', dataType: 'text', expr: `[${pick(rng, ENV_VAR_NAMES)}]` });
    } else {
      objectName = pick(rng, SHARED_OBJECT_NAMES);
      actionName = pick(rng, ['Process Record', 'Send', 'Fetch', 'Validate']);
    }

    return {
      name: nextStageName('Call'),
      type: 'Action',
      display,
      payload: { kind: 'action', objectName, actionName, inputs },
    };
  }

  if (roll < 0.85 && elementNames.length > 0) {
    const el = pick(rng, elementNames);
    const stageType = pick(rng, ['Navigate', 'Read', 'Write'] as const);
    if (stageType === 'Navigate') {
      return {
        name: nextStageName('Navigate'),
        type: 'Navigate',
        display,
        payload: { kind: 'appSteps', steps: [{ elementRef: el, actionOrCondition: 'ClickCentre' }] },
      };
    }
    if (stageType === 'Read') {
      return {
        name: nextStageName('Read'),
        type: 'Read',
        display,
        payload: { kind: 'appSteps', steps: [{ elementRef: el, actionOrCondition: 'Text', storeIn: 'Read Value' }] },
      };
    }
    return {
      name: nextStageName('Write'),
      type: 'Write',
      display,
      payload: { kind: 'appSteps', steps: [{ elementRef: el, actionOrCondition: 'Text', expr: '"value"' }] },
    };
  }

  if (roll < 0.93 && pageStageNames.length > 0) {
    const fallback = pageStageNames[pageStageNames.length - 1] ?? 'End';
    return {
      name: nextStageName('Decision'),
      type: 'Decision',
      display,
      onTrue: fallback,
      onFalse: fallback,
      payload: { kind: 'decision', expression: '[x]>0' },
    };
  }

  return { name: nextStageName('Note'), type: 'Note', narrative: 'Generated filler annotation.', display };
}

function buildPage(rng: () => number, name: string, type: string, published: boolean, elementNames: string[]): PageSpec {
  const stageCount = randInt(rng, 10, 40);
  const stages: StageSpec[] = [{ name: 'Start', type: 'Start', display: { x: 20, y: 20 } }];

  for (let i = 0; i < stageCount - 2; i += 1) {
    const display = { x: 20 + (i + 1) * 60, y: 20 + (i % 4) * 40 };
    stages.push(buildFillerStage(rng, display, stages.map((s) => s.name), elementNames));
  }

  stages.push({ name: 'End', type: 'End', display: { x: 20 + stageCount * 60, y: 20 } });

  return { name, type, published, stages: chainSequential(stages) };
}

function buildAppDef(rng: () => number): AppDefSpec {
  const elementCount = randInt(rng, 3, 6);
  return {
    applicationName: pick(rng, ['SAP GUI', 'Web Browser', 'Mainframe Terminal']),
    elements: [
      {
        name: 'Root',
        elementType: 'Application',
        children: Array.from({ length: elementCount }, (_, i) => ({
          name: `Element ${i + 1}`,
          elementType: pick(rng, ['Button', 'Field', 'Window', 'ListView']),
        })),
      },
    ],
  };
}

function elementNamesOf(appDef: AppDefSpec): string[] {
  const names: string[] = [];
  const walk = (els: AppDefSpec['elements']) => {
    for (const el of els) {
      names.push(el.name);
      if (el.children) walk(el.children);
    }
  };
  walk(appDef.elements);
  return names;
}

function buildProcessOrObject(rng: () => number, name: string, asObject: boolean, version: string): ProcessSpec | ObjectSpec {
  const pageCount = randInt(rng, 3, 8);
  const appDef = asObject ? buildAppDef(rng) : undefined;
  const elementNames = appDef ? elementNamesOf(appDef) : [];

  const pages: PageSpec[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    const type = i === 0 ? 'MainPage' : pick(rng, ['Normal', 'Normal', 'Normal', 'CleanUp']);
    const published = asObject && i > 0 && rng() < 0.6;
    pages.push(buildPage(rng, i === 0 ? 'Main Page' : `Page ${i + 1}`, type, published, elementNames));
  }

  const base: ProcessSpec = {
    name,
    version,
    bpversion: pick(rng, ['7.1.0', '7.2.0', '7.2.1', '7.3.0']),
    pages,
  };

  return asObject ? { ...base, appDef } : base;
}

function buildSharedLibraryFile(rng: () => number): EstateFile {
  const objects: ObjectSpec[] = SHARED_OBJECT_NAMES.map((objName) => buildProcessOrObject(rng, objName, true, '1.0') as ObjectSpec);

  const spec: ReleaseSpec = {
    name: 'Shared Library Release',
    packageName: 'shared-library',
    created: '2025-01-06T09:00:00Z',
    objects,
    workQueues: QUEUE_NAMES.map((qName) => ({ name: qName, keyField: 'Reference', maxAttempts: 3 })),
    environmentVariables: ENV_VAR_NAMES.map((vName) => ({ name: vName, dataType: 'text', value: 'default', description: 'Shared configuration value.' })),
    credentials: CREDENTIAL_NAMES.map((cName) => ({ name: cName, description: 'Shared credential.' })),
  };

  return { fileName: 'shared-library.bprelease', xml: buildReleaseXml(spec) };
}

/**
 * Generates `fileCount` synthetic .bprelease files forming one mixed
 * estate: a shared-library file of business objects consumed throughout,
 * a handful of processes per remaining file, a duplicate process pair, and
 * scattered unresolved/dynamic references. Deterministic for a given
 * (fileCount, seed) pair.
 */
export function syntheticEstate(fileCount: number, seed: number): EstateFile[] {
  if (fileCount < 1) return [];

  const rng = mulberry32(seed);
  stageCounter = 0;

  const files: EstateFile[] = [buildSharedLibraryFile(rng)];

  const duplicatePage: PageSpec = {
    name: 'Main Page',
    type: 'MainPage',
    stages: chainSequential([
      { name: 'Start', type: 'Start', display: { x: 20, y: 20 } },
      { name: 'End', type: 'End', display: { x: 100, y: 20 } },
    ]),
  };

  for (let i = 1; i < fileCount; i += 1) {
    if (fileCount >= 3 && (i === 1 || i === 2)) {
      const version = i === 1 ? '1.0' : '1.1';
      const spec: ReleaseSpec = {
        name: `Shared Utility Process Release ${version}`,
        created: `2025-0${i}-10T09:00:00Z`,
        processes: [{ name: 'Shared Utility Process', version, bpversion: '7.2.1', pages: [duplicatePage] }],
      };
      files.push({ fileName: `duplicate-${i}.bprelease`, xml: buildReleaseXml(spec) });
      continue;
    }

    const topic = pick(rng, PROCESS_TOPICS);
    const asObject = rng() < 0.15;
    const name = `${topic} ${asObject ? 'Object' : 'Process'} ${i}`;
    const item = buildProcessOrObject(rng, name, asObject, `1.${randInt(rng, 0, 4)}`);

    const spec: ReleaseSpec = {
      name: `${name} Release`,
      created: `2025-02-${String(randInt(rng, 1, 28)).padStart(2, '0')}T${String(randInt(rng, 0, 23)).padStart(2, '0')}:00:00Z`,
      processes: asObject ? [] : [item as ProcessSpec],
      objects: asObject ? [item as ObjectSpec] : [],
    };

    files.push({ fileName: `estate-${i}.bprelease`, xml: buildReleaseXml(spec) });
  }

  return files;
}

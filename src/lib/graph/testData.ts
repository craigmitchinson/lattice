/**
 * Small, fully-typed factory helpers for building ParsedRelease fixtures by
 * hand in tests. Deliberately independent of the fixture generator, parser
 * and discovery modules (owned by a concurrent agent) - see the task brief.
 *
 * Every factory takes a partial override object and fills in sensible
 * defaults, so call sites only need to specify what matters for the test.
 */

import type {
  ActionParameter,
  ActionPayload,
  AppModelElement,
  AppStep,
  AppStepsPayload,
  ChoiceLink,
  DataPayload,
  ParsedAppModel,
  ParsedCredential,
  ParsedEnvironmentVariable,
  ParsedPage,
  ParsedProcess,
  ParsedRelease,
  ParsedStage,
  ParsedWorkQueue,
  SourceFileMeta,
  SubsheetRefPayload,
} from '../model/types.ts';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Resets the auto-id counter. Call from a test's beforeEach for deterministic ids if needed. */
export function resetTestDataCounter(): void {
  counter = 0;
}

export function makeSourceFileMeta(overrides: Partial<SourceFileMeta> = {}): SourceFileMeta {
  const id = nextId('file');
  return {
    fileName: `${id}.bprelease`,
    contentHash: `hash-${id}`,
    byteSize: 1024,
    importedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeRelease(overrides: Partial<ParsedRelease> = {}): ParsedRelease {
  return {
    file: makeSourceFileMeta(),
    releaseName: 'Test Release',
    packageName: null,
    created: '2024-01-01T00:00:00Z',
    processes: [],
    objects: [],
    workQueues: [],
    environmentVariables: [],
    credentials: [],
    otherItems: [],
    warnings: [],
    ...overrides,
  };
}

function makeItem(kind: 'process' | 'object', overrides: Partial<ParsedProcess>): ParsedProcess {
  const id = nextId(kind);
  return {
    kind,
    id,
    name: `${kind === 'process' ? 'Process' : 'Object'} ${id}`,
    version: '1.0',
    bpversion: '7.1',
    narrative: null,
    published: true,
    pages: [],
    appModel: kind === 'object' ? null : null,
    ...overrides,
  };
}

export function makeProcess(overrides: Partial<ParsedProcess> = {}): ParsedProcess {
  return makeItem('process', overrides);
}

export function makeObject(overrides: Partial<ParsedProcess> = {}): ParsedProcess {
  return makeItem('object', overrides);
}

export function makePage(overrides: Partial<ParsedPage> = {}): ParsedPage {
  const id = nextId('page');
  return {
    subsheetId: id,
    name: `Page ${id}`,
    type: 'Normal',
    published: false,
    stages: [],
    ...overrides,
  };
}

export function makeStage(overrides: Partial<ParsedStage> = {}): ParsedStage {
  const id = nextId('stage');
  return {
    stageId: id,
    name: `Stage ${id}`,
    type: 'Calculation',
    knownType: 'Calculation',
    narrative: null,
    subsheetId: null,
    display: null,
    loggingInhibited: false,
    links: { onSuccess: null, onTrue: null, onFalse: null, choices: [] },
    ...overrides,
  };
}

export function makeActionParameter(overrides: Partial<ActionParameter> = {}): ActionParameter {
  return {
    name: 'Param',
    dataType: null,
    expression: null,
    storeIn: null,
    ...overrides,
  };
}

export function makeChoiceLink(overrides: Partial<ChoiceLink> = {}): ChoiceLink {
  return {
    name: 'Choice',
    expression: 'True',
    target: null,
    ...overrides,
  };
}

/** An Action-type stage. Pass `action` overrides to control the target/inputs/outputs. */
export function makeActionStage(
  overrides: Partial<Omit<ParsedStage, 'action'>> & { action?: Partial<ActionPayload> } = {},
): ParsedStage {
  const { action, ...rest } = overrides;
  const payload: ActionPayload = {
    objectName: 'Some Object',
    actionName: 'Some Action',
    inputs: [],
    outputs: [],
    ...action,
  };
  return makeStage({
    type: 'Action',
    knownType: 'Action',
    ...rest,
    action: payload,
  });
}

/** A SubSheet/Process-type stage. Pass `subsheetRef` overrides to control internal vs cross-process calls. */
export function makeSubsheetRefStage(
  overrides: Partial<Omit<ParsedStage, 'subsheetRef'>> & { subsheetRef?: Partial<SubsheetRefPayload> } = {},
): ParsedStage {
  const { subsheetRef, ...rest } = overrides;
  const payload: SubsheetRefPayload = {
    subsheetId: null,
    processName: null,
    processId: null,
    inputs: [],
    outputs: [],
    ...subsheetRef,
  };
  return makeStage({
    type: 'SubSheet',
    knownType: 'SubSheet',
    ...rest,
    subsheetRef: payload,
  });
}

/** A Data/Collection-type stage. Pass `data` overrides to control exposure/type. */
export function makeDataStage(
  overrides: Partial<Omit<ParsedStage, 'data'>> & { data?: Partial<DataPayload> } = {},
): ParsedStage {
  const { data, ...rest } = overrides;
  const payload: DataPayload = {
    dataType: 'Text',
    initialValue: null,
    exposure: 'none',
    alwaysInit: false,
    fields: [],
    ...data,
  };
  return makeStage({
    type: 'Data',
    knownType: 'Data',
    ...rest,
    data: payload,
  });
}

export function makeAppStep(overrides: Partial<AppStep> = {}): AppStep {
  return {
    elementId: null,
    actionOrProperty: null,
    arguments: {},
    storeIn: null,
    expression: null,
    ...overrides,
  };
}

/** A Navigate/Read/Write/WaitStart-type stage. Pass `appSteps` overrides to control the steps. */
export function makeAppStepStage(
  overrides: Partial<Omit<ParsedStage, 'appSteps'>> & { appSteps?: Partial<AppStepsPayload> } = {},
): ParsedStage {
  const { appSteps, ...rest } = overrides;
  const payload: AppStepsPayload = {
    steps: [],
    timeout: null,
    ...appSteps,
  };
  return makeStage({
    type: 'Navigate',
    knownType: 'Navigate',
    ...rest,
    appSteps: payload,
  });
}

export function makeQueue(overrides: Partial<ParsedWorkQueue> = {}): ParsedWorkQueue {
  const id = nextId('queue');
  return {
    id,
    name: `Queue ${id}`,
    keyField: null,
    maxAttempts: null,
    ...overrides,
  };
}

export function makeEnvVar(overrides: Partial<ParsedEnvironmentVariable> = {}): ParsedEnvironmentVariable {
  const id = nextId('envvar');
  return {
    name: `EnvVar ${id}`,
    dataType: null,
    value: null,
    description: null,
    ...overrides,
  };
}

export function makeCredential(overrides: Partial<ParsedCredential> = {}): ParsedCredential {
  const id = nextId('credential');
  return {
    id,
    name: `Credential ${id}`,
    description: null,
    ...overrides,
  };
}

export function makeAppModelElement(overrides: Partial<AppModelElement> = {}): AppModelElement {
  const id = nextId('element');
  return {
    elementId: id,
    name: `Element ${id}`,
    path: `Element ${id}`,
    elementType: 'Button',
    ...overrides,
  };
}

export function makeAppModel(overrides: Partial<ParsedAppModel> = {}): ParsedAppModel {
  return {
    applicationName: 'Test Application',
    elements: [],
    ...overrides,
  };
}

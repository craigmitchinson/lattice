import { describe, expect, it } from 'vitest';
import { buildReleaseXml } from '../fixtures/buildXml';
import { malformedFixtures } from '../fixtures/malformed';
import {
  duplicateItemReleases,
  dynamicRefsRelease,
  envVarRelease,
  escapedEmbeddedProcessRelease,
  everyStageTypeRelease,
  queueAndCredentialRelease,
  unknownContentRelease,
  unresolvedRefsRelease,
} from '../fixtures/presets';
import type { ParsedProcess, ParsedStage, ParseWarning } from '../model/types';
import type { ParseOutcome } from './parseRelease';
import { parseRelease } from './parseRelease';

function parseXmlText(fileName: string, xml: string): ParseOutcome {
  return parseRelease({
    fileName,
    content: xml,
    contentHash: `hash-of-${fileName}`,
    byteSize: xml.length,
    importedAt: '2026-07-16T09:00:00Z',
  });
}

function assertDefined<T>(value: T | undefined | null, message?: string): T {
  if (value === undefined || value === null) {
    throw new Error(message ?? 'expected value to be defined');
  }
  return value;
}

function findProcess(processes: ParsedProcess[], name: string): ParsedProcess {
  return assertDefined(
    processes.find((p) => p.name === name),
    `expected to find '${name}'`,
  );
}

function stagesByName(stages: ParsedStage[]): Map<string, ParsedStage> {
  return new Map(stages.map((s) => [s.name, s]));
}

function findWarning(warnings: ParseWarning[], code: string, pathContains: string): ParseWarning | undefined {
  return warnings.find((w) => w.code === code && w.path.includes(pathContains));
}

describe('parseRelease: round-trip every stage type', () => {
  const xml = buildReleaseXml(everyStageTypeRelease());
  const outcome = parseXmlText('every-stage-type.bprelease', xml);

  it('parses successfully', () => {
    expect(outcome.ok).toBe(true);
  });

  if (!outcome.ok) return;
  const { release } = outcome;

  const uiObject = findProcess(release.objects, 'UI Automation Object');
  const utilityObject = findProcess(release.objects, 'Utility Object');
  const companionProcess = findProcess(release.processes, 'Companion Process');

  const mainPage = assertDefined(uiObject.pages.find((p) => p.name === 'Main Page'));
  const stages = stagesByName(mainPage.stages);

  function stage(name: string): ParsedStage {
    return assertDefined(stages.get(name), `expected stage '${name}'`);
  }

  it('preserves object/process metadata', () => {
    expect(uiObject.kind).toBe('object');
    expect(uiObject.version).toBe('1.0');
    expect(uiObject.bpversion).toBe('7.2.1');
    expect(uiObject.narrative).toBe('Exercises every known stage type.');
    expect(companionProcess.kind).toBe('process');
  });

  it('parses the application model with nested elements and paths', () => {
    expect(uiObject.appModel).not.toBeNull();
    const appModel = assertDefined(uiObject.appModel);
    expect(appModel.applicationName).toBe('SAP GUI');
    const byName = new Map(appModel.elements.map((e) => [e.name, e]));
    expect(assertDefined(byName.get('Root')).path).toBe('Root');
    expect(assertDefined(byName.get('Root')).elementType).toBe('Application');
    expect(assertDefined(byName.get('Login Button')).path).toBe('Root/Login Button');
    expect(assertDefined(byName.get('Login Button')).elementType).toBe('Button');
    expect(assertDefined(byName.get('Username Field')).path).toBe('Root/Username Field');
  });

  it('marks Utility Object published because it has a published page', () => {
    expect(utilityObject.published).toBe(true);
  });

  it('marks the UI Automation Object unpublished (no published pages)', () => {
    expect(uiObject.published).toBe(false);
  });

  it('every stage has display coordinates and the correct knownType/type', () => {
    for (const s of mainPage.stages) {
      expect(s.display).not.toBeNull();
      expect(typeof s.display?.x).toBe('number');
      expect(typeof s.display?.y).toBe('number');
      expect(s.knownType).toBe(s.type);
    }
  });

  it('Start Stage links to Decision Stage via onSuccess', () => {
    expect(stage('Start Stage').links.onSuccess).toBe(stage('Decision Stage').stageId);
  });

  it('Decision Stage: expression, onTrue/onFalse links, narrative', () => {
    const s = stage('Decision Stage');
    expect(s.decision).toEqual({ expression: '[Counter]>1' });
    expect(s.links.onTrue).toBe(stage('Calculation Stage').stageId);
    expect(s.links.onFalse).toBe(stage('End Stage').stageId);
    expect(s.narrative).toBe('Branches on the running counter.');
  });

  it('Calculation Stage: expression and storeIn', () => {
    expect(stage('Calculation Stage').calculation).toEqual({ expression: '[a]+[b]', storeIn: 'Result' });
  });

  it('MultipleCalculation Stage: ordered steps', () => {
    expect(stage('MultipleCalculation Stage').multipleCalculation).toEqual({
      steps: [
        { expression: '[a]+[b]', storeIn: 'Result' },
        { expression: '[a]-[b]', storeIn: 'Diff' },
      ],
    });
  });

  it('ChoiceStart Stage: choices with names, expressions and resolved targets', () => {
    const s = stage('ChoiceStart Stage');
    expect(s.links.choices).toEqual([
      { name: 'Option A', expression: '[x]=1', target: stage('ChoiceEnd Stage').stageId },
      { name: 'Option B', expression: '[x]=2', target: stage('Data Stage').stageId },
    ]);
  });

  it('Data Stage: type, initial value, exposure, alwaysInit, narrative', () => {
    const s = stage('Data Stage');
    expect(s.data).toEqual({
      dataType: 'text',
      initialValue: 'Hello',
      exposure: 'Session',
      alwaysInit: true,
      fields: [],
    });
    expect(s.narrative).toBe('A plain data item.');
  });

  it('Collection Stage: field definitions', () => {
    expect(stage('Collection Stage').data).toEqual({
      dataType: null,
      initialValue: null,
      exposure: 'None',
      alwaysInit: false,
      fields: [
        { name: 'Reference', dataType: 'text' },
        { name: 'Amount', dataType: 'number' },
      ],
    });
  });

  it('Action Stage: target object/action, inputs and outputs', () => {
    expect(stage('Action Stage').action).toEqual({
      objectName: 'Utility Object',
      actionName: 'Do Something',
      inputs: [{ name: 'Input1', dataType: 'text', expression: '"value"', storeIn: null }],
      outputs: [{ name: 'Output1', dataType: 'text', expression: null, storeIn: 'Result' }],
    });
  });

  it('SubSheet Stage: resolves the target page id within the same object', () => {
    const utilityPage = assertDefined(uiObject.pages.find((p) => p.name === 'Utility Page'));
    expect(stage('SubSheet Stage').subsheetRef).toEqual({
      subsheetId: utilityPage.subsheetId,
      processName: null,
      processId: null,
      inputs: [],
      outputs: [],
    });
  });

  it('Process Stage: resolves the target process name/id', () => {
    expect(stage('Process Stage').subsheetRef).toEqual({
      subsheetId: null,
      processName: 'Companion Process',
      processId: companionProcess.id,
      inputs: [],
      outputs: [],
    });
  });

  it('Code Stage: language, source, inputs and outputs', () => {
    expect(stage('Code Stage').code).toEqual({
      language: 'csharp',
      code: 'return a + b;',
      inputs: [{ name: 'a', dataType: 'number', expression: '1', storeIn: null }],
      outputs: [{ name: 'result', dataType: 'number', expression: null, storeIn: 'Result' }],
    });
  });

  function elementId(name: string): string {
    const appModel = assertDefined(uiObject.appModel);
    return assertDefined(appModel.elements.find((e) => e.name === name)).elementId;
  }

  it('Navigate Stage: element id, action, arguments', () => {
    expect(stage('Navigate Stage').appSteps).toEqual({
      timeout: null,
      steps: [
        {
          elementId: elementId('Login Button'),
          actionOrProperty: 'ClickCentre',
          arguments: { X: '10' },
          storeIn: null,
          expression: null,
        },
      ],
    });
  });

  it('Read Stage: element id, property, storeIn', () => {
    expect(stage('Read Stage').appSteps).toEqual({
      timeout: null,
      steps: [
        {
          elementId: elementId('Username Field'),
          actionOrProperty: 'Text',
          arguments: {},
          storeIn: 'Username Value',
          expression: null,
        },
      ],
    });
  });

  it('Write Stage: element id, property, expression', () => {
    expect(stage('Write Stage').appSteps).toEqual({
      timeout: null,
      steps: [
        {
          elementId: elementId('Username Field'),
          actionOrProperty: 'Text',
          arguments: {},
          storeIn: null,
          expression: '"admin"',
        },
      ],
    });
  });

  it('WaitStart Stage: timeout and condition step', () => {
    expect(stage('WaitStart Stage').appSteps).toEqual({
      timeout: '5000',
      steps: [{ elementId: elementId('Login Button'), actionOrProperty: 'CheckExists', arguments: {}, storeIn: null, expression: null }],
    });
  });

  it('Exception Stage: type, detail, flags, loginhibit, narrative', () => {
    const s = stage('Exception Stage');
    expect(s.exception).toEqual({ exceptionType: 'System Exception', detail: '"Login failed"', useCurrent: false, savedetail: true });
    expect(s.loggingInhibited).toBe(true);
    expect(s.narrative).toBe('Raised when login fails.');
  });

  it('Alert Stage: expression', () => {
    expect(stage('Alert Stage').alert).toEqual({ expression: '"Something happened"' });
  });

  it('Note Stage: narrative preserved, no payload', () => {
    const s = stage('Note Stage');
    expect(s.narrative).toBe('A free-text annotation.');
    expect(s.alert).toBeUndefined();
  });

  it('purely structural stage types round-trip with knownType set and no payload', () => {
    for (const name of [
      'Start Stage',
      'End Stage',
      'Anchor Stage',
      'Recover Stage',
      'Resume Stage',
      'ChoiceEnd Stage',
      'WaitEnd Stage',
      'LoopEnd Stage',
      'Block Stage',
      'SubSheetInfo Stage',
      'ProcessInfo Stage',
    ]) {
      const s = stage(name);
      expect(s.knownType).not.toBeNull();
      expect(s.action).toBeUndefined();
      expect(s.calculation).toBeUndefined();
      expect(s.decision).toBeUndefined();
    }
  });

  it('LoopStart Stage: knownType set and its <groupinfo> child produces no warning', () => {
    const s = stage('LoopStart Stage');
    expect(s.knownType).toBe('LoopStart');
    expect(findWarning(release.warnings, 'unknown-element', 'LoopStart Stage')).toBeUndefined();
  });
});

describe('parseRelease: header, queue, env var, credential and other-item parsing', () => {
  const spec = {
    name: 'Header Test Release',
    packageName: 'header-test',
    created: '2026-03-01T10:00:00Z',
    processes: [],
    workQueues: [{ name: 'Invoices', keyField: 'Reference', maxAttempts: 3 }],
    environmentVariables: [{ name: 'Env A', dataType: 'text', value: 'x', description: 'desc' }],
    credentials: [{ name: 'Cred A', description: 'a credential' }],
    otherItems: [
      { itemType: 'font', name: 'Arial 10' },
      { itemType: 'tile', name: 'Dashboard Tile' },
      { itemType: 'dashboard', name: 'Ops Dashboard' },
      { itemType: 'process-group', name: 'Finance Group' },
    ],
  };

  const outcome = parseXmlText('header-test.bprelease', buildReleaseXml(spec));

  it('parses successfully', () => {
    expect(outcome.ok).toBe(true);
  });

  if (!outcome.ok) return;
  const { release } = outcome;

  it('parses header fields', () => {
    expect(release.releaseName).toBe('Header Test Release');
    expect(release.packageName).toBe('header-test');
    expect(release.created).toBe('2026-03-01T10:00:00Z');
  });

  it('parses the work queue', () => {
    expect(release.workQueues).toHaveLength(1);
    expect(release.workQueues[0]).toMatchObject({ name: 'Invoices', keyField: 'Reference', maxAttempts: 3 });
  });

  it('parses the environment variable', () => {
    expect(release.environmentVariables).toHaveLength(1);
    expect(release.environmentVariables[0]).toEqual({ name: 'Env A', dataType: 'text', value: 'x', description: 'desc' });
  });

  it('parses the credential (metadata only)', () => {
    expect(release.credentials).toHaveLength(1);
    expect(release.credentials[0]).toMatchObject({ name: 'Cred A', description: 'a credential' });
  });

  it('parses other items with type and name', () => {
    expect(release.otherItems).toEqual(
      expect.arrayContaining([
        { itemType: 'font', name: 'Arial 10' },
        { itemType: 'tile', name: 'Dashboard Tile' },
        { itemType: 'dashboard', name: 'Ops Dashboard' },
        { itemType: 'process-group', name: 'Finance Group' },
      ]),
    );
  });
});

describe('parseRelease: escaped embedded process definition', () => {
  const outcome = parseXmlText('escaped.bprelease', buildReleaseXml(escapedEmbeddedProcessRelease()));

  it('parses identically to the element-embedded form', () => {
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const process = findProcess(outcome.release.processes, 'Escaped Process');
    expect(process.version).toBe('1.0');
    const page = assertDefined(process.pages.find((p) => p.name === 'Main Page'));
    const stages = stagesByName(page.stages);
    expect(assertDefined(stages.get('Calc')).calculation).toEqual({ expression: '[a]+[b]', storeIn: 'Result' });

    expect(findWarning(outcome.release.warnings, 'escaped-process-parse-failed', 'Escaped Process')).toBeUndefined();
    expect(findWarning(outcome.release.warnings, 'missing-expected', 'Escaped Process')).toBeUndefined();
  });
});

describe('parseRelease: unknown content is warned about, never fatal', () => {
  const outcome = parseXmlText('unknown-content.bprelease', buildReleaseXml(unknownContentRelease()));

  it('still parses successfully', () => {
    expect(outcome.ok).toBe(true);
  });

  if (!outcome.ok) return;
  const { release } = outcome;

  it('warns about the unknown root attribute and element', () => {
    expect(findWarning(release.warnings, 'unknown-attribute', 'bpr:release')).toBeTruthy();
    expect(findWarning(release.warnings, 'unknown-element', 'x-vendor-extension')).toBeTruthy();
  });

  it('warns about the unknown process wrapper attribute and child', () => {
    expect(findWarning(release.warnings, 'unknown-attribute', 'bpr:process')).toBeTruthy();
    expect(findWarning(release.warnings, 'unknown-element', 'x-process-extension')).toBeTruthy();
  });

  it('preserves the unknown stage type with knownType null, and warns about it', () => {
    const process = findProcess(release.processes, 'Odd Process');
    const page = assertDefined(process.pages[0]);
    const futureStage = assertDefined(page.stages.find((s) => s.name === 'Future Stage'));
    expect(futureStage.type).toBe('FutureStage');
    expect(futureStage.knownType).toBeNull();

    expect(findWarning(release.warnings, 'unknown-stage-type', 'Future Stage')).toBeTruthy();
    expect(findWarning(release.warnings, 'unknown-attribute', 'Future Stage')).toBeTruthy();
    expect(findWarning(release.warnings, 'unknown-element', 'x-stage-extension')).toBeTruthy();
  });
});

describe('parseRelease: raw reference preservation (classification is the graph layer\'s job)', () => {
  it('preserves an unresolved object reference verbatim', () => {
    const outcome = parseXmlText('unresolved.bprelease', buildReleaseXml(unresolvedRefsRelease()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const process = findProcess(outcome.release.processes, 'Caller Process');
    const page = assertDefined(process.pages[0]);
    const s = assertDefined(page.stages.find((st) => st.name === 'Call Missing Object'));
    expect(s.action?.objectName).toBe('Nonexistent Object');
    expect(outcome.release.objects).toHaveLength(0);
  });

  it('preserves a dynamic (interpolated) object reference verbatim', () => {
    const outcome = parseXmlText('dynamic.bprelease', buildReleaseXml(dynamicRefsRelease()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const process = findProcess(outcome.release.processes, 'Caller Process');
    const page = assertDefined(process.pages[0]);
    const s = assertDefined(page.stages.find((st) => st.name === 'Call Dynamic Object'));
    expect(s.action?.objectName).toBe('[Target Object]');
  });
});

describe('parseRelease: queue and credential action inputs (literal vs dynamic)', () => {
  const outcome = parseXmlText('queue-credential.bprelease', buildReleaseXml(queueAndCredentialRelease()));

  it('parses successfully with all three action stages intact', () => {
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const process = findProcess(outcome.release.processes, 'Queue Consumer');
    const page = assertDefined(process.pages[0]);
    const stages = stagesByName(page.stages);

    expect(assertDefined(stages.get('Add To Queue Literal')).action).toEqual({
      objectName: 'Work Queues',
      actionName: 'Add To Queue',
      inputs: [{ name: 'Queue Name', dataType: 'text', expression: '"Invoices"', storeIn: null }],
      outputs: [],
    });

    expect(assertDefined(stages.get('Add To Queue Dynamic')).action).toEqual({
      objectName: 'Work Queues',
      actionName: 'Add To Queue',
      inputs: [{ name: 'Queue Name', dataType: 'text', expression: '[Queue Name Variable]', storeIn: null }],
      outputs: [],
    });

    expect(assertDefined(stages.get('Get Credential')).action).toEqual({
      objectName: 'Credentials',
      actionName: 'Get Credential',
      inputs: [{ name: 'Credential Name', dataType: 'text', expression: '"SAP Login"', storeIn: null }],
      outputs: [],
    });
  });
});

describe('parseRelease: environment variable exposure matches a released environment variable', () => {
  const outcome = parseXmlText('env-var.bprelease', buildReleaseXml(envVarRelease()));

  it('parses the Data stage and the environment variable with the same name', () => {
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const process = findProcess(outcome.release.processes, 'Config Reader');
    const page = assertDefined(process.pages[0]);
    const dataStage = assertDefined(page.stages.find((s) => s.name === 'Config Value'));
    expect(dataStage.data?.exposure).toBe('Environment');

    expect(outcome.release.environmentVariables).toHaveLength(1);
    expect(outcome.release.environmentVariables[0]?.name).toBe(dataStage.name);
  });
});

describe('parseRelease: duplicate item across two files', () => {
  it('parses each file independently at its own version (deduplication is the graph layer\'s job)', () => {
    const [fileV1, fileV2] = duplicateItemReleases();
    const outcome1 = parseXmlText(assertDefined(fileV1).fileName, buildReleaseXml(assertDefined(fileV1).spec));
    const outcome2 = parseXmlText(assertDefined(fileV2).fileName, buildReleaseXml(assertDefined(fileV2).spec));

    expect(outcome1.ok).toBe(true);
    expect(outcome2.ok).toBe(true);
    if (!outcome1.ok || !outcome2.ok) return;

    expect(findProcess(outcome1.release.processes, 'Invoice Handler').version).toBe('1.0');
    expect(findProcess(outcome2.release.processes, 'Invoice Handler').version).toBe('2.0');
  });
});

describe('parseRelease: malformed input', () => {
  for (const fixture of malformedFixtures()) {
    it(`fails cleanly for: ${fixture.name}`, () => {
      const outcome = parseXmlText('bad.bprelease', fixture.content);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.reason.length).toBeGreaterThan(0);
      expect(outcome.failure.fileName).toBe('bad.bprelease');
    });
  }

  it('leaves a good file unaffected after a bad one in the same batch', () => {
    const badOutcome = parseXmlText('bad.bprelease', assertDefined(malformedFixtures()[0]).content);
    expect(badOutcome.ok).toBe(false);

    const goodOutcome = parseXmlText('good.bprelease', buildReleaseXml(envVarRelease()));
    expect(goodOutcome.ok).toBe(true);
    if (!goodOutcome.ok) return;
    expect(goodOutcome.release.processes.length).toBeGreaterThan(0);
  });
});

describe('parseRelease: boolean attribute casing and payload attribute validation', () => {
  // Hand-written XML rather than the fixture builder, deliberately: these
  // tests must not share the builder's assumptions about attribute casing.
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<bpr:release xmlns:bpr="http://www.blueprism.co.uk/product/release">',
    '  <bpr:name>Exception casing</bpr:name>',
    '  <bpr:contents count="1"><bpr:process id="p1" name="P" /></bpr:contents>',
    '  <bpr:process id="p1" name="P" bpversion="7.2.1">',
    '    <process id="p1" name="P" version="1.0">',
    '      <subsheet subsheetid="s1" type="MainPage" published="TRUE"><name>Main</name></subsheet>',
    '      <stage stageid="st1" name="Throw" type="Exception">',
    '        <subsheetid>s1</subsheetid>',
    '        <exception type="System Exception" detail="&quot;boom&quot;" usecurrent="True" savedetail="TRUE" />',
    '      </stage>',
    '      <stage stageid="st2" name="Plain" type="Exception">',
    '        <subsheetid>s1</subsheetid>',
    '        <exception type="System Exception" />',
    '      </stage>',
    '      <stage stageid="st3" name="Odd" type="Exception">',
    '        <subsheetid>s1</subsheetid>',
    '        <exception type="System Exception" bogus="1" />',
    '      </stage>',
    '    </process>',
    '  </bpr:process>',
    '</bpr:release>',
  ].join('\n');

  const outcome = parseXmlText('exception-casing.bprelease', xml);

  it('parses successfully', () => {
    expect(outcome.ok).toBe(true);
  });

  if (!outcome.ok) return;
  const process = findProcess(outcome.release.processes, 'P');
  const stages = stagesByName(assertDefined(process.pages[0]).stages);

  it('reads .NET-style True/TRUE exception flags as true', () => {
    const payload = assertDefined(assertDefined(stages.get('Throw')).exception);
    expect(payload.useCurrent).toBe(true);
    expect(payload.savedetail).toBe(true);
  });

  it('treats absent exception flags as false', () => {
    const payload = assertDefined(assertDefined(stages.get('Plain')).exception);
    expect(payload.useCurrent).toBe(false);
    expect(payload.savedetail).toBe(false);
  });

  it('reads page published flags case-insensitively', () => {
    expect(assertDefined(process.pages[0]).published).toBe(true);
  });

  it('warns about unrecognised attributes on payload elements', () => {
    const warning = findWarning(outcome.release.warnings, 'unknown-attribute', 'stage[Odd]');
    expect(assertDefined(warning).message).toContain("'bogus'");
  });
});

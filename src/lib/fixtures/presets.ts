/**
 * Named, canned ReleaseSpec fixtures used across the parser and discovery
 * test suites. Call buildReleaseXml() on the result to get XML text. All
 * content here is synthetic.
 */

import { deterministicId } from './ids';
import type { PageSpec, ReleaseSpec, StageSpec } from './spec';

/** Chains `onSuccess` sequentially through a list of stages (last stage left dangling). */
function chain(stages: StageSpec[]): StageSpec[] {
  return stages.map((s, i) => {
    const next = stages[i + 1];
    return next ? { ...s, onSuccess: s.onSuccess ?? next.name } : s;
  });
}

/**
 * Exercises every KnownStageType with realistic payloads, links, display,
 * loginhibit and narrative, split across two small objects and two small
 * processes so Action/SubSheet/Process call stages resolve to real targets.
 */
export function everyStageTypeRelease(): ReleaseSpec {
  const uiObject = 'UI Automation Object';
  const utilityObject = 'Utility Object';
  const companionProcess = 'Companion Process';
  const companionProcessId = deterministicId(`process:${companionProcess}`);

  let x = 0;
  const nextDisplay = () => {
    x += 75;
    return { x, y: 120, w: 60, h: 30 };
  };

  const mainStages: StageSpec[] = chain([
    { name: 'Start Stage', type: 'Start', display: nextDisplay() },
    {
      name: 'Decision Stage',
      type: 'Decision',
      narrative: 'Branches on the running counter.',
      display: nextDisplay(),
      onTrue: 'Calculation Stage',
      onFalse: 'End Stage',
      payload: { kind: 'decision', expression: '[Counter]>1' },
    },
    {
      name: 'Calculation Stage',
      type: 'Calculation',
      display: nextDisplay(),
      payload: { kind: 'calculation', expression: '[a]+[b]', storeIn: 'Result' },
    },
    {
      name: 'MultipleCalculation Stage',
      type: 'MultipleCalculation',
      display: nextDisplay(),
      payload: {
        kind: 'multipleCalculation',
        steps: [
          { expression: '[a]+[b]', storeIn: 'Result' },
          { expression: '[a]-[b]', storeIn: 'Diff' },
        ],
      },
    },
    {
      name: 'ChoiceStart Stage',
      type: 'ChoiceStart',
      display: nextDisplay(),
      choices: [
        { name: 'Option A', expression: '[x]=1', onTrue: 'ChoiceEnd Stage' },
        { name: 'Option B', expression: '[x]=2', onTrue: 'Data Stage' },
      ],
    },
    { name: 'ChoiceEnd Stage', type: 'ChoiceEnd', display: nextDisplay() },
    {
      name: 'Data Stage',
      type: 'Data',
      narrative: 'A plain data item.',
      display: nextDisplay(),
      payload: { kind: 'data', dataType: 'text', initialValue: 'Hello', exposure: 'Session', alwaysInit: true },
    },
    {
      name: 'Collection Stage',
      type: 'Collection',
      display: nextDisplay(),
      payload: {
        kind: 'data',
        exposure: 'None',
        fields: [
          { name: 'Reference', type: 'text' },
          { name: 'Amount', type: 'number' },
        ],
      },
    },
    {
      name: 'Action Stage',
      type: 'Action',
      display: nextDisplay(),
      payload: {
        kind: 'action',
        objectName: utilityObject,
        actionName: 'Do Something',
        inputs: [{ name: 'Input1', dataType: 'text', expr: '"value"' }],
        outputs: [{ name: 'Output1', dataType: 'text', storeIn: 'Result' }],
      },
    },
    {
      name: 'SubSheet Stage',
      type: 'SubSheet',
      display: nextDisplay(),
      payload: { kind: 'subSheetCall', targetSubsheet: 'Utility Page' },
    },
    {
      name: 'Process Stage',
      type: 'Process',
      display: nextDisplay(),
      payload: {
        kind: 'processCall',
        targetProcessName: companionProcess,
        targetProcessId: companionProcessId,
      },
    },
    {
      name: 'Code Stage',
      type: 'Code',
      display: nextDisplay(),
      payload: {
        kind: 'code',
        language: 'csharp',
        code: 'return a + b;',
        inputs: [{ name: 'a', dataType: 'number', expr: '1' }],
        outputs: [{ name: 'result', dataType: 'number', storeIn: 'Result' }],
      },
    },
    {
      name: 'Navigate Stage',
      type: 'Navigate',
      display: nextDisplay(),
      payload: {
        kind: 'appSteps',
        steps: [{ elementRef: 'Login Button', actionOrCondition: 'ClickCentre', arguments: [{ name: 'X', value: '10' }] }],
      },
    },
    {
      name: 'Read Stage',
      type: 'Read',
      display: nextDisplay(),
      payload: {
        kind: 'appSteps',
        steps: [{ elementRef: 'Username Field', actionOrCondition: 'Text', storeIn: 'Username Value' }],
      },
    },
    {
      name: 'Write Stage',
      type: 'Write',
      display: nextDisplay(),
      payload: {
        kind: 'appSteps',
        steps: [{ elementRef: 'Username Field', actionOrCondition: 'Text', expr: '"admin"' }],
      },
    },
    {
      name: 'WaitStart Stage',
      type: 'WaitStart',
      display: nextDisplay(),
      payload: {
        kind: 'appSteps',
        timeout: '5000',
        steps: [{ elementRef: 'Login Button', actionOrCondition: 'CheckExists' }],
      },
    },
    { name: 'WaitEnd Stage', type: 'WaitEnd', display: nextDisplay() },
    {
      name: 'Exception Stage',
      type: 'Exception',
      narrative: 'Raised when login fails.',
      loginhibit: true,
      display: nextDisplay(),
      payload: { kind: 'exception', exceptionType: 'System Exception', detail: '"Login failed"', useCurrent: false, saveDetail: true },
    },
    { name: 'Recover Stage', type: 'Recover', display: nextDisplay() },
    { name: 'Resume Stage', type: 'Resume', display: nextDisplay() },
    {
      name: 'Alert Stage',
      type: 'Alert',
      display: nextDisplay(),
      payload: { kind: 'alert', expression: '"Something happened"' },
    },
    { name: 'Note Stage', type: 'Note', narrative: 'A free-text annotation.', display: nextDisplay() },
    { name: 'Anchor Stage', type: 'Anchor', display: nextDisplay() },
    {
      name: 'LoopStart Stage',
      type: 'LoopStart',
      display: nextDisplay(),
      // Real exports may carry <groupinfo> here; the parser must not warn about it.
      extraChildren: [{ tag: 'groupinfo' }],
    },
    { name: 'LoopEnd Stage', type: 'LoopEnd', display: nextDisplay() },
    { name: 'Block Stage', type: 'Block', display: nextDisplay() },
    { name: 'SubSheetInfo Stage', type: 'SubSheetInfo', display: nextDisplay() },
    { name: 'ProcessInfo Stage', type: 'ProcessInfo', display: nextDisplay() },
    { name: 'End Stage', type: 'End', display: nextDisplay() },
  ]);

  const utilityPage: PageSpec = {
    name: 'Utility Page',
    type: 'Normal',
    published: false,
    stages: chain([
      { name: 'Utility Start', type: 'Start', display: { x: 20, y: 20 } },
      { name: 'Utility End', type: 'End', display: { x: 100, y: 20 } },
    ]),
  };

  return {
    name: 'Every Stage Type Release',
    packageName: 'every-stage-type',
    objects: [
      {
        name: uiObject,
        version: '1.0',
        bpversion: '7.2.1',
        narrative: 'Exercises every known stage type.',
        appDef: {
          applicationName: 'SAP GUI',
          elements: [
            {
              name: 'Root',
              elementType: 'Application',
              children: [
                { name: 'Login Button', elementType: 'Button' },
                { name: 'Username Field', elementType: 'Field' },
              ],
            },
          ],
        },
        pages: [{ name: 'Main Page', type: 'MainPage', published: false, stages: mainStages }, utilityPage],
      },
      {
        name: utilityObject,
        version: '1.0',
        bpversion: '7.2.1',
        pages: [
          {
            name: 'Do Something',
            type: 'Normal',
            published: true,
            stages: chain([
              { name: 'Start', type: 'Start', display: { x: 20, y: 20 } },
              { name: 'End', type: 'End', display: { x: 100, y: 20 } },
            ]),
          },
        ],
      },
    ],
    processes: [
      {
        name: companionProcess,
        id: companionProcessId,
        version: '1.0',
        bpversion: '7.2.1',
        pages: [
          {
            name: 'Main Page',
            type: 'MainPage',
            published: false,
            stages: chain([
              { name: 'Start', type: 'Start', display: { x: 20, y: 20 } },
              { name: 'End', type: 'End', display: { x: 100, y: 20 } },
            ]),
          },
        ],
      },
    ],
  };
}

/** An Action stage calling an object that is not defined anywhere in the release. */
export function unresolvedRefsRelease(): ReleaseSpec {
  return {
    name: 'Unresolved Refs Release',
    processes: [
      {
        name: 'Caller Process',
        version: '1.0',
        pages: [
          {
            name: 'Main Page',
            type: 'MainPage',
            stages: chain([
              { name: 'Start', type: 'Start', display: { x: 20, y: 20 } },
              {
                name: 'Call Missing Object',
                type: 'Action',
                display: { x: 100, y: 20 },
                payload: { kind: 'action', objectName: 'Nonexistent Object', actionName: 'Do Thing' },
              },
              { name: 'End', type: 'End', display: { x: 180, y: 20 } },
            ]),
          },
        ],
      },
    ],
  };
}

/** An Action stage whose target object name is an interpolated expression rather than a literal. */
export function dynamicRefsRelease(): ReleaseSpec {
  return {
    name: 'Dynamic Refs Release',
    processes: [
      {
        name: 'Caller Process',
        version: '1.0',
        pages: [
          {
            name: 'Main Page',
            type: 'MainPage',
            stages: chain([
              { name: 'Start', type: 'Start', display: { x: 20, y: 20 } },
              {
                name: 'Call Dynamic Object',
                type: 'Action',
                display: { x: 100, y: 20 },
                payload: { kind: 'action', objectName: '[Target Object]', actionName: 'Do Thing' },
              },
              { name: 'End', type: 'End', display: { x: 180, y: 20 } },
            ]),
          },
        ],
      },
    ],
  };
}

/** The same process name exported at two different versions, in two separate release files. */
export function duplicateItemReleases(): { fileName: string; spec: ReleaseSpec }[] {
  const page: PageSpec = {
    name: 'Main Page',
    type: 'MainPage',
    stages: chain([
      { name: 'Start', type: 'Start', display: { x: 20, y: 20 } },
      { name: 'End', type: 'End', display: { x: 100, y: 20 } },
    ]),
  };

  return [
    {
      fileName: 'invoice-handler-v1.bprelease',
      spec: {
        name: 'Invoice Handler Release v1',
        processes: [{ name: 'Invoice Handler', version: '1.0', bpversion: '7.1.0', pages: [page] }],
      },
    },
    {
      fileName: 'invoice-handler-v2.bprelease',
      spec: {
        name: 'Invoice Handler Release v2',
        processes: [{ name: 'Invoice Handler', version: '2.0', bpversion: '7.2.1', pages: [page] }],
      },
    },
  ];
}

/**
 * Action stages targeting the built-in "Work Queues" and "Credentials"
 * objects, covering both literal (string-constant) and dynamic (expression)
 * input expressions for the queue/credential name.
 */
export function queueAndCredentialRelease(): ReleaseSpec {
  return {
    name: 'Queue And Credential Release',
    processes: [
      {
        name: 'Queue Consumer',
        version: '1.0',
        pages: [
          {
            name: 'Main Page',
            type: 'MainPage',
            stages: chain([
              { name: 'Start', type: 'Start', display: { x: 20, y: 20 } },
              {
                name: 'Add To Queue Literal',
                type: 'Action',
                display: { x: 100, y: 20 },
                payload: {
                  kind: 'action',
                  objectName: 'Work Queues',
                  actionName: 'Add To Queue',
                  inputs: [{ name: 'Queue Name', dataType: 'text', expr: '"Invoices"' }],
                },
              },
              {
                name: 'Add To Queue Dynamic',
                type: 'Action',
                display: { x: 180, y: 20 },
                payload: {
                  kind: 'action',
                  objectName: 'Work Queues',
                  actionName: 'Add To Queue',
                  inputs: [{ name: 'Queue Name', dataType: 'text', expr: '[Queue Name Variable]' }],
                },
              },
              {
                name: 'Get Credential',
                type: 'Action',
                display: { x: 260, y: 20 },
                payload: {
                  kind: 'action',
                  objectName: 'Credentials',
                  actionName: 'Get Credential',
                  inputs: [{ name: 'Credential Name', dataType: 'text', expr: '"SAP Login"' }],
                },
              },
              { name: 'End', type: 'End', display: { x: 340, y: 20 } },
            ]),
          },
        ],
      },
    ],
  };
}

/** A Data stage with Environment exposure matched by name to a released environment variable. */
export function envVarRelease(): ReleaseSpec {
  return {
    name: 'Env Var Release',
    processes: [
      {
        name: 'Config Reader',
        version: '1.0',
        pages: [
          {
            name: 'Main Page',
            type: 'MainPage',
            stages: chain([
              { name: 'Start', type: 'Start', display: { x: 20, y: 20 } },
              {
                name: 'Config Value',
                type: 'Data',
                display: { x: 100, y: 20 },
                payload: { kind: 'data', dataType: 'text', exposure: 'Environment', initialValue: 'default' },
              },
              { name: 'End', type: 'End', display: { x: 180, y: 20 } },
            ]),
          },
        ],
      },
    ],
    environmentVariables: [{ name: 'Config Value', dataType: 'text', value: 'default', description: 'Shared config value' }],
  };
}

/**
 * The inner <process> definition embedded as escaped text inside <bpr:process>
 * rather than as a child element. Real exports sometimes do this; the parser
 * must detect and re-parse the escaped text.
 */
export function escapedEmbeddedProcessRelease(): ReleaseSpec {
  return {
    name: 'Escaped Embedded Process Release',
    processes: [
      {
        name: 'Escaped Process',
        version: '1.0',
        embedAsEscapedText: true,
        pages: [
          {
            name: 'Main Page',
            type: 'MainPage',
            stages: chain([
              { name: 'Start', type: 'Start', display: { x: 20, y: 20 } },
              {
                name: 'Calc',
                type: 'Calculation',
                display: { x: 100, y: 20 },
                payload: { kind: 'calculation', expression: '[a]+[b]', storeIn: 'Result' },
              },
              { name: 'End', type: 'End', display: { x: 180, y: 20 } },
            ]),
          },
        ],
      },
    ],
  };
}

/** Unknown elements, unknown attributes and an unknown stage type, all of which must warn, never fail. */
export function unknownContentRelease(): ReleaseSpec {
  return {
    name: 'Unknown Content Release',
    extraRootAttributes: { 'x-vendor-attr': 'mystery' },
    extraRootChildren: [{ tag: 'bpr:x-vendor-extension', text: 'unrecognised root content' }],
    processes: [
      {
        name: 'Odd Process',
        version: '1.0',
        extraWrapperAttributes: { 'x-wrapper-attr': 'mystery' },
        extraChildren: [{ tag: 'x-process-extension', text: 'unrecognised process content' }],
        pages: [
          {
            name: 'Main Page',
            type: 'MainPage',
            stages: chain([
              { name: 'Start', type: 'Start', display: { x: 20, y: 20 } },
              {
                name: 'Future Stage',
                type: 'FutureStage',
                display: { x: 100, y: 20 },
                extraAttributes: { 'x-stage-attr': 'mystery' },
                extraChildren: [{ tag: 'x-stage-extension', text: 'unrecognised stage content' }],
              },
              { name: 'End', type: 'End', display: { x: 180, y: 20 } },
            ]),
          },
        ],
      },
    ],
  };
}

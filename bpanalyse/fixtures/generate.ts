/**
 * Generates the three synthetic fixture releases in this directory from
 * Lattice's declarative fixture builder (src/lib/fixtures). Run with:
 *
 *   npx vite-node bpanalyse/fixtures/generate.ts
 *
 * These stand in for real Blue Prism 7.2 exports until the team commits
 * sanitised real ones (spec section 2.5). Every id is deterministic, so the
 * output is byte-identical on every run.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReleaseXml } from '../../src/lib/fixtures/buildXml';
import { deterministicId } from '../../src/lib/fixtures/ids';
import { everyStageTypeRelease } from '../../src/lib/fixtures/presets';
import type { PageSpec, ReleaseSpec, StageSpec } from '../../src/lib/fixtures/spec';

const here = dirname(fileURLToPath(import.meta.url));

function chain(stages: StageSpec[]): StageSpec[] {
  return stages.map((s, i) => {
    const next = stages[i + 1];
    return next ? { ...s, onSuccess: s.onSuccess ?? next.name } : s;
  });
}

let row = 0;
const pos = () => ({ x: 20 + (row++ % 12) * 90, y: 20 + Math.floor(row / 12) * 60 });

const SHARED_CODE = `Dim s As String = Input1\nResult = s.Trim().ToUpper()`;

const policyLookupId = deterministicId('object:Policy Lookup');
const claimsNotifyId = deterministicId('process:Claims Notify');

/** Object with Initialise, Clean Up, one published action page and one unpublished helper. */
function policyLookup(version: string): ReleaseSpec['objects'][number] {
  return {
    name: 'Policy Lookup',
    id: policyLookupId,
    version,
    bpversion: '7.2.1',
    appDef: {
      applicationName: 'Policy Admin',
      elements: [
        {
          name: 'Main Window',
          elementType: 'Window',
          children: [
            { name: 'Policy Number Field', elementType: 'Field' },
            { name: 'Search Button', elementType: 'Button' },
            { name: 'Status Label', elementType: 'Label' },
          ],
        },
      ],
    },
    pages: [
      {
        name: 'Initialise',
        type: 'MainPage',
        published: false,
        stages: chain([
          { name: 'Start', type: 'Start', display: pos() },
          { name: 'End', type: 'End', display: pos() },
        ]),
      },
      {
        name: 'Clean Up',
        type: 'CleanUp',
        published: false,
        stages: chain([
          { name: 'Start', type: 'Start', display: pos() },
          { name: 'End', type: 'End', display: pos() },
        ]),
      },
      {
        name: 'Get Policy',
        type: 'Normal',
        published: true,
        stages: chain([
          { name: 'Start', type: 'Start', display: pos() },
          { name: 'Policy Number', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'None' } },
          { name: 'Status', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'None' } },
          {
            name: 'Write Policy Number',
            type: 'Write',
            display: pos(),
            payload: { kind: 'appSteps', steps: [{ elementRef: 'Policy Number Field', actionOrCondition: 'Value', expr: '[Policy Number]' }] },
          },
          {
            name: 'Click Search',
            type: 'Navigate',
            display: pos(),
            payload: { kind: 'appSteps', steps: [{ elementRef: 'Search Button', actionOrCondition: 'ClickCentre' }] },
          },
          {
            name: 'Read Status',
            type: 'Read',
            display: pos(),
            payload: { kind: 'appSteps', steps: [{ elementRef: 'Status Label', actionOrCondition: 'Text', storeIn: 'Status' }] },
          },
          {
            name: 'Normalise Status',
            type: 'Code',
            display: pos(),
            payload: {
              kind: 'code',
              language: 'visualbasic',
              code: SHARED_CODE,
              inputs: [{ name: 'Input1', dataType: 'text', expr: '[Status]' }],
              outputs: [{ name: 'Result', dataType: 'text', storeIn: 'Status' }],
            },
          },
          { name: 'Recover', type: 'Recover', display: pos() },
          { name: 'Resume', type: 'Resume', display: pos() },
          { name: 'End', type: 'End', display: pos() },
        ]),
      },
      {
        name: 'Unused Helper',
        type: 'Normal',
        published: false,
        stages: chain([
          { name: 'Start', type: 'Start', display: pos() },
          { name: 'End', type: 'End', display: pos() },
        ]),
      },
    ],
  };
}

function claimsIntake(): ReleaseSpec['processes'][number] {
  const validate: PageSpec = {
    name: 'Validate Claim',
    type: 'Normal',
    published: false,
    stages: chain([
      { name: 'Start', type: 'Start', display: pos() },
      { name: 'Is Valid', type: 'Decision', display: pos(), payload: { kind: 'decision', expression: 'Len([Policy Number]) > 0' }, onTrue: 'End', onFalse: 'Invalid Claim' },
      { name: 'Invalid Claim', type: 'Exception', display: pos(), payload: { kind: 'exception', exceptionType: 'Business Exception', detail: '"Missing policy number"' } },
      { name: 'End', type: 'End', display: pos() },
    ]),
  };
  const dead: PageSpec = {
    name: 'Old Validation',
    type: 'Normal',
    published: false,
    stages: chain([
      { name: 'Start', type: 'Start', display: pos() },
      { name: 'End', type: 'End', display: pos() },
    ]),
  };
  const main: PageSpec = {
    name: 'Main Page',
    type: 'MainPage',
    published: false,
    stages: chain([
      { name: 'Start', type: 'Start', display: pos() },
      { name: 'Policy Number', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'None' } },
      { name: 'Status', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'None' } },
      { name: 'Item ID', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'None' } },
      { name: 'API Base URL', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'Environment' } },
      { name: 'Ops Mailbox', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', initialValue: 'ops.mailbox@example.com', exposure: 'None' } },
      { name: 'Claims', type: 'Collection', display: pos(), payload: { kind: 'data', dataType: 'collection', fields: [{ name: 'Reference', type: 'text' }] } },
      {
        name: 'Get Next Claim',
        type: 'Action',
        display: pos(),
        payload: {
          kind: 'action',
          objectName: 'Work Queues',
          actionName: 'Get Next Item',
          inputs: [{ name: 'Queue Name', dataType: 'text', expr: '"Claims Queue"' }],
          outputs: [{ name: 'Item ID', dataType: 'text', storeIn: 'Item ID' }],
        },
      },
      { name: 'Validate', type: 'SubSheet', display: pos(), payload: { kind: 'subSheetCall', targetSubsheet: 'Validate Claim' } },
      {
        name: 'Get API Credential',
        type: 'Action',
        display: pos(),
        payload: {
          kind: 'action',
          objectName: 'Credentials',
          actionName: 'Get',
          inputs: [{ name: 'Credentials Name', dataType: 'text', expr: '"Policy API"' }],
        },
      },
      {
        name: 'Lookup Policy',
        type: 'Action',
        display: pos(),
        payload: {
          kind: 'action',
          objectName: 'Policy Lookup',
          actionName: 'Get Policy',
          inputs: [{ name: 'Policy Number', dataType: 'text', expr: '[Policy Number]' }],
          outputs: [{ name: 'Status', dataType: 'text', storeIn: 'Status' }],
        },
      },
      { name: 'Build Message', type: 'Calculation', display: pos(), payload: { kind: 'calculation', expression: '"Policy " & [Policy Number] & " is " & [Status]', storeIn: 'Status' } },
      {
        name: 'Notify',
        type: 'Process',
        display: pos(),
        payload: { kind: 'processCall', targetProcessName: 'Claims Notify', targetProcessId: claimsNotifyId, inputs: [{ name: 'Message', dataType: 'text', expr: '[Status]' }] },
      },
      {
        name: 'Mark Complete',
        type: 'Action',
        display: pos(),
        payload: {
          kind: 'action',
          objectName: 'Work Queues',
          actionName: 'Mark Completed',
          inputs: [{ name: 'Item ID', dataType: 'text', expr: '[Item ID]' }],
        },
      },
      { name: 'Recover', type: 'Recover', display: pos() },
      { name: 'Resume', type: 'Resume', display: pos() },
      { name: 'End', type: 'End', display: pos() },
    ]),
  };
  return { name: 'Claims Intake', version: '1.3', bpversion: '7.2.1', narrative: 'Takes claims from the queue and looks up policy status.', pages: [main, validate, dead] };
}

function claimsNotify(): ReleaseSpec['processes'][number] {
  return {
    name: 'Claims Notify',
    id: claimsNotifyId,
    version: '1.0',
    bpversion: '7.2.1',
    pages: [
      {
        name: 'Main Page',
        type: 'MainPage',
        published: false,
        stages: chain([
          { name: 'Start', type: 'Start', display: pos() },
          { name: 'Message', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'None' } },
          { name: 'Queue Name', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'None' } },
          { name: 'Status', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'None' } },
          {
            name: 'Lookup Policy Again',
            type: 'Action',
            display: pos(),
            payload: {
              kind: 'action',
              objectName: 'Policy Lookup',
              actionName: 'Get Policy',
              inputs: [{ name: 'Policy Number', dataType: 'text', expr: '"P123"' }],
              outputs: [{ name: 'Status', dataType: 'text', storeIn: 'Status' }],
            },
          },
          {
            name: 'Add To Audit Queue',
            type: 'Action',
            display: pos(),
            payload: {
              kind: 'action',
              objectName: 'Work Queues',
              actionName: 'Add To Queue',
              inputs: [{ name: 'Queue Name', dataType: 'text', expr: '[Queue Name]' }],
            },
          },
          {
            name: 'Send Email',
            type: 'Action',
            display: pos(),
            payload: {
              kind: 'action',
              objectName: 'External Mailer',
              actionName: 'Send',
              inputs: [{ name: 'Body', dataType: 'text', expr: '[Message]' }],
            },
          },
          { name: 'End', type: 'End', display: pos() },
        ]),
      },
    ],
  };
}

function utilityStrings(): ReleaseSpec['objects'][number] {
  return {
    name: 'Utility Strings',
    version: '2.0',
    bpversion: '7.2.1',
    pages: [
      {
        name: 'Initialise',
        type: 'MainPage',
        published: false,
        stages: chain([
          { name: 'Start', type: 'Start', display: pos() },
          { name: 'End', type: 'End', display: pos() },
        ]),
      },
      {
        name: 'Upper Trim',
        type: 'Normal',
        published: true,
        stages: chain([
          { name: 'Start', type: 'Start', display: pos() },
          { name: 'Input1', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'None' } },
          { name: 'Result', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', exposure: 'None' } },
          {
            name: 'Upper Trim Code',
            type: 'Code',
            display: pos(),
            payload: {
              kind: 'code',
              language: 'visualbasic',
              code: `  ${SHARED_CODE.replace('\n', '\n\n  ')}  `,
              inputs: [{ name: 'Input1', dataType: 'text', expr: '[Input1]' }],
              outputs: [{ name: 'Result', dataType: 'text', storeIn: 'Result' }],
            },
          },
          { name: 'End', type: 'End', display: pos() },
        ]),
      },
    ],
  };
}

const core: ReleaseSpec = {
  name: 'Claims Estate Core',
  packageName: 'claims-core',
  created: '2026-03-10T09:00:00Z',
  userCreatedBy: 'fixture',
  processes: [claimsIntake(), claimsNotify()],
  objects: [policyLookup('1.4'), utilityStrings()],
  workQueues: [{ name: 'Claims Queue', keyField: 'Reference', maxAttempts: 3 }],
  environmentVariables: [{ name: 'API Base URL', dataType: 'text', value: 'https://policy.internal.example.com/api', description: 'Policy API base' }],
  credentials: [{ name: 'Policy API', description: 'Service account for the policy API' }],
};

/** Older copy of Policy Lookup, embedded as escaped text: exercises collision resolution (later created wins). */
const older: ReleaseSpec = {
  name: 'Policy Lookup Legacy',
  packageName: 'policy-lookup-legacy',
  created: '2025-11-02T14:30:00Z',
  userCreatedBy: 'fixture',
  objects: [{ ...policyLookup('1.2'), embedAsEscapedText: true }],
  processes: [
    {
      name: 'Legacy Reporter',
      version: '0.9',
      bpversion: '7.2.1',
      embedAsEscapedText: true,
      pages: [
        {
          name: 'Main Page',
          type: 'MainPage',
          published: false,
          stages: chain([
            { name: 'Start', type: 'Start', display: pos() },
            { name: 'Account', type: 'Data', display: pos(), payload: { kind: 'data', dataType: 'text', initialValue: '12345678', exposure: 'None' } },
            { name: 'Note', type: 'Note', narrative: 'Kept for reference only.', display: pos() },
            { name: 'End', type: 'End', display: pos() },
          ]),
        },
      ],
    },
  ],
};

/** Every known stage type, plus an unknown stage type and unknown top-level element for the run.log tests. */
const everyType: ReleaseSpec = {
  ...everyStageTypeRelease(),
  name: 'Every Stage Type',
  created: '2026-01-15T08:00:00Z',
  otherItems: [{ itemType: 'tile', name: 'Throughput Tile' }],
  extraRootChildren: [{ tag: 'bpr:future-thing', text: 'ignored' }],
};
everyType.processes = (everyType.processes ?? []).map((p, i) =>
  i === 0
    ? { ...p, pages: p.pages.map((pg, j) => (j === 0 ? { ...pg, stages: [...pg.stages, { name: 'Future Stage', type: 'FutureStage', display: { x: 900, y: 900 } }] } : pg)) }
    : p,
);

const outDir = join(here, 'releases');
mkdirSync(outDir, { recursive: true });
for (const [file, spec] of [
  ['claims-core.bprelease', core],
  ['policy-lookup-legacy.bprelease', older],
  ['every-stage-type.bprelease', everyType],
] as const) {
  writeFileSync(join(outDir, file), buildReleaseXml(spec) + '\n', 'utf8');
  console.log(`wrote ${file}`);
}

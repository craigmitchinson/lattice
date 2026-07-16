/**
 * Parsed model: a faithful, per-file representation of a .bprelease export.
 * The parser is tolerant and preserving; reference extraction and identity
 * resolution live in the graph layer, not here. See docs/data-model.md.
 */

/** Identity and provenance of one imported file. Raw bytes are never kept. */
export interface SourceFileMeta {
  fileName: string;
  /** SHA-256 of the raw bytes, lower-case hex. The cache key. */
  contentHash: string;
  byteSize: number;
  /** ISO 8601 timestamp of import. */
  importedAt: string;
}

/** Structured, non-fatal note recorded during parsing. */
export interface ParseWarning {
  /** e.g. 'unknown-element', 'unknown-attribute', 'unknown-stage-type', 'missing-expected' */
  code: string;
  message: string;
  /** XPath-like locator of where the oddity sat, best effort. */
  path: string;
  line?: number;
  column?: number;
}

/** A file that failed to parse. The batch continues without it. */
export interface ParseFailure {
  fileName: string;
  contentHash: string | null;
  reason: string;
  line?: number;
  column?: number;
}

export const KNOWN_STAGE_TYPES = [
  'Start',
  'End',
  'Action',
  'Calculation',
  'MultipleCalculation',
  'Decision',
  'ChoiceStart',
  'ChoiceEnd',
  'Data',
  'Collection',
  'SubSheet',
  'Process',
  'Code',
  'Navigate',
  'Read',
  'Write',
  'WaitStart',
  'WaitEnd',
  'Exception',
  'Recover',
  'Resume',
  'Alert',
  'Note',
  'Anchor',
  'LoopStart',
  'LoopEnd',
  'Block',
  'SubSheetInfo',
  'ProcessInfo',
] as const;

export type KnownStageType = (typeof KNOWN_STAGE_TYPES)[number];

export function narrowStageType(raw: string): KnownStageType | null {
  return (KNOWN_STAGE_TYPES as readonly string[]).includes(raw)
    ? (raw as KnownStageType)
    : null;
}

export interface StageDisplay {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/** One outcome of a Choice stage. */
export interface ChoiceLink {
  name: string;
  expression: string;
  /** Target stage id, if linked. */
  target: string | null;
}

export interface StageLinks {
  onSuccess: string | null;
  onTrue: string | null;
  onFalse: string | null;
  choices: ChoiceLink[];
}

export interface ActionParameter {
  name: string;
  dataType: string | null;
  /** Expression supplying an input. */
  expression: string | null;
  /** Data item receiving an output. */
  storeIn: string | null;
}

export interface ActionPayload {
  /** Target object name as exported. Empty or interpolated means dynamic. */
  objectName: string;
  actionName: string;
  inputs: ActionParameter[];
  outputs: ActionParameter[];
}

export interface CalculationPayload {
  expression: string;
  storeIn: string | null;
}

export interface MultipleCalculationPayload {
  steps: CalculationPayload[];
}

export interface DecisionPayload {
  expression: string;
}

export interface CollectionFieldDef {
  name: string;
  dataType: string | null;
}

export interface DataPayload {
  dataType: string | null;
  initialValue: string | null;
  /** 'none' | 'statistic' | 'environment' | 'session' (raw value preserved) */
  exposure: string;
  /** True when the value is retained between sessions. */
  alwaysInit: boolean;
  fields: CollectionFieldDef[];
}

export interface SubsheetRefPayload {
  /** Referenced subsheet (page) id within the same process/object. */
  subsheetId: string | null;
  /** Process name for cross-process call stages. */
  processName: string | null;
  processId: string | null;
  inputs: ActionParameter[];
  outputs: ActionParameter[];
}

export interface CodePayload {
  language: string | null;
  code: string;
  inputs: ActionParameter[];
  outputs: ActionParameter[];
}

/** One step of a Navigate/Read/Write/Wait stage against the app model. */
export interface AppStep {
  /** Application model element id, null when absent or dynamic. */
  elementId: string | null;
  /** Action name (navigate/wait) or property (read/write). */
  actionOrProperty: string | null;
  /** Input expressions / parameters, raw. */
  arguments: Record<string, string>;
  /** Data item receiving a read. */
  storeIn: string | null;
  expression: string | null;
}

export interface AppStepsPayload {
  steps: AppStep[];
  /** Wait stages: timeout expression. */
  timeout: string | null;
}

export interface ExceptionPayload {
  exceptionType: string | null;
  detail: string | null;
  /** True when re-throwing the current exception. */
  useCurrent: boolean;
  savedetail: boolean;
}

export interface AlertPayload {
  expression: string | null;
}

/**
 * Type-specific payloads. At most one is present, matching the stage type.
 * Kept as optional fields rather than a closed discriminated union so that
 * tolerant parsing of unknown stage types stays representable.
 */
export interface StagePayloads {
  action?: ActionPayload;
  calculation?: CalculationPayload;
  multipleCalculation?: MultipleCalculationPayload;
  decision?: DecisionPayload;
  data?: DataPayload;
  subsheetRef?: SubsheetRefPayload;
  code?: CodePayload;
  appSteps?: AppStepsPayload;
  exception?: ExceptionPayload;
  alert?: AlertPayload;
}

export interface ParsedStage extends StagePayloads {
  stageId: string;
  name: string;
  /** Raw type string exactly as exported. */
  type: string;
  /** Narrowed type, null when unrecognised (recorded as a warning). */
  knownType: KnownStageType | null;
  narrative: string | null;
  /** Owning subsheet id; null for main-page stages in exports that omit it. */
  subsheetId: string | null;
  display: StageDisplay | null;
  /** True when stage logging is inhibited. */
  loggingInhibited: boolean;
  links: StageLinks;
}

export interface ParsedPage {
  subsheetId: string;
  name: string;
  /** e.g. 'Normal', 'MainPage', 'CleanUp' (raw value preserved). */
  type: string;
  published: boolean;
  stages: ParsedStage[];
}

export interface AppModelElement {
  elementId: string;
  name: string;
  /** Ancestor names joined with '/', including this element's name. */
  path: string;
  elementType: string | null;
}

export interface ParsedAppModel {
  applicationName: string | null;
  elements: AppModelElement[];
}

export interface ParsedProcess {
  kind: 'process' | 'object';
  /** Export item id (GUID) when present, otherwise synthesised. */
  id: string;
  name: string;
  version: string | null;
  bpversion: string | null;
  narrative: string | null;
  /**
   * Derived from page-level published flags. Meaningful for objects, where
   * published pages are the object's actions; for processes it is usually
   * false and must not be read as "process is published in Blue Prism".
   */
  published: boolean;
  pages: ParsedPage[];
  /** Objects only. */
  appModel: ParsedAppModel | null;
}

export interface ParsedWorkQueue {
  id: string;
  name: string;
  keyField: string | null;
  maxAttempts: number | null;
}

export interface ParsedEnvironmentVariable {
  name: string;
  dataType: string | null;
  /** Initial value as exported. Environment variables are configuration, not secrets. */
  value: string | null;
  description: string | null;
}

/** Credential metadata only. Exports never contain secrets; none are modelled. */
export interface ParsedCredential {
  id: string;
  name: string;
  description: string | null;
}

export interface ParsedOtherItem {
  /** Raw element name, e.g. 'font', 'tile', 'dashboard', 'process-group'. */
  itemType: string;
  name: string;
}

export interface ParsedRelease {
  file: SourceFileMeta;
  releaseName: string | null;
  packageName: string | null;
  /** Release created timestamp as exported. */
  created: string | null;
  processes: ParsedProcess[];
  objects: ParsedProcess[];
  workQueues: ParsedWorkQueue[];
  environmentVariables: ParsedEnvironmentVariable[];
  credentials: ParsedCredential[];
  otherItems: ParsedOtherItem[];
  warnings: ParseWarning[];
}

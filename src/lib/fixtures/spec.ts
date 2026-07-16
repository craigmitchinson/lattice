/**
 * Declarative fixture specifications for synthetic .bprelease XML. These
 * types describe the *content* of a release well above XML syntax; see
 * buildXml.ts for how a ReleaseSpec becomes XML text.
 *
 * All test data produced from these types is synthetic. Nothing here is
 * derived from, or references, a real release file.
 *
 * GUID handling: every id-bearing spec accepts an optional explicit `id`.
 * When omitted, buildXml.ts derives a deterministic id from context (see
 * ids.ts), so two calls with the same spec always produce the same XML.
 */

export type ExposureSpec = 'None' | 'Statistic' | 'Environment' | 'Session';

export interface DisplaySpec {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/** One input or output parameter of an Action/SubSheet/Process/Code stage. */
export interface ActionParamSpec {
  name: string;
  dataType?: string;
  /** Input expression. Used (and required in practice) for inputs; ignored for outputs. */
  expr?: string;
  /** Destination data item name. Used for outputs; ignored for inputs. */
  storeIn?: string;
}

export interface AppStepArgumentSpec {
  name: string;
  value: string;
}

/** One step of a Navigate/Read/Write/WaitStart stage. */
export interface AppStepSpec {
  /** Application model element name, resolved against the owning object's appdef. */
  elementRef?: string;
  /** Explicit element id, used instead of resolving `elementRef` when given. */
  elementId?: string;
  /**
   * Navigate/Read/Write: action or property name (e.g. 'ClickCentre').
   * WaitStart: condition name (e.g. 'CheckExists'). buildXml.ts picks the
   * right child tag based on the owning stage's type.
   */
  actionOrCondition?: string;
  /** Navigate/Read/Write only. */
  arguments?: AppStepArgumentSpec[];
  /** Read only: destination data item name. */
  storeIn?: string;
  /** Write only: source expression. */
  expr?: string;
}

/**
 * Type-specific stage content, discriminated by `kind`. Kept separate from
 * `StageSpec.type` (the raw exported type string) so that fixtures for
 * unknown/future stage types can set an arbitrary `type` with no payload at
 * all, exactly as a tolerant real-world export would look.
 */
export type StagePayloadSpec =
  | { kind: 'decision'; expression: string }
  | { kind: 'calculation'; expression: string; storeIn?: string }
  | { kind: 'multipleCalculation'; steps: { expression: string; storeIn?: string }[] }
  | {
      kind: 'data';
      dataType?: string;
      initialValue?: string;
      exposure?: ExposureSpec;
      alwaysInit?: boolean;
      /** Collection stages only. */
      fields?: { name: string; type?: string }[];
    }
  | {
      kind: 'action';
      objectName: string;
      actionName: string;
      inputs?: ActionParamSpec[];
      outputs?: ActionParamSpec[];
    }
  | {
      kind: 'subSheetCall';
      /** Page name within the same process/object; resolved to a subsheet id. */
      targetSubsheet: string;
      targetSubsheetId?: string;
      inputs?: ActionParamSpec[];
      outputs?: ActionParamSpec[];
    }
  | {
      kind: 'processCall';
      targetProcessName: string;
      targetProcessId?: string;
      inputs?: ActionParamSpec[];
      outputs?: ActionParamSpec[];
    }
  | {
      kind: 'code';
      language?: string;
      code: string;
      inputs?: ActionParamSpec[];
      outputs?: ActionParamSpec[];
    }
  | { kind: 'appSteps'; steps: AppStepSpec[]; timeout?: string }
  | {
      kind: 'exception';
      exceptionType?: string;
      detail?: string;
      useCurrent?: boolean;
      saveDetail?: boolean;
    }
  | { kind: 'alert'; expression: string };

export interface ChoiceSpec {
  name: string;
  expression: string;
  /** Target stage name within the same page. */
  onTrue?: string;
}

export interface StageSpec {
  id?: string;
  name: string;
  /** Raw stage type exactly as it would be exported; may be unrecognised. */
  type: string;
  narrative?: string;
  display?: DisplaySpec;
  /** True when stage logging is inhibited (emits an empty <loginhibit/>). */
  loginhibit?: boolean;
  /** Target stage name within the same page; resolved to a stage id. */
  onSuccess?: string;
  /** Decision stages only. Target stage names within the same page. */
  onTrue?: string;
  onFalse?: string;
  /** ChoiceStart stages only. */
  choices?: ChoiceSpec[];
  payload?: StagePayloadSpec;
  /** Extra unknown attributes to emit on the <stage> element itself. */
  extraAttributes?: Record<string, string>;
  /** Extra unknown child elements, for tolerant-parsing fixtures. */
  extraChildren?: { tag: string; text?: string }[];
}

export interface PageSpec {
  id?: string;
  name: string;
  /** e.g. 'Normal', 'MainPage', 'CleanUp'. Defaults to 'Normal'. */
  type?: string;
  /** Defaults to false, true for the conventional MainPage. */
  published?: boolean;
  stages: StageSpec[];
}

interface ProcessLikeSpec {
  id?: string;
  name: string;
  /** e.g. '1.2'. */
  version?: string;
  /** e.g. '7.2.1'. */
  bpversion?: string;
  narrative?: string;
  pages: PageSpec[];
  /**
   * Emit the inner <process> definition as escaped text inside the wrapper
   * element instead of as a child element. Some real exports do this; the
   * parser must detect and re-parse it. See presets.escapedEmbeddedProcessRelease.
   */
  embedAsEscapedText?: boolean;
  /** Extra unknown attributes on the wrapping <bpr:process>/<bpr:object> element. */
  extraWrapperAttributes?: Record<string, string>;
  /** Extra unknown child elements directly under the inner <process> element. */
  extraChildren?: { tag: string; text?: string }[];
}

export type ProcessSpec = ProcessLikeSpec;

export interface AppElementSpec {
  id?: string;
  name: string;
  elementType?: string;
  children?: AppElementSpec[];
}

export interface AppDefSpec {
  applicationName?: string;
  elements: AppElementSpec[];
}

export interface ObjectSpec extends ProcessLikeSpec {
  appDef?: AppDefSpec;
}

export interface QueueSpec {
  id?: string;
  name: string;
  keyField?: string;
  maxAttempts?: number;
}

export interface EnvVarSpec {
  name: string;
  dataType?: string;
  value?: string;
  description?: string;
}

export interface CredentialSpec {
  id?: string;
  name: string;
  description?: string;
}

/** Fonts, tiles, dashboards, process-groups: name/type only, some with ids. */
export interface OtherItemSpec {
  /** Raw element name, e.g. 'font', 'tile', 'dashboard', 'process-group'. */
  itemType: string;
  /** Only tiles and dashboards carry an id in practice; harmless if set for others. */
  id?: string;
  name: string;
}

export interface ReleaseSpec {
  name?: string;
  releaseNotes?: string;
  /** ISO 8601 timestamp. */
  created?: string;
  packageId?: string;
  packageName?: string;
  userCreatedBy?: string;
  processes?: ProcessSpec[];
  objects?: ObjectSpec[];
  workQueues?: QueueSpec[];
  environmentVariables?: EnvVarSpec[];
  credentials?: CredentialSpec[];
  otherItems?: OtherItemSpec[];
  /** Extra unknown attributes on the root <bpr:release> element. */
  extraRootAttributes?: Record<string, string>;
  /** Extra unknown child elements directly under <bpr:release>. */
  extraRootChildren?: { tag: string; text?: string }[];
}

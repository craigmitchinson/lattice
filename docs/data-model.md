# Lattice data model

Two layers, deliberately separated:

1. **Parsed model** (`src/lib/model/`): a faithful, per-file representation of
   what a `.bprelease` export actually contained. The parser is dumb and
   tolerant; it preserves structure and records what it did not understand.
2. **Estate graph** (`src/lib/graph/`): the normalised, cross-file graph that
   every analysis runs against. Reference extraction, identity resolution,
   duplicate handling and reverse indexing all happen here, as pure functions
   over parsed models.

The split exists so the parser can evolve against real exports without
disturbing analysis code, and so analyses never touch raw XML.

## Parsed model

Each imported file produces one `ParsedRelease`:

- `file`: `SourceFileMeta` — file name, SHA-256 content hash of the raw
  bytes, byte size, import timestamp. The hash is the file's identity and
  the cache key. Raw bytes are never persisted.
- `releaseName`, `packageName`, `created`: release header metadata.
- `processes`, `objects`: full definitions (see below).
- `workQueues`, `environmentVariables`, `credentials`: metadata only.
  Credential secrets do not appear in exports and are never modelled.
- `otherItems`: fonts, tiles, dashboards, groups — name and type recorded,
  contents not modelled in phase 1.
- `warnings`: structured notes about unknown elements/attributes or
  recoverable oddities. Unknown content is never fatal.

### Processes and objects

`ParsedProcess` covers both processes and business objects (`kind`
discriminates). Fields: export item id (GUID), `name`, `version`,
`bpversion` (recorded per item and surfaced in the UI for mixed-version
estates), `narrative`, `published`, `pages`, and for objects the parsed
application model (`appModel`).

A `ParsedPage` is a subsheet: id, name, type, plus its `stages`.

### Stages

`ParsedStage` keeps every stage's: `stageId` (GUID), `name`, `type` (raw
string as exported), `knownType` (narrowed to the supported union, or
`null` for unrecognised types), `narrative`, `subsheetId`, display
coordinates, logging flags, control-flow links (`onSuccess`, `onTrue`,
`onFalse`, and `choices` each with name, expression and target), and a
type-specific payload:

| Payload | Stage types | Contents |
| ------- | ----------- | -------- |
| `action` | Action | target object name, action name, inputs and outputs (name, data type, expression or store-in stage) |
| `calculation` | Calculation | expression, store-in target |
| `multipleCalculation` | MultipleCalculation | ordered steps of expression + store-in |
| `decision` | Decision | expression |
| `data` | Data, Collection | data type, initial value, exposure (statistic, environment, session), collection field definitions |
| `subsheetRef` | SubSheet | referenced subsheet id (the process-internal page call) |
| `processRef` | Process | referenced process name/id (object-to-process or process-to-process call) |
| `code` | Code | language, source text, inputs, outputs |
| `appStep` | Navigate, Read, Write, WaitStart | ordered steps: target element id, action or property, parameters, expressions, store-in targets |
| `exception` | Exception | exception type, detail expression, preserve-current flag |
| `resource` | Alert | message expression |

Everything else (Start, End, Anchor, Note, Decision links, Choice, Loop,
Block, Recover, Resume, WaitEnd, ChoiceStart/ChoiceEnd, SubSheetInfo,
ProcessInfo) is structural and carries no extra payload beyond the common
fields.

Unknown stage types are preserved with `knownType: null` and reported as
warnings; analyses skip them explicitly.

### Application model

Objects carry `appModel`: a flattened list of elements, each with element
id (GUID), name, full path (ancestor names joined with `/`), and element
type. Navigate/Read/Write/Wait steps reference elements by id.

## Estate graph

### Nodes

| Kind | Identity (node id scheme) | Notes |
| ---- | ------------------------- | ----- |
| `process` | `process:{lower-cased name}` | Cross-file identity is by name, because inter-process references in Blue Prism are by name. |
| `object` | `object:{lower-cased name}` | Same rule. |
| `action` | `action:{object name}:{action name}` (lower-cased) | An action is a published page of an object. |
| `page` | `page:{owner node id}:{subsheet id}` | |
| `stage` | `stage:{owner node id}:{stage id}` | Stage nodes come from the winning copy after duplicate resolution. |
| `workQueue` | `queue:{lower-cased name}` | |
| `environmentVariable` | `envvar:{lower-cased name}` | |
| `credential` | `credential:{lower-cased name}` | |
| `appModelElement` | `element:{owner object node id}:{element id}` | |
| `sourceFile` | `file:{content hash}` | |

Every node records:

- `resolution`: `resolved` (definition present in the import set),
  `external` (referenced but not defined anywhere imported — badged
  "external or missing", a first-class finding, never dropped), or
  `dynamic` (the reference target is an expression, not a literal —
  "unresolvable at rest", surfaced as a risk because it is invisible to
  impact assessment).
- `provenance`: the source files (name + content hash) that defined or
  referenced it.
- a kind-specific `data` payload (version, bpversion, counts, exposure,
  etc.) used by the estate browser.

### Edges

All edges are directional and typed. `from` is the dependent, `to` is the
dependency, so "what does X depend on" follows outgoing edges and "what
depends on X" follows incoming edges.

| Edge type | From → To |
| --------- | --------- |
| `calls-process` | process/object → process |
| `invokes-action` | process/object → action (also recorded stage → action) |
| `action-of` | action → object |
| `page-of` | page → process/object |
| `stage-of` | stage → page |
| `references-queue` | stage → workQueue |
| `references-env-var` | stage → environmentVariable |
| `references-credential` | stage → credential |
| `targets-element` | stage → appModelElement |
| `element-of` | appModelElement → object |
| `links-to` | stage → stage, with a `role`: `success`, `true`, `false`, `choice`, `exception` |
| `defined-in` | process/object/queue/envvar/credential → sourceFile |

Item-level edges (`calls-process`, `invokes-action`, queue/env-var/
credential references) are derived from stage-level evidence, and each
derived edge keeps the list of stage node ids that justify it. Every
impact answer is therefore traceable to exact stages.

### Reference extraction

Performed by the graph builder over parsed stages:

- Action stages: literal object + action names → `invokes-action`. If the
  name is empty or contains `[data item]` interpolation, the target is
  `dynamic`.
- Process/SubSheet call stages: → `calls-process` / internal page edges.
- Queue references: action stages targeting the built-in work-queues
  object, with the queue name taken from the relevant input expression
  when it is a string literal; otherwise `dynamic`.
- Environment variables: data items with environment exposure, matched by
  name to imported environment variable definitions.
- Credentials: action stages targeting credential-store actions, with the
  credential name input treated like queue names.
- App model elements: step element ids resolved against the owning
  object's application model.

### Duplicates

The same item (by kind + name) appearing in more than one file is resolved
at graph-build time: the copy with the highest version (numeric-aware
comparison, falling back to release created date) wins; all copies are
recorded in a `DuplicateRecord` (kept + discarded, with files and
versions) surfaced in the batch summary.

### Resolved semantics

Decisions the implementation makes where the rules above leave room:

- **Duplicate provenance**: every copy of a duplicated item (winner and
  discarded) contributes provenance and a `defined-in` edge; only the
  winner's pages, stages and edges are built.
- **Exception link roles**: all outgoing links of Exception, Recover and
  Resume stages carry role `exception`; for those stage types any outgoing
  link is exception flow, not normal success flow.
- **Internal page calls**: a SubSheet call to a page of the same process
  adds no estate-level edge; `page-of`/`stage-of` already capture it.
- **Dual-level edges**: `calls-process`, `invokes-action` and the three
  `references-*` types exist both item-level (with stage evidence) and
  stage-level. Impact walks use only the item-level edge for these five
  types so consumers are never double-counted; `action-of`,
  `targets-element` and `element-of` have no item-level counterpart.
- **Dynamic node keying**: dynamic targets are keyed by the lower-cased
  raw expression; empty expressions collapse to one `(empty)` placeholder
  per scope.
- **Unresolved app-model elements**: one shared external element node per
  owning object, not one per stage.
- **String literals**: a queue or credential name input counts as literal
  only when it matches `^"[^"]*"$`; anything else is dynamic.
- **Impact root redirect**: impact on a stage or page resolves to its
  owning process/object first and reports that node as the root.

### Indexes

Built at ingest, held in memory:

- `outEdges`, `inEdges`: node id → edge type → set of node ids (with edge
  payloads). Impact lookups are bounded breadth-first walks over these
  maps with a depth control; on a 100+ file estate this is milliseconds,
  no precomputed closure needed.
- `byKind`: node kind → node ids, for the estate browser.
- `consumerCounts`: node id → distinct consuming processes/objects,
  precomputed for browser list rendering.

## Persistence

IndexedDB database `lattice`, object stores:

- `files`: key = source file content hash; value = `{ schemaVersion,
  meta: SourceFileMeta, release: ParsedRelease }`. Only the parsed model
  is stored, never raw bytes.
- `settings`: UI preferences and analysis thresholds (later phases).

`SCHEMA_VERSION` (a constant in `src/lib/persist/`) is stamped on every
record. On load, records with a different version are discarded so the
cache invalidates cleanly when the parser evolves. The graph itself is
not persisted; it is rebuilt from parsed releases at startup, which keeps
the persisted schema small and the invalidation story simple. The graph
exports to JSON on demand. A visible "clear all local data" control
deletes the database.

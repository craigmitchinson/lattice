# bpanalyse: Blue Prism release analyser

## 1. Purpose

One CLI tool that takes one or more `.bprelease` files and produces an estate inventory, a dependency graph, quality signals per process and object, and answers to impact questions (if X changes, what is affected). Outputs are identical on repeated runs against the same input.

## 2. Inputs and constraints

2.1 Input is a directory of `.bprelease` files exported from Blue Prism 7.2. Multiple files are merged into one estate. The same process or object (matched by its Blue Prism id) appearing in two files is resolved by the later `bpr:created` timestamp in the release header, and the collision is logged.

2.2 A sanitiser step runs first and is mandatory. It masks any Data stage initial value, any calculation literal, any action input literal and any environment variable value that matches configured patterns (credentials, account numbers, URLs with hostnames, email addresses). The mask list is `src/bpanalyse/config/mask_patterns.yaml`, not code. Sanitised copies (in memory) are what the parser reads. Masking is generic: every attribute value and text node under a stage is masked, and every descendant of `initialvalue`, except identifier fields (stage ids, names and types, page and target ids, resource object and action, input and output names and types, display, datatype, exposure, code language, field names and types, choice names). Exception `type` and `detail` are masked. An encrypted initial value (`initialvalueenc`) is replaced whole and reported as the pattern `encrypted`. Windows paths (`C:\...`) are masked by the `windows_path` pattern. A missing or empty mask config is a fatal error (exit 1), never an unmasked run. Original values are never written to any output.

2.3 No LLM anywhere in the pipeline. Parsing is deterministic XML traversal only.

2.4 Runs offline on a standard Windows machine, Python 3.11+, no external services. Runtime dependencies: `openpyxl`, `pyyaml`. Nothing else.

2.5 Schema authority. The element and attribute names in this document come from eight real public exports (Blue Prism 5.0 to 6.10, fetched by `fixtures/public/fetch.py`, never committed), censused in `fixtures/schema-observed-public.txt`. Until real 7.2 exports are available that public corpus is the authority. The first guess at the format (siblings after `bpr:contents`, `target` and `subsheet type=MainPage` elements) was wrong and has been replaced. `python -m bpanalyse discover <input_dir> <out_file>` writes the same kind of census (every element and attribute path with its count, stage paths keyed by stage type, no values except stage type names) as sorted `path count` lines. It is the schema fixture mechanism: run it over real 7.2 exports and send the output back, and any difference from section 2.6 is a parser change. The `unrecognised` lines of `run.log` come from the same traversal. The committed fixtures in `fixtures/releases/` are synthetic, written by `fixtures/generate.py` in the real shape; they are to be replaced or supplemented by small real 7.2 exports (one process, one object with two published actions, one queue literal and one by expression, one Get Credential, one env var, one call to an object not in the release).

2.6 Known format facts the parser must handle. All element matching is on local names; namespaces and prefixes are ignored everywhere.

- Root `bpr:release` (namespace `http://www.blueprism.co.uk/product/release`). Header children: `bpr:name`, `bpr:release-notes`, `bpr:created` (format `2016-12-30 08:53:58Z`, space separator; parsed with `fromisoformat` after replacing the space, `bad_created` is logged if that fails), `bpr:package-id` (a small integer, not unique across files), `bpr:package-name`, `bpr:user-created-by`.
- Every definition is a child of `bpr:contents count="N"`; there are no siblings after it. Kinds seen: `process`, `object`, `credential`, `environment-variable`, `process-group`, `object-group`, `webapiservice`. Recognised by name and counted, not read: `tile`, `dashboard`, `font`, `schedule`, `skill`. `work-queue` (`id name`, children `keyfield`, `maxattempts`) is read if present. Any other kind is logged as unrecognised. A `count` that differs from the number of children is logged as `contents_count_mismatch`.
- `process id name [published="true"]` and `object id name` wrappers contain one inner `<process>` element (namespace `http://www.blueprism.co.uk/product/process`). The id is on the wrapper only. Older versions may hold the inner process as escaped text; that is detected, stripped of BOM and XML declaration, and re-parsed, but the child element is the primary form. Inner `<process>` attributes: `name`, `version`, `bpversion`, `narrative`, `type="object"` for objects, `runmode`, `byrefcollection`. Inner children: `subsheet`, `stage`, `appdef` (objects), and the known-ignored `view`, `preconditions` (optional `condition` children) and `endpoint`.
- `subsheet subsheetid type published` with children `name` and `view`. `type` is `Normal` or `CleanUp`; `published` is True/False in any case. The main page is not listed: stages with no `subsheetid` child belong to it, and a page row is synthesised with id `<process_id>/main`, name `Main Page` (`Initialise` for objects), type `MainPage`, `is_main` 1.
- `stage stageid name type`, common children: `narrative`, `subsheetid` (owning page, absent = main page), `display` (attributes `x y w h`) or the older text elements `displayx displayy displaywidth displayheight`, `font`, `loginhibit`, `loginhibitparameters`, `onsuccess`, `preconditions`, `postconditions`. x and y are stored; font, narrative, preconditions and postconditions are known and ignored. Per type:
  - Start: `inputs/input`. End: `outputs/output`. Decision: `decision expression`, `ontrue`, `onfalse`. Calculation: `calculation expression stage`. MultipleCalculation: `steps/calculation`.
  - Data: `datatype`, `initialvalue` (text, may be an empty element), `initialvalueenc` (an encrypted value: never read or stored, counted as `has_initial_value` 1 and `is_encrypted` 1), `private`, `alwaysinit`, `exposure` (present only when set: Environment, Statistic, Session; absent is None). Collection: the same plus `collectioninfo/field name type` and `initialvalue/row/field name type value`.
  - Action: `resource object action` (both may be empty: logged as `stage_missing_resource`, no edge), `inputs/input type name narrative expr`, `outputs/output type name narrative stage`.
  - SubSheet: `processid` holds the target page's `subsheetid` within the same process (the `calls_page` edge). Process: `processid` holds the target process id (the `calls_process` edge); documented, not in the public corpus. Both have inputs and outputs.
  - Code: `code` text (CDATA), inputs, outputs; the language comes from the object's ProcessInfo. ProcessInfo (objects, one each): `language`, `references/reference`, `imports/import`, `globalcode` (CDATA), `code`.
  - Navigate: `step` children with `element id`, `action/id` and `action/arguments/argument/id|value`. Read: `step stage="DataItem"`, `element id`, `action/id`. Write: `step expr="..."`, `element id`. WaitStart: `groupid`, `timeout`, `choices/choice reply` with `name`, `distance`, `ontrue`, `element id`, `condition/id`, `comparetype`. WaitEnd, LoopEnd, ChoiceEnd: `groupid`. LoopStart: `groupid`, `looptype`, `loopdata` (a collection name). ChoiceStart: `groupid`, `choices/choice expression` with `name`, `distance`, `ontrue`.
  - Exception: `exception type detail usecurrent savedetail`. Recover, Resume, Block, Anchor, Note, SubSheetInfo, Alert: nothing extra.
- `appdef`: `element name` with children `id`, `type`, `basetype`, `datatype`, `diagnose`, `attributes/attribute name inuse/ProcessValue datatype value`, and nested `element`; plus `apptypeinfo/id` and `apptypeinfo/parameters/parameter/name|value`. The element id is the `id` child, not an attribute; the type is the `type` child. Only the count of `attributes/attribute` is kept: attribute values and application parameters hold paths and window titles and are never stored.
- `environment-variable`: attributes `id` (this is the variable's name; `name` repeats it), `type`, `value`; child `description`. Values are masked and never stored.
- `credential`: attributes `id`, `name`; children `credentialType` and `members` with `process id` and `object id`. Members are only counted.
- `process-group` / `object-group`: attributes `id`, `name`, `isDefaultGroup`; `members` with `process|object id`.
- `webapiservice`: attributes `id`, `name`, `enabled`; a `configuration` subtree of which only the number of `configuration/actions/action` is read. Requests, headers and authentication are known-ignored and never stored.
- Blue Prism built-in objects appear as Action stages whose `resource object` is a class name. They are listed in `src/bpanalyse/config/internal_objects.yaml` as `{object, role, name_input}`: `Blueprism.Automate.clsWorkQueuesActions` (role work_queue, input `Queue Name`), `Blueprism.Automate.clsCredentialsActions` (role credential, input `Credentials Name`), `Blueprism.AutomateProcessCore.clsCollectionActions` (role collection).

## 3. Data model (SQLite, one file per run: `estate.sqlite`)

Entities, each with a stable id derived from the release file's own ids, never from position or name. Stage, page and element ids are only unique within one process or object (copied objects share them), so stage, page and app_element rows are keyed on (process_id, id); `app_element.object_id` is that process id. In `edge`, page and app_element endpoints are written as `process_id/id`.

- `release`: id (first 16 hex characters of the SHA-256 of the file bytes; the header package-id repeats across files so is never an identity), name, created, exported_by, source_file, package_id
- `process`: id, name, type (process | object), release_id, page_count (including the synthesised main page), stage_count, version, language (the object's ProcessInfo language), global_code_hash and global_code_line_count (the ProcessInfo `globalcode`, hashed like a code stage; empty hash when empty)
- `page`: id, process_id, name, type, is_main, is_published, stage_count (the main page has id `<process_id>/main`)
- `stage`: id, process_id, page_id, name, type (verbatim), x, y (from `display` or the older `displayx`/`displayy`)
- `code_stage`: stage_id, process_id, language (the owning object's), line_count, input_count, output_count, code_hash
- `data_item`: stage_id, process_id, datatype, exposure (None when absent), has_initial_value, is_masked, is_encrypted
- `calc_stage`: stage_id, process_id, expression_length, literal_count
- `app_element`: id (the `id` child), object_id, name, element_type (the `type` child), parent_id, attribute_count (number of `attributes/attribute`; values are never stored)
- `work_queue`: name, key_field, from_release
- `credential_ref`: name, from_release, member_count
- `environment_variable`: name (the `id` attribute), datatype (the `type` attribute), from_release
- `group`: id, name, kind (process | object), is_default, member_count
- `group_member`: group_id, member_id
- `web_api_service`: id, name, enabled, action_count
- `external_object`: name (an object referenced but not in the estate)

Relationships: one table `edge` with columns from_id, from_type, to_id, to_type, edge_type, evidence_stage_id, unresolved (0/1), release_id, detail, is_internal (1 only on `calls_object` edges to a built-in object). Two further columns, from_process_id and evidence_process_id, name the process or object that owns the from entity and the evidence stage; evidence is looked up on (evidence_process_id, evidence_stage_id).

- `calls_object`: process/object → object (from Action stage `resource object`; to_id is the object id when in the estate, otherwise the external_object row; a built-in object from `internal_objects.yaml` gives `to_type` internal_object, `is_internal` 1, and is never an external_object row)
- `calls_action`: process/object → object action page (resolved by object name + action name = published page name)
- `calls_process`: process → process (from Process stages, `processid`)
- `calls_page`: page → page within the same process (from SubSheet stages, `processid`, which holds the target page id)
- `uses_queue`: process/object → work_queue (Action on a built-in with role work_queue; queue name input literal resolves to the name, expression records `unresolved = 1` with the expression length only)
- `uses_credential`: process/object → credential_ref (built-in with role credential; same literal/unresolved rule)
- `uses_env_var`: process/object → environment_variable (Data stages with exposure = Environment, matched by stage name to the variable id)
- `uses_element`: page → app_element (Navigate, Read, Write, WaitStart steps)
- `handles_exception`: page → exception type string (Exception stages)

Every edge carries an `evidence_stage_id`. An edge with no evidence is a bug, not a row.

## 4. Parsing rules

4.1 Traverse every child of `bpr:release` and of `bpr:contents` and handle every element type. Any element or attribute the parser does not recognise is logged with its path and count, never silently skipped.

4.2 Stage type is taken from the `type` attribute verbatim. No remapping or grouping at parse time.

4.3 Action stage references are matched to objects by name, since that is how Blue Prism links them. Unmatched references are recorded as `external_object` rows, not dropped. The internal objects listed in `src/bpanalyse/config/internal_objects.yaml` are never external and never in the release map; their calls are kept as `calls_object` edges with `is_internal` 1, and are left out of fan_out, fan_in and depth. A queue or credential action with no name input at all (for example Mark Completed) gives no `uses_queue` or `uses_credential` edge.

4.4 Object action pages: a page is an action if its `type` is `Normal` and `published` is true. Record `is_main` (the synthesised main page), `type`, and `is_published` separately.

4.5 Code stages: store a SHA-256 of the normalised code body (all whitespace removed) so duplicate code across the estate is detectable. Never store the code itself. An empty body has an empty `code_hash` and is never a duplicate.

4.6 Calculation stages: store expression length and a count of quoted string literals only. Lengths are measured after masking.

4.7 Process id collisions across files: the copy from the release with the later `bpr:created` wins; equal timestamps keep the first file in sorted filename order. Every collision is logged with both file names and both created values.

## 5. Derived metrics

Computed after parse, stored in a `metrics` table keyed by process or object id. Each metric is one number.

- `fan_out`: distinct objects called (external included, built-in internal objects excluded)
- `fan_in`: distinct processes or objects that call this one
- `depth`: longest call chain from this process to a leaf object, computed over strongly connected components so a cycle counts as one step
- `code_stage_ratio`: code stages ÷ total stages
- `calc_stage_ratio`: calculation stages (Calculation + MultipleCalculation) ÷ total stages
- `exception_coverage`: among the pages that have at least one Action stage, the pages that also have a Recover stage, divided by the number of pages with an Action stage (0 when no page has an Action stage)
- `orphan`: fan_in = 0 (1/0). Meaningful for objects; for processes it only says no other process calls it, because schedules are not in a release
- `dead_pages`: count of pages with no inbound `calls_page` edge, not main, not published, not type CleanUp
- `duplicate_code_stages`: count of this item's code stages whose code_hash appears in more than one stage across the estate
- `unresolved_refs`: count of this item's edges with unresolved = 1
- `masked_literals`: count of sanitised values in this item
- `external_calls`: count of `calls_object` edges to external objects

## 6. Outputs, fixed schema, fixed sort

Each output is written every run whether or not it has rows. Column names and order are fixed. Sort order is fixed. No merged cells, no notes columns, no summary sheets, no formatting beyond a bold header row.

6.1 `inventory.xlsx`: one sheet per entity type from section 3, columns in the order listed, sorted by name (then id).

6.2 `dependencies.xlsx`: one sheet per edge type, columns from_name, from_type, to_name, to_type, evidence_page, evidence_stage, unresolved, sorted by from_name, to_name, evidence_stage.

6.3 `release_map.xlsx`: one sheet (built-in internal objects are not listed), columns process_name, object_name, action_name, call_count, sorted by process_name, object_name, action_name. Reproduces the Release Analyser's Release Map so the team can drop the old tool.

6.4 `metrics.xlsx`: one sheet, one row per process or object, columns name, type, then one column per metric in section 5 order, sorted by fan_in descending then name.

6.5 `findings.xlsx`: one sheet, columns finding_type (orphan | dead_page | duplicate_code | unresolved_ref | external_object | masked_literal | missing_exception_handling), entity_name, entity_type, page_name, stage_name, detail (one identifier only, never a sentence), sorted by finding_type, entity_name, page_name, stage_name. `missing_exception_handling` applies to processes only: a page with an Action stage and no Recover stage.

6.6 `graph.json` (nodes and edges with all attributes, keys sorted, two-space indent, LF line endings; page and app_element node ids are `process_id/id`) and `graph.graphml` for downstream visualisation.

6.7 `run.log`: file count, per-file entity counts, edge counts, unrecognised elements, attributes, stage types and contents kinds with counts (paths as written by `discover`), recognised-but-skipped contents kinds, collisions, masked value counts, parse errors with file and line. Contains no data values, only names, counts and paths.

## 7. Queries

`query` subcommand against `estate.sqlite`, each returning a table with the columns of 6.2, printed as tab-separated text and optionally written to xlsx with `--out`:

- `impact <name>`: everything upstream that would be affected by a change, to full depth
- `depends <name>`: everything downstream this entity relies on, to full depth
- `queue <queue name>`: every process or object that uses it
- `credential <name>`: every user

Results are tables, not prose. No tool output ever contains a generated sentence.

## 8. Non-functional

8.1 Deterministic: the same input directory produces a byte-identical `graph.json` and identical spreadsheet cell contents on every run. Workbook metadata timestamps are pinned to a fixed value.

8.2 A parse error in one file fails that file and continues with the rest; the run exits non-zero and `run.log` names the file and line.

8.3 Performance target: 200 processes and objects, 50k stages, under 60 seconds.

8.4 No network access. No writes outside the output directory.

## 9. Acceptance tests, all automated (`pytest`)

- Golden test: the three fixture releases parse to a `graph.json` byte-identical to `fixtures/expected/graph.json`; the test fails on any diff.
- Every stage type in the fixtures is counted correctly per page.
- `Policy Lookup` called by two processes shows fan_in = 2 and the two `calls_object` edges carry different evidence stage ids.
- `External Mailer` appears as an `external_object` finding, not an error.
- The `Add To Audit Queue` stage's queue edge has unresolved = 1.
- `ops.mailbox@example.com` and `12345678` (account number pattern) appear as masked literals and are absent from every output file, verified by reading every file in the output directory.
- Two runs on the same input produce identical `graph.json` hashes and identical xlsx cell contents.
- `Policy Lookup` version 1.4 (from `claims-core`, created later) wins over version 1.2 (from `policy-lookup-legacy`), and the collision is in `run.log`.
- `FutureStage` and the unknown contents item `future-thing` appear in `run.log` as unrecognised, and the run still succeeds.
- The two code stages sharing a body (`Normalise Status`, `Upper Trim Code`) share a code_hash despite different whitespace.
- The fixtures cover the real shape: implicit main page, `displayx` positions, an encrypted initial value that reaches no output, an env var named by `id`, credential members, groups, a web API service, built-in objects flagged `is_internal`, `processid` targets for SubSheet and Process stages, and a release id that is the file hash.
- `discover` writes a sorted, value-free census, and the `run.log` unrecognised list is a subset of it.
- The public corpus (`tests/test_public_corpus.py`, skipped when `fixtures/public/` is empty) parses without error, yields every process and object in the census (11 processes and 8 objects), logs no `unrecognised` line, resolves the literal `Queue 2`, records an unresolved credential edge, and leaves the env var values `DigitalExchange` and `c:\blueprism` out of every output file.

## 10. Out of scope for this version

Session log analysis, run-time performance, Power Platform or WorkHQ artefacts, refactor opportunity detection (code stage consolidation, API replacement, in-process duplication; these need loop/block nesting and endpoint literals, both excluded here), and any UI. The graph export is the integration point.

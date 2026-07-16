# Lattice. Blue Prism Release Analyser

An internal analysis tool for a Blue Prism automation estate. It ingests
`.bprelease` export files, parses them into a normalised estate graph, and
answers questions Blue Prism itself cannot: impact of change, duplicated
logic, deviations from best practice, and modernisation opportunities.

## The client-side data guarantee

**Nothing leaves your machine.** Lattice is fully client-side: no backend,
no network calls at runtime, no telemetry, no analytics, no CDN resources.
Release files are read in the browser via the file picker or drag-and-drop,
parsed locally in Web Workers, and only the parsed model (never the raw
file bytes) is cached in your browser's IndexedDB. A "clear all local data"
control removes everything. Release files must never be committed to this
repository; `.gitignore` blocks `*.bprelease` and `/local-data/`.

All tests run against synthetic fixtures produced by the generator in
`src/lib/fixtures/`. Real release files are never required and never read
by the test suite.

## Running it

```
npm install
npm run dev        # development server
npm run build      # type-check and production build (static output in dist/)
npm run test       # vitest suite, including the synthetic 150-file batch
npm run lint       # eslint
```

The production build in `dist/` is static and can be served from any local
folder or internal file share.

## Phase status

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | Ingest, parse, estate graph, impact analysis | In progress |
| 2 | Reusability and clone detection | Not started |
| 3 | Quality rules engine | Not started |
| 4 | Process visualisation | Not started |
| 5 | Opportunity detection | Not started |

## Dependency justification

Every runtime dependency must earn its place; this list is the audit trail.

| Package | Why |
| ------- | --- |
| `react`, `react-dom` | UI layer, per the agreed stack. |
| `zustand` | Application state, per the agreed stack. Small, no transitive dependencies. |
| `@rgrove/parse-xml` | XML parsing inside Web Workers, where the browser's `DOMParser` is unavailable. Zero dependencies, small, spec-conformant, and reports line/column positions, which the structured per-file error reports require. |
| `@fontsource/fraunces`, `@fontsource/jetbrains-mono` | Brand typography bundled locally so nothing is fetched from a CDN at runtime. |

Dev-only: Vite, TypeScript, Vitest, ESLint, `fake-indexeddb` (IndexedDB in
Node for persistence tests), and their type packages.

## Documentation

- `docs/data-model.md`: the estate graph, node and edge types, identity and
  provenance rules, persistence schema.
- `docs/rules-catalogue.md`: quality rules (phase 3, not started).

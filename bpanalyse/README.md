# bpanalyse

bpanalyse reads Blue Prism 7.2 release files (`.bprelease`) and produces an estate inventory, a dependency graph, quality metrics, findings and impact queries. It is deterministic, runs offline and uses no LLM. The contract is in `SPEC.md`.

## Install

Python 3.11 or later is needed. From this directory:

    pip install -e .

The runtime dependencies are openpyxl and pyyaml. To run the tests you also need pytest (`pip install -e ".[test]"`).

## Run

    python -m bpanalyse run ./input ./output

This reads every `*.bprelease` file in `./input` and writes `estate.sqlite`, `inventory.xlsx`, `dependencies.xlsx`, `release_map.xlsx`, `metrics.xlsx`, `findings.xlsx`, `graph.json`, `graph.graphml` and `run.log` to `./output`. The exit code is 0 on success, 2 if any input file failed to parse (the other files are still processed and `run.log` names the failing file and line), and 1 on a usage error.

Sensitive literals are masked in memory before parsing, using the patterns in `config/mask_patterns.yaml`. The internal Work Queues and Credentials object names, and the input names used to find the queue or credential, are in `config/internal_objects.yaml`. Use `--config-dir` to point at a different config directory.

## Query

    python -m bpanalyse query impact "Policy Lookup" --db output/estate.sqlite

The subcommands are `impact` (everything upstream), `depends` (everything downstream), `queue` and `credential`. Results are printed as tab-separated text using the columns of `dependencies.xlsx`. Add `--out result.xlsx` to write the table to a workbook as well.

## Tests

    python -m pytest -q

There is one test module per acceptance test group in SPEC section 9. The golden test compares the `graph.json` produced from `fixtures/releases` with `fixtures/expected/graph.json` byte for byte.

## Regenerating the golden file

After an intentional change to the graph output, review the change and then regenerate the golden file:

    python -m bpanalyse run fixtures/releases fixtures/expected --golden

With `--golden` the tool writes only `graph.json` to the output directory (no database, workbooks or log). Check the diff of `fixtures/expected/graph.json` before committing it.

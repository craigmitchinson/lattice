# bpanalyse

bpanalyse reads Blue Prism release files (`.bprelease`) and produces an estate inventory, a dependency graph, quality metrics, findings and impact queries. It is deterministic, runs offline and uses no LLM. The contract is in `SPEC.md`.

## Where it runs

On your own machine, and nowhere else. The repository is only where the code lives. The tool makes no network calls and writes only to the output directory you name. Keep real release files outside the repository folder (for example `~/bp-releases` on a Mac or `C:\bp-releases` on Windows) so they are never in a workspace that an editor, an editor extension or git can see. The `.gitignore` also blocks `*.bprelease` and `bpanalyse/input/` as a second line of defence.

## Install

Python 3.11 or later is needed.

Mac, in Terminal (if `python3` asks for developer tools, run `xcode-select --install` once, or install Python from python.org):

    git clone https://github.com/craigmitchinson/lattice.git
    cd lattice/bpanalyse
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -e ".[test]"
    python -m pytest -q

Windows, in PowerShell (install Python from python.org with "Add to PATH" ticked):

    git clone https://github.com/craigmitchinson/lattice.git
    cd lattice\bpanalyse
    py -m venv .venv
    .venv\Scripts\activate
    pip install -e ".[test]"
    python -m pytest -q

Activate the virtual environment (`source .venv/bin/activate` or `.venv\Scripts\activate`) each time you open a new terminal before running the tool.

The runtime dependencies are openpyxl and pyyaml. `[test]` adds pytest.

## Run

    python -m bpanalyse run ~/bp-releases ~/bp-output

This reads every `*.bprelease` file in the first directory and writes `estate.sqlite`, `inventory.xlsx`, `dependencies.xlsx`, `release_map.xlsx`, `metrics.xlsx`, `findings.xlsx`, `graph.json`, `graph.graphml` and `run.log` to the second. The exit code is 0 on success, 2 if any input file failed to parse (the other files are still processed and `run.log` names the failing file and line), and 1 on a usage error.

Sensitive literals are masked in memory before parsing, using the patterns in `src/bpanalyse/config/mask_patterns.yaml`. The Blue Prism built-in objects (Work Queues, Credentials, Collections), their roles, and the input names used to find the queue or credential are a list of `{object, role, name_input}` in `src/bpanalyse/config/internal_objects.yaml`; add entries there as more turn up. Use `--config-dir` to point at a different config directory.

## Discover

    python -m bpanalyse discover ~/bp-releases ~/bp-census.txt

Writes every element and attribute path found in the release files with its count (stage paths are keyed by stage type), as sorted `path count` lines. It contains no values, only names, counts and stage type names, so it is safe to send back. This is the schema fixture mechanism (SPEC 2.5): run it over real exports and compare with SPEC 2.6. The `unrecognised` lines in `run.log` use the same paths.

## Query

    python -m bpanalyse query impact "Policy Lookup" --db ~/bp-output/estate.sqlite

The subcommands are `impact` (everything upstream), `depends` (everything downstream), `queue` and `credential`. Results are printed as tab-separated text using the columns of `dependencies.xlsx`. Add `--out result.xlsx` to write the table to a workbook as well.

## Tests

    python -m pytest -q

There is one test module per acceptance test group in SPEC section 9. The golden test compares the `graph.json` produced from `fixtures/releases` with `fixtures/expected/graph.json` byte for byte.

## Public corpus

Eight real public exports (Blue Prism 5.0 to 6.10) are the current schema authority. They are gitignored; download them once with

    python fixtures/public/fetch.py

after which `python -m pytest -q` also runs `tests/test_public_corpus.py` (it is skipped when `fixtures/public/` holds no `.bprelease` files). You can also run the tool over them: `python -m bpanalyse run fixtures/public ~/pub-out`.

## Regenerating the fixtures

The synthetic releases in `fixtures/releases` are written by `python fixtures/generate.py` (deterministic, standard library only). Regenerate the golden file afterwards.

## Regenerating the golden file

After an intentional change to the graph output, review the change and then regenerate the golden file:

    python -m bpanalyse run fixtures/releases fixtures/expected --golden

With `--golden` the tool writes only `graph.json` to the output directory (no database, workbooks or log). Check the diff of `fixtures/expected/graph.json` before committing it.

"""SPEC 9: two runs give identical graph.json hashes and identical spreadsheet cell contents; xlsx files are byte-identical."""

import hashlib
import time

from conftest import run_into, sheet_cells

XLSX = ("inventory", "dependencies", "release_map", "metrics", "findings")


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_two_runs_identical(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    assert run_into(a) == 0
    time.sleep(1.1)  # cross a wall-clock second so any embedded timestamp would differ
    assert run_into(b) == 0
    assert _sha(a / "graph.json") == _sha(b / "graph.json")
    for name in XLSX:
        assert sheet_cells(a / (name + ".xlsx")) == sheet_cells(b / (name + ".xlsx"))
        assert _sha(a / (name + ".xlsx")) == _sha(b / (name + ".xlsx")), name
    assert (a / "run.log").read_bytes() == (b / "run.log").read_bytes()

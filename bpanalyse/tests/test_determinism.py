"""SPEC 9: two runs give identical graph.json hashes and identical spreadsheet cell contents."""

import hashlib

from conftest import run_into, sheet_cells


def test_two_runs_identical(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    assert run_into(a) == 0 and run_into(b) == 0
    assert hashlib.sha256((a / "graph.json").read_bytes()).hexdigest() == hashlib.sha256((b / "graph.json").read_bytes()).hexdigest()
    for name in ("inventory", "dependencies", "release_map", "metrics", "findings"):
        assert sheet_cells(a / (name + ".xlsx")) == sheet_cells(b / (name + ".xlsx"))
    assert (a / "run.log").read_bytes() == (b / "run.log").read_bytes()

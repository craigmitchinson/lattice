"""Shared fixtures: run the tool once over the fixture releases."""

import sqlite3
from pathlib import Path

import openpyxl
import pytest

from bpanalyse.cli import main

ROOT = Path(__file__).resolve().parents[1]
RELEASES = ROOT / "fixtures" / "releases"
GOLDEN = ROOT / "fixtures" / "expected" / "graph.json"


def run_into(out: Path) -> int:
    return main(["run", str(RELEASES), str(out)])


def sheet_cells(path: Path) -> dict[str, list[tuple]]:
    wb = openpyxl.load_workbook(path)
    return {ws.title: [tuple(r) for r in ws.iter_rows(values_only=True)] for ws in wb}


@pytest.fixture(scope="session")
def out_dir(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("out")
    assert run_into(out) == 0
    return out


@pytest.fixture(scope="session")
def db(out_dir) -> sqlite3.Connection:
    return sqlite3.connect(out_dir / "estate.sqlite")

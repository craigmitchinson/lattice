"""The eight real public exports (BP 5.0 to 6.10): fetch with `python fixtures/public/fetch.py`. Skipped when the directory is empty."""

import sqlite3
from collections import Counter

import pytest
from conftest import ROOT, all_output_bytes

from bpanalyse.cli import main
from bpanalyse.parse import child, children, contents_of, load_tree
from bpanalyse.sanitise import local

PUBLIC = ROOT / "fixtures" / "public"
FILES = sorted(PUBLIC.glob("*.bprelease"))
pytestmark = pytest.mark.skipif(not FILES, reason="no public corpus: run fixtures/public/fetch.py")
QUEUES = "Blueprism.Automate.clsWorkQueuesActions"


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    out = tmp_path_factory.mktemp("public")
    rc = main(["run", str(PUBLIC), str(out)])
    return rc, out, (out / "run.log").read_text().splitlines(), sqlite3.connect(out / "estate.sqlite")


def test_every_file_parses(run):
    assert run[0] == 0
    assert run[2][0] == f"file_count={len(FILES)}"


def test_every_process_and_object_is_parsed(run):
    """Census: 11 `bpr:process` + 8 `bpr:object` wrappers across the eight files = 19 (the same id in two files is one estate row)."""
    _, _, log, db = run
    raw = [w for f in FILES for w in contents_of(load_tree(f)) if local(w.tag) in ("process", "object")]
    assert (sum(local(w.tag) == "process" for w in raw), sum(local(w.tag) == "object" for w in raw)) == (11, 8)
    per_file = [dict(kv.split("=") for kv in line.split()[1:]) for line in log if line.startswith("file=")]
    assert sum(int(p["processes"]) + int(p["objects"]) for p in per_file) == 19
    collisions = [line for line in log if line.startswith("collision ")]
    assert db.execute("SELECT count(*) FROM process").fetchone()[0] + len(collisions) == 19


def test_nothing_unrecognised(run):
    assert [line for line in run[2] if line.startswith("unrecognised")] == []


def test_queue_edges_resolve_literals(run):
    """Queue Name inputs of Work Queues actions, keyed by (process id, stage id) so a process exported twice counts once."""
    db = run[3]
    expected = set()
    for f in FILES:
        for w in contents_of(load_tree(f)):
            for st in (e for e in w.iter() if local(e.tag) == "stage" and e.get("type") == "Action"):
                res = child(st, "resource")
                if res is not None and res.get("object") == QUEUES and any(i.get("name") == "Queue Name" for i in children(child(st, "inputs"), "input")):
                    expected.add((w.get("id"), st.get("stageid")))
    edges = db.execute("SELECT to_id, unresolved FROM edge WHERE edge_type = 'uses_queue'").fetchall()
    assert len(edges) == len(expected) >= 8
    assert ("Queue 2", 0) in edges
    assert Counter(name for name, _ in edges)["Queue 2"] == 2


def test_credential_name_from_a_variable_is_unresolved(run):
    assert run[3].execute("SELECT count(*) FROM edge WHERE edge_type = 'uses_credential' AND unresolved = 1").fetchone()[0] >= 1


def test_internal_objects_not_external(run):
    db = run[3]
    assert db.execute("SELECT count(*) FROM external_object WHERE name LIKE 'Blueprism.%'").fetchone() == (0,)
    assert db.execute("SELECT count(*) FROM edge WHERE is_internal = 1 AND to_id = ?", (QUEUES,)).fetchone()[0] > 0


def test_sensitive_env_values_are_in_no_output(run):
    _, out, log, _ = run
    for blob in all_output_bytes(out):
        low = blob.lower()
        assert b"digitalexchange" not in low and b"c:\\blueprism" not in low
    assert 'masked owner="Blue Prism Access Report - Save Directory" count=1' in log

"""SPEC 9: fixture releases parse to a graph.json byte-identical to the golden file."""

from conftest import GOLDEN


def test_graph_json_matches_golden(out_dir):
    assert (out_dir / "graph.json").read_bytes() == GOLDEN.read_bytes()

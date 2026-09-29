"""Owns the command line: argument parsing, the run pipeline and the query subcommand."""

from __future__ import annotations

import argparse
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

from bpanalyse import outputs, parse, query, store
from bpanalyse.findings import compute_findings
from bpanalyse.graph import build_edges, load_internal_objects, merge
from bpanalyse.metrics import compute_metrics
from bpanalyse.model import ParsedFile
from bpanalyse.sanitise import load_mask_config, sanitise

DEFAULT_CONFIG = Path(__file__).resolve().parents[2] / "config"


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # usage errors exit 1, not argparse's default 2
        self.print_usage(sys.stderr)
        sys.exit(1)


def _read_files(input_dir: Path, config_dir: Path):
    masks = load_mask_config(config_dir / "mask_patterns.yaml")
    parsed: list[ParsedFile] = []
    unknowns: Counter[str] = Counter()
    failures: list[tuple[str, int]] = []
    for path in sorted(input_dir.glob("*.bprelease")):
        try:
            tree, counts = sanitise(parse.load_tree(path), masks)
            unknowns.update(parse.find_unknowns(tree))
            parsed.append(parse.parse_release(tree, path.name, counts))
        except ET.ParseError as exc:
            failures.append((path.name, exc.position[0]))
        except (ValueError, OSError):
            failures.append((path.name, 0))
    return parsed, unknowns, failures


def run(input_dir: Path, out_dir: Path, config_dir: Path = DEFAULT_CONFIG, golden: bool = False) -> int:
    parsed, unknowns, failures = _read_files(input_dir, config_dir)
    estate, collisions = merge(parsed)
    graph = build_edges(estate, load_internal_objects(config_dir / "internal_objects.yaml"))
    metrics = compute_metrics(estate, graph.edges)
    findings = compute_findings(estate, graph.edges, metrics)
    out_dir.mkdir(parents=True, exist_ok=True)
    db_path = out_dir / "estate.sqlite"
    if not golden:
        db_path.unlink(missing_ok=True)
    conn = sqlite3.connect(":memory:" if golden else str(db_path))
    store.write_db(conn, estate, graph, metrics, findings)
    if golden:
        outputs.write_graph_json(out_dir / "graph.json", outputs.graph_data(conn))
    else:
        per_file = {pf.release.source_file: Counter(
            processes=sum(p.process.type == "process" for p in pf.processes), objects=sum(p.process.type == "object" for p in pf.processes),
            pages=sum(len(p.pages) for p in pf.processes), stages=sum(len(p.stages) for p in pf.processes),
            work_queues=len(pf.queues), credentials=len(pf.credentials), environment_variables=len(pf.env_vars)) for pf in parsed}
        log = outputs.build_log([pf.release.source_file for pf in parsed], per_file, Counter(e.edge_type for e in graph.edges),
                                unknowns, collisions, estate, failures)
        outputs.write_all(conn, out_dir, log)
    conn.close()
    return 2 if failures else 0


def run_query_command(kind: str, name: str, db: Path, out: Path | None) -> int:
    if not db.is_file():
        return 1
    conn = sqlite3.connect(str(db))
    rows = query.run_query(conn, kind, name)
    conn.close()
    print("\t".join(query.DEP_COLUMNS))
    for row in rows:
        print("\t".join(str(v) for v in row))
    if out is not None:
        outputs.write_xlsx(out, [(kind, query.DEP_COLUMNS, rows)])
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = _Parser(prog="bpanalyse")
    sub = ap.add_subparsers(dest="command", required=True, parser_class=_Parser)
    r = sub.add_parser("run")
    r.add_argument("input_dir", type=Path)
    r.add_argument("output_dir", type=Path)
    r.add_argument("--config-dir", type=Path, default=DEFAULT_CONFIG)
    r.add_argument("--golden", action="store_true", help="write only graph.json (used to regenerate the golden file)")
    q = sub.add_parser("query")
    q.add_argument("kind", choices=["impact", "depends", "queue", "credential"])
    q.add_argument("name")
    q.add_argument("--db", type=Path, required=True)
    q.add_argument("--out", type=Path)
    args = ap.parse_args(argv)
    if args.command == "run":
        if not args.input_dir.is_dir():
            return 1
        return run(args.input_dir, args.output_dir, args.config_dir, args.golden)
    return run_query_command(args.kind, args.name, args.db, args.out)

"""Owns the command line: argument parsing, the run pipeline and the query subcommand."""

from __future__ import annotations

import argparse
import sqlite3
import sys
from collections import Counter
from importlib import resources
from pathlib import Path
from xml.etree import ElementTree as ET

from bpanalyse import outputs, parse, query, store
from bpanalyse.findings import compute_findings
from bpanalyse.graph import build_edges, load_internal_objects, merge
from bpanalyse.metrics import compute_metrics
from bpanalyse.model import ParsedFile
from bpanalyse.sanitise import ConfigError, load_mask_config, sanitise

DEFAULT_CONFIG = Path(str(resources.files("bpanalyse") / "config"))  # ships inside the package: editable install and wheel alike


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # usage errors exit 1, not argparse's default 2
        self.print_usage(sys.stderr)
        sys.exit(1)


def _release_files(input_dir: Path) -> list[Path]:
    return sorted((p for p in input_dir.iterdir() if p.is_file() and p.name.lower().endswith(".bprelease")), key=lambda p: p.name)


def _read_files(input_dir: Path, config_dir: Path):
    masks = load_mask_config(config_dir / "mask_patterns.yaml")
    parsed: list[ParsedFile] = []
    unknowns: Counter[str] = Counter()
    failures: list[tuple[str, int, str, str]] = []
    for path in _release_files(input_dir):
        try:
            tree, marks = sanitise(parse.load_tree(path), masks)
            unknowns.update(parse.census(tree)[1])
            parsed.append(parse.parse_release(tree, path.name, parse.file_id(path), marks))
        except parse.ReleaseError as exc:
            failures.append((path.name, exc.line or parse.line_of(path, exc.ident, exc.name), exc.event, exc.fields))
        except ET.ParseError as exc:
            failures.append((path.name, exc.position[0], "parse_error", ""))
        except (ValueError, OSError):
            failures.append((path.name, 0, "parse_error", ""))
    return parsed, unknowns, failures


def run(input_dir: Path, out_dir: Path, config_dir: Path = DEFAULT_CONFIG, golden: bool = False) -> int:
    if not config_dir.is_dir():
        print(f"config_dir_missing dir={config_dir}", file=sys.stderr)
        return 1
    if not _release_files(input_dir):
        print(f"no_input_files dir={input_dir}", file=sys.stderr)
        return 1
    try:
        internal = load_internal_objects(config_dir / "internal_objects.yaml")
    except ConfigError as exc:
        print(f"internal_objects_config_error reason={exc}", file=sys.stderr)
        return 1
    try:
        parsed, unknowns, failures = _read_files(input_dir, config_dir)
    except ConfigError as exc:
        print(f"mask_config_error reason={exc}", file=sys.stderr)
        return 1
    estate, collisions = merge(parsed)
    graph = build_edges(estate, internal)
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
            work_queues=len(pf.queues), credentials=len(pf.credentials), environment_variables=len(pf.env_vars),
            groups=len(pf.groups), web_api_services=len(pf.web_api_services),
            **{"skipped_" + k.replace("-", "_"): n for k, n in pf.kind_counts.items()}) for pf in parsed}
        log = outputs.build_log([pf.release.source_file for pf in parsed], per_file, Counter(e.edge_type for e in graph.edges),
                                unknowns, collisions, estate, failures, [*estate.notes, *graph.notes])
        outputs.write_all(conn, out_dir, log)
    conn.close()
    return 2 if failures else 0


def discover(input_dir: Path, out_file: Path) -> int:
    """Write the element/attribute path census of every release in the directory: `path count`, sorted, no values."""
    total: Counter[str] = Counter()
    failed = 0
    for path in _release_files(input_dir):
        try:
            total.update(parse.census(parse.load_tree(path))[0])
        except (parse.ReleaseError, ET.ParseError, ValueError, OSError):
            failed += 1
            print(f"parse_error file={path.name}", file=sys.stderr)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text("".join(f"{p} {n}\n" for p, n in sorted(total.items())), encoding="utf-8", newline="\n")
    return 2 if failed else 0


def _tsv(value: object) -> str:
    return str(value).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def run_query_command(kind: str, name: str, db: Path, out: Path | None) -> int:
    if not db.is_file():
        print(f"no_database path={db}", file=sys.stderr)
        return 1
    conn = sqlite3.connect(str(db))
    if not query.name_exists(conn, kind, name):
        conn.close()
        print(f"not_found name={_tsv(name)}", file=sys.stderr)
        return 1
    rows = query.run_query(conn, kind, name)
    conn.close()
    print("\t".join(query.DEP_COLUMNS))
    for row in rows:
        print("\t".join(_tsv(v) for v in row))
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
    d = sub.add_parser("discover", help="write the element/attribute path census of a directory of releases (no values)")
    d.add_argument("input_dir", type=Path)
    d.add_argument("out_file", type=Path)
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
    if args.command == "discover":
        return discover(args.input_dir, args.out_file) if args.input_dir.is_dir() else 1
    return run_query_command(args.kind, args.name, args.db, args.out)

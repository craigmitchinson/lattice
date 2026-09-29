"""Owns the SQLite schema and the inserts that populate it."""

from __future__ import annotations

import sqlite3
from dataclasses import astuple
from collections.abc import Iterable
from typing import Any

from bpanalyse.graph import GraphResult
from bpanalyse.metrics import METRIC_NAMES, MetricRow
from bpanalyse.model import Estate, Finding

SCHEMA = """
CREATE TABLE release (id TEXT, name TEXT, created TEXT, exported_by TEXT, source_file TEXT);
CREATE TABLE process (id TEXT, name TEXT, type TEXT, release_id TEXT, page_count INTEGER, stage_count INTEGER, version TEXT);
CREATE TABLE page (id TEXT, process_id TEXT, name TEXT, type TEXT, is_main INTEGER, is_published INTEGER, stage_count INTEGER);
CREATE TABLE stage (id TEXT, process_id TEXT, page_id TEXT, name TEXT, type TEXT, x INTEGER, y INTEGER);
CREATE TABLE code_stage (stage_id TEXT, process_id TEXT, language TEXT, line_count INTEGER, input_count INTEGER, output_count INTEGER, code_hash TEXT);
CREATE TABLE data_item (stage_id TEXT, process_id TEXT, datatype TEXT, exposure TEXT, has_initial_value INTEGER, is_masked INTEGER);
CREATE TABLE calc_stage (stage_id TEXT, process_id TEXT, expression_length INTEGER, literal_count INTEGER);
CREATE TABLE app_element (id TEXT, object_id TEXT, name TEXT, element_type TEXT, parent_id TEXT, attribute_count INTEGER);
CREATE TABLE work_queue (name TEXT, key_field TEXT, from_release TEXT);
CREATE TABLE credential_ref (name TEXT, from_release TEXT);
CREATE TABLE environment_variable (name TEXT, datatype TEXT, from_release TEXT);
CREATE TABLE external_object (name TEXT);
CREATE TABLE edge (from_id TEXT, from_process_id TEXT, from_type TEXT, to_id TEXT, to_type TEXT, edge_type TEXT, evidence_stage_id TEXT, evidence_process_id TEXT, unresolved INTEGER, release_id TEXT, detail TEXT);
CREATE TABLE release_map (process_name TEXT, object_name TEXT, action_name TEXT, call_count INTEGER);
CREATE TABLE finding (finding_type TEXT, entity_name TEXT, entity_type TEXT, page_name TEXT, stage_name TEXT, detail TEXT);
"""
METRICS_DDL = "CREATE TABLE metrics (id TEXT, name TEXT, type TEXT, " + ", ".join(m + " REAL" for m in METRIC_NAMES) + ");"


def _insert(conn: sqlite3.Connection, table: str, rows: Iterable[tuple[Any, ...]]) -> None:
    rows = list(rows)
    if rows:
        conn.executemany(f"INSERT INTO {table} VALUES ({','.join('?' * len(rows[0]))})", rows)


def write_db(conn: sqlite3.Connection, estate: Estate, graph: GraphResult, metrics: list[MetricRow], findings: list[Finding]) -> None:
    conn.executescript(SCHEMA + METRICS_DDL)
    procs = estate.processes
    _insert(conn, "release", (astuple(r) for r in sorted(estate.releases, key=lambda r: (r.name, r.id))))
    _insert(conn, "process", (astuple(p.process) for p in procs))
    for table, attr in (("page", "pages"), ("stage", "stages"), ("code_stage", "code_stages"), ("data_item", "data_items"),
                        ("calc_stage", "calc_stages"), ("app_element", "app_elements")):
        _insert(conn, table, (astuple(x) for p in procs for x in getattr(p, attr)))
    _insert(conn, "work_queue", (astuple(q) for q in sorted(estate.queues, key=lambda q: q.name)))
    _insert(conn, "credential_ref", (astuple(c) for c in sorted(estate.credentials, key=lambda c: c.name)))
    _insert(conn, "environment_variable", (astuple(e) for e in sorted(estate.env_vars, key=lambda e: e.name)))
    _insert(conn, "external_object", ((n,) for n in graph.externals))
    _insert(conn, "edge", (astuple(e) for e in graph.edges))
    _insert(conn, "release_map", graph.release_map)
    _insert(conn, "finding", (astuple(f) for f in findings))
    _insert(conn, "metrics", ((m.id, m.name, m.type, *(m.values[k] for k in METRIC_NAMES)) for m in metrics))
    conn.commit()

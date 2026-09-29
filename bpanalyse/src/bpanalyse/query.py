"""Owns reading edges back from estate.sqlite as named rows, and the impact/depends/queue/credential queries."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

DEP_COLUMNS = ("from_name", "from_type", "to_name", "to_type", "evidence_page", "evidence_stage", "unresolved")


@dataclass(frozen=True)
class NamedEdge:
    edge_type: str
    from_id: str
    to_id: str
    row: tuple[str | int, ...]  # DEP_COLUMNS order


def named_edges(conn: sqlite3.Connection) -> list[NamedEdge]:
    names: dict[str, str] = {}
    for table in ("process", "page", "app_element"):
        names.update(conn.execute(f"SELECT id, name FROM {table}"))
    stages = {i: (n, names.get(p, "")) for i, n, p in conn.execute("SELECT id, name, page_id FROM stage")}
    out = []
    for e in conn.execute("SELECT edge_type, from_id, from_type, to_id, to_type, evidence_stage_id, unresolved FROM edge"):
        et, fid, ft, tid, tt, sid, unres = e
        sname, pname = stages.get(sid, ("", ""))
        out.append(NamedEdge(et, fid, tid, (names.get(fid, fid), ft, names.get(tid, tid), tt, pname, sname, unres)))
    return sorted(out, key=lambda n: (n.row[0], n.row[2], n.row[5], n.edge_type, n.from_id, n.to_id))


def _owners(conn: sqlite3.Connection) -> dict[str, str]:
    return dict(conn.execute("SELECT id, process_id FROM page")) | {i: i for (i,) in conn.execute("SELECT id FROM process")}


def _ids_named(conn: sqlite3.Connection, name: str) -> set[str]:
    ids = {i for (i,) in conn.execute("SELECT id FROM process WHERE name = ?", (name,))}
    ids |= {n for (n,) in conn.execute("SELECT name FROM external_object WHERE name = ?", (name,))}
    return ids


def _walk(conn: sqlite3.Connection, name: str, upstream: bool) -> list[NamedEdge]:
    owners = _owners(conn)
    pages_of: dict[str, set[str]] = {}
    for page, proc in owners.items():
        pages_of.setdefault(proc, set()).add(page)
    edges = [e for e in named_edges(conn) if e.to_id]
    seen, frontier, hits = set(), _ids_named(conn, name), []
    while frontier:
        seen |= frontier
        members = set().union(*(pages_of.get(i, {i}) | {i} for i in frontier))
        nxt: set[str] = set()
        for e in edges:
            if owners.get(e.from_id, e.from_id) == owners.get(e.to_id, e.to_id):
                continue
            hit, other = (e.to_id, e.from_id) if upstream else (e.from_id, e.to_id)
            if hit in members:
                hits.append(e)
                nxt.add(owners.get(other, other))
        frontier = nxt - seen
    return sorted(set(hits), key=lambda n: (n.row[0], n.row[2], n.row[5], n.edge_type, n.from_id, n.to_id))


def run_query(conn: sqlite3.Connection, kind: str, name: str) -> list[tuple[str | int, ...]]:
    if kind in ("impact", "depends"):
        return [e.row for e in _walk(conn, name, kind == "impact")]
    edge_type = "uses_queue" if kind == "queue" else "uses_credential"
    return [e.row for e in named_edges(conn) if e.edge_type == edge_type and e.to_id == name]

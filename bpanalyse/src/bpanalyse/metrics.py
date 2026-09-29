"""Owns the derived per-process/object metrics of SPEC section 5."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from bpanalyse.model import Edge, Estate, key

METRIC_NAMES = (
    "fan_out", "fan_in", "depth", "code_stage_ratio", "calc_stage_ratio", "exception_coverage", "orphan",
    "dead_pages", "duplicate_code_stages", "unresolved_refs", "masked_literals", "external_calls",
)


@dataclass(frozen=True)
class MetricRow:
    id: str
    name: str
    type: str
    values: dict[str, float]


def _ratio(n: int, d: int) -> float:
    return round(n / d, 4) if d else 0


def _node(edge: Edge) -> str:
    return edge.to_id if edge.to_type in ("object", "process") else "external:" + edge.to_id


def _depths(adj: dict[str, set[str]]) -> dict[str, int]:
    """Longest call chain per node: longest path over the SCC condensation (iterative Tarjan), so a cycle counts as one step."""
    nodes = set(adj).union(*adj.values())
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    comp: dict[str, int] = {}
    depth: list[int] = []
    stack: list[str] = []
    for root in sorted(nodes):
        if root in index:
            continue
        index[root] = low[root] = len(index)
        stack.append(root)
        work = [(root, iter(sorted(adj.get(root, ()))))]
        while work:
            v, it = work[-1]
            for w in it:
                if w not in index:
                    index[w] = low[w] = len(index)
                    stack.append(w)
                    work.append((w, iter(sorted(adj.get(w, ())))))
                    break
                if w not in comp:  # on the stack
                    low[v] = min(low[v], index[w])
            else:
                work.pop()
                if work:
                    low[work[-1][0]] = min(low[work[-1][0]], low[v])
                if low[v] == index[v]:
                    members = []
                    while not members or members[-1] != v:
                        members.append(stack.pop())
                        comp[members[-1]] = len(depth)
                    depth.append(max((1 + depth[comp[x]] for m in members for x in adj.get(m, ()) if comp[x] != len(depth)), default=0))
    return {n: depth[comp[n]] for n in nodes}


def dead_page_ids(estate: Estate, edges: list[Edge]) -> set[str]:
    """Composite `process_id/page_id` keys of pages nothing calls."""
    called = {e.to_id for e in edges if e.edge_type == "calls_page"}
    return {key(pd.process.id, pg.id) for pd in estate.processes for pg in pd.pages
            if key(pd.process.id, pg.id) not in called and not pg.is_main and not pg.is_published and pg.type != "CleanUp"}


def compute_metrics(estate: Estate, edges: list[Edge]) -> list[MetricRow]:
    calls = [e for e in edges if e.edge_type in ("calls_object", "calls_process") and e.to_id]
    adj: dict[str, set[str]] = {}
    for e in calls:
        adj.setdefault(e.from_id, set()).add(_node(e))
    hash_counts = Counter(c.code_hash for pd in estate.processes for c in pd.code_stages if c.code_hash)
    depths = _depths(adj)
    dead = dead_page_ids(estate, edges)
    rows = []
    for pd in estate.processes:
        p = pd.process
        stage_types = Counter(s.type for s in pd.stages)
        total = len(pd.stages)
        by_page: dict[str, set[str]] = {}
        for s in pd.stages:
            by_page.setdefault(s.page_id, set()).add(s.type)
        with_action = [t for t in by_page.values() if "Action" in t]
        mine = [e for e in edges if e.from_process_id == p.id]
        fan_in = len({e.from_id for e in calls if e.to_id == p.id})
        rows.append(MetricRow(p.id, p.name, p.type, {
            "fan_out": len({_node(e) for e in calls if e.from_id == p.id and e.edge_type == "calls_object"}),
            "fan_in": fan_in,
            "depth": depths.get(p.id, 0),
            "code_stage_ratio": _ratio(stage_types["Code"], total),
            "calc_stage_ratio": _ratio(stage_types["Calculation"] + stage_types["MultipleCalculation"], total),
            "exception_coverage": _ratio(sum("Recover" in t for t in with_action), len(with_action)),
            "orphan": int(fan_in == 0),
            "dead_pages": sum(key(p.id, pg.id) in dead for pg in pd.pages),
            "duplicate_code_stages": sum(bool(c.code_hash) and hash_counts[c.code_hash] > 1 for c in pd.code_stages),
            "unresolved_refs": sum(e.unresolved for e in mine),
            "masked_literals": pd.masked_total,
            "external_calls": sum(e.edge_type == "calls_object" and e.to_type == "external_object" for e in mine),
        }))
    return rows

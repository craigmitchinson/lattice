"""Owns the findings list of SPEC section 6.5, derived from the estate, edges and metrics."""

from __future__ import annotations

from collections import Counter

from bpanalyse.metrics import MetricRow, dead_page_ids
from bpanalyse.model import Edge, Estate, Finding, key


def _by_pattern(patterns: str) -> list[str]:
    return patterns.split("+")


def compute_findings(estate: Estate, edges: list[Edge], metrics: list[MetricRow]) -> list[Finding]:
    out: list[Finding] = []
    procs = {pd.process.id: pd.process for pd in estate.processes}
    stage_name = {(s.process_id, s.id): s.name for pd in estate.processes for s in pd.stages}
    page_name = {(pd.process.id, pg.id): pg.name for pd in estate.processes for pg in pd.pages}
    page_of = {(s.process_id, s.id): s.page_id for pd in estate.processes for s in pd.stages}
    dead = dead_page_ids(estate, edges)
    hash_counts = Counter(c.code_hash for pd in estate.processes for c in pd.code_stages if c.code_hash)
    for m in metrics:
        if m.type == "object" and m.values["orphan"]:
            out.append(Finding("orphan", m.name, m.type, "", "", m.id))
    for pd in estate.processes:
        p = pd.process
        for pg in pd.pages:
            if key(p.id, pg.id) in dead:
                out.append(Finding("dead_page", p.name, p.type, pg.name, "", pg.id))
        for c in pd.code_stages:
            if c.code_hash and hash_counts[c.code_hash] > 1:
                sk = (p.id, c.stage_id)
                out.append(Finding("duplicate_code", p.name, p.type, page_name.get((p.id, page_of[sk]), ""), stage_name[sk], c.code_hash))
        for mi in pd.masked:
            for pattern in _by_pattern(mi.patterns):
                out.append(Finding("masked_literal", p.name, p.type, page_name.get((p.id, mi.page_id), ""), stage_name[(p.id, mi.stage_id)], pattern))
        if p.type == "process":
            by_page: dict[str, set[str]] = {}
            for s in pd.stages:
                by_page.setdefault(s.page_id, set()).add(s.type)
            for pg in pd.pages:
                types = by_page.get(pg.id, set())
                if "Action" in types and "Recover" not in types:
                    out.append(Finding("missing_exception_handling", p.name, p.type, pg.name, "", pg.id))
    for name, (patterns, _) in estate.env_masks.items():
        out += [Finding("masked_literal", name, "environment_variable", "", "", pattern) for pattern in _by_pattern(patterns)]
    for e in edges:
        owner = procs.get(e.from_process_id)
        if owner is None:
            continue
        sk = (e.evidence_process_id, e.evidence_stage_id)
        page, stage = page_name.get((e.evidence_process_id, page_of.get(sk, "")), ""), stage_name.get(sk, "")
        if e.unresolved:
            out.append(Finding("unresolved_ref", owner.name, owner.type, page, stage, e.edge_type))
        if e.edge_type == "calls_object" and e.to_type == "external_object":
            out.append(Finding("external_object", owner.name, owner.type, page, stage, e.to_id))
    return sorted(out, key=lambda f: (f.finding_type, f.entity_name, f.page_name, f.stage_name, f.detail))

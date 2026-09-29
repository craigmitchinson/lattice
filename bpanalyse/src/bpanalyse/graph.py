"""Owns merging releases into one estate (collisions) and building edges, external objects and the release map."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import yaml

from bpanalyse.model import ActionRef, Collision, Edge, Estate, ParsedFile, ProcessData

EDGE_TYPES = (
    "calls_object", "calls_action", "calls_process", "calls_page", "uses_queue", "uses_credential",
    "uses_env_var", "uses_element", "handles_exception",
)


@dataclass(frozen=True)
class InternalObjects:
    queue_object: str
    queue_inputs: tuple[str, ...]
    credential_object: str
    credential_inputs: tuple[str, ...]


@dataclass(frozen=True)
class GraphResult:
    edges: list[Edge]
    externals: list[str]
    release_map: list[tuple[str, str, str, int]]


def load_internal_objects(path: Path) -> InternalObjects:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    wq, cr = data["work_queues"], data["credentials"]
    return InternalObjects(wq["object_name"], tuple(wq["queue_name_inputs"]), cr["object_name"], tuple(cr["credential_name_inputs"]))


def created_key(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def merge(files: list[ParsedFile]) -> tuple[Estate, list[Collision]]:
    """Merge parsed files (sorted by file name). The later `created` wins; ties keep the first file."""
    chosen: dict[str, tuple[ParsedFile, ProcessData]] = {}
    collisions: list[Collision] = []
    estate = Estate()
    for pf in files:
        estate.releases.append(pf.release)
        for pd in pf.processes:
            held = chosen.get(pd.process.id)
            if held is None:
                chosen[pd.process.id] = (pf, pd)
                continue
            newer = created_key(pf.release.created) > created_key(held[0].release.created)
            keep, drop = ((pf, pd), held) if newer else (held, (pf, pd))
            collisions.append(Collision(pd.process.id, pd.process.name, keep[0].release.source_file, keep[0].release.created,
                                        drop[0].release.source_file, drop[0].release.created))
            chosen[pd.process.id] = keep
        for group, seen in ((pf.queues, estate.queues), (pf.credentials, estate.credentials), (pf.env_vars, estate.env_vars)):
            for item in group:
                if all(item.name != s.name for s in seen):
                    seen.append(item)
        estate.env_masks.update({k: v for k, v in pf.env_masks.items() if k not in estate.env_masks})
    estate.processes = sorted((pd for _, pd in chosen.values()), key=lambda d: (d.process.name, d.process.id))
    return estate, collisions


def is_literal(expr: str) -> str | None:
    """Return the string held by a single double-quoted literal with no `&` or `[`, otherwise None."""
    e = expr.strip()
    if len(e) >= 2 and e[0] == '"' and e[-1] == '"' and not any(c in e[1:-1] for c in '"&['):
        return e[1:-1]
    return None


def _lookup_edge(pd: ProcessData, a: ActionRef, names: tuple[str, ...], edge_type: str, to_type: str) -> Edge | None:
    """Edge for a queue or credential use; None when the action has no name input at all (e.g. Mark Completed)."""
    p = pd.process
    expr = next((e for n, e in a.inputs if n in names), None)
    if expr is None:
        return None
    literal = is_literal(expr)
    if literal is not None:
        return Edge(p.id, p.type, literal, to_type, edge_type, a.stage_id, 0, p.release_id)
    return Edge(p.id, p.type, "", to_type, edge_type, a.stage_id, 1, p.release_id, str(len(expr)))


def build_edges(estate: Estate, cfg: InternalObjects) -> GraphResult:
    procs = {pd.process.id: pd for pd in estate.processes}
    objects = {}
    for pd in estate.processes:
        if pd.process.type == "object":
            objects.setdefault(pd.process.name, pd)
    by_name = {}
    for pd in estate.processes:
        by_name.setdefault(pd.process.name, pd)
    actions = {(pd.process.id, pg.name): pg.id for pd in estate.processes for pg in pd.pages if pg.type == "Normal" and pg.is_published}
    elements = {e.id for pd in estate.processes for e in pd.app_elements}
    env_names = {e.name for e in estate.env_vars}
    internal = {cfg.queue_object, cfg.credential_object}
    edges: list[Edge] = []
    externals: set[str] = set()
    rmap: Counter[tuple[str, str, str]] = Counter()
    for pd in estate.processes:
        p = pd.process
        page_ids = {pg.id for pg in pd.pages}
        for a in pd.actions:
            if a.object_name == cfg.queue_object:
                edges += filter(None, [_lookup_edge(pd, a, cfg.queue_inputs, "uses_queue", "work_queue")])
            elif a.object_name == cfg.credential_object:
                edges += filter(None, [_lookup_edge(pd, a, cfg.credential_inputs, "uses_credential", "credential_ref")])
            elif a.object_name not in internal:
                rmap[(p.name, a.object_name, a.action_name)] += 1
                target = objects.get(a.object_name)
                if target is None:
                    externals.add(a.object_name)
                    edges.append(Edge(p.id, p.type, a.object_name, "external_object", "calls_object", a.stage_id, 0, p.release_id))
                    continue
                edges.append(Edge(p.id, p.type, target.process.id, "object", "calls_object", a.stage_id, 0, p.release_id))
                page_id = actions.get((target.process.id, a.action_name))
                edges.append(Edge(p.id, p.type, page_id or "", "page", "calls_action", a.stage_id, int(page_id is None), p.release_id,
                                  "" if page_id else a.action_name))
        for t in pd.process_calls:
            target = procs.get(t.target_id) or (by_name.get(t.target_name) if not t.target_id else None)
            tid = target.process.id if target else t.target_id
            edges.append(Edge(p.id, p.type, tid, "process", "calls_process", t.stage_id, int(target is None), p.release_id, "" if target else t.target_name))
        for t in pd.page_calls:
            edges.append(Edge(t.page_id, "page", t.target_id, "page", "calls_page", t.stage_id, int(t.target_id not in page_ids), p.release_id))
        for t in pd.env_uses:
            edges.append(Edge(p.id, p.type, t.target_name, "environment_variable", "uses_env_var", t.stage_id, int(t.target_name not in env_names), p.release_id))
        for t in sorted({(t.stage_id, t.page_id, t.target_id) for t in pd.element_uses}):
            edges.append(Edge(t[1], "page", t[2], "app_element", "uses_element", t[0], int(t[2] not in elements), p.release_id))
        for t in pd.exceptions:
            edges.append(Edge(t.page_id, "page", t.target_id, "exception_type", "handles_exception", t.stage_id, int(not t.target_id), p.release_id))
    edges.sort(key=lambda e: (e.edge_type, e.from_id, e.to_id, e.evidence_stage_id))
    return GraphResult(edges, sorted(externals), sorted((*k, v) for k, v in rmap.items()))

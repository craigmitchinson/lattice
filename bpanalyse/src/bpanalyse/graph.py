"""Owns merging releases into one estate (collisions) and building edges, external objects and the release map."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import yaml

from bpanalyse.model import ActionRef, Collision, Edge, Estate, ParsedFile, ProcessData, key, q
from bpanalyse.sanitise import ConfigError

EDGE_TYPES = (
    "calls_object", "calls_action", "calls_process", "calls_page", "uses_queue", "uses_credential",
    "uses_env_var", "uses_element", "handles_exception",
)


ROLE_EDGES = {"work_queue": ("uses_queue", "work_queue"), "credential": ("uses_credential", "credential_ref")}


@dataclass(frozen=True)
class InternalObject:
    object: str
    role: str  # work_queue | credential resolve a named item; any other role only marks the call as internal
    name_input: str


@dataclass(frozen=True)
class GraphResult:
    edges: list[Edge]
    externals: list[str]
    release_map: list[tuple[str, str, str, int]]
    notes: list[str]


def load_internal_objects(path: Path) -> dict[str, InternalObject]:
    """Internal objects by object name, from a list of {object, role, name_input}."""
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        rows = data["internal_objects"]
        return {str(r["object"]): InternalObject(str(r["object"]), str(r.get("role", "")), str(r.get("name_input", ""))) for r in rows}
    except (OSError, yaml.YAMLError, KeyError, TypeError, AttributeError) as exc:
        raise ConfigError(f"internal objects config unusable: {path}: {exc!r}") from exc


def parse_created(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.strip().replace(" ", "T", 1).replace("Z", "+00:00"))  # `2016-12-30 08:53:58Z`
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def created_key(value: str) -> datetime:
    return parse_created(value) or datetime.min.replace(tzinfo=timezone.utc)


def _shown(value: str) -> str:
    """The created value for the log; an unparsable one is never echoed."""
    return value if parse_created(value) else "unparsed"


def merge(files: list[ParsedFile]) -> tuple[Estate, list[Collision]]:
    """Merge parsed files (sorted by file name). The later `created` wins; ties keep the first file."""
    chosen: dict[str, tuple[ParsedFile, ProcessData]] = {}
    collisions: list[Collision] = []
    estate = Estate()
    for pf in files:
        estate.releases.append(pf.release)
        if parse_created(pf.release.created) is None:
            estate.notes.append(f"bad_created file={pf.release.source_file} value_length={len(pf.release.created)}")
        for pd in pf.processes:
            held = chosen.get(pd.process.id)
            if held is None:
                chosen[pd.process.id] = (pf, pd)
                continue
            newer = created_key(pf.release.created) > created_key(held[0].release.created)
            keep, drop = ((pf, pd), held) if newer else (held, (pf, pd))
            collisions.append(Collision(pd.process.id, pd.process.name, keep[0].release.source_file, _shown(keep[0].release.created),
                                        drop[0].release.source_file, _shown(drop[0].release.created)))
            chosen[pd.process.id] = keep
        for group, seen in ((pf.queues, estate.queues), (pf.credentials, estate.credentials), (pf.env_vars, estate.env_vars)):
            for item in group:
                if all(item.name != s.name for s in seen):
                    seen.append(item)
        for group, seen in ((pf.groups, estate.groups), (pf.web_api_services, estate.web_api_services)):
            for item in group:
                if all(item.id != s.id for s in seen):
                    seen.append(item)
        estate.group_members += [m for m in pf.group_members if m not in estate.group_members]
        estate.notes += pf.notes
        estate.env_masks.update({k: v for k, v in pf.env_masks.items() if k not in estate.env_masks})
    estate.processes = sorted((pd for _, pd in chosen.values()), key=lambda d: (d.process.name, d.process.id))
    estate.notes += [n for pd in estate.processes for n in pd.notes]
    return estate, collisions


def is_literal(expr: str) -> str | None:
    """Return the string held by a single double-quoted literal with no `&` or `[`, otherwise None."""
    e = expr.strip()
    if len(e) >= 2 and e[0] == '"' and e[-1] == '"' and not any(c in e[1:-1] for c in '"&['):
        return e[1:-1]
    return None


def _lookup_edge(pd: ProcessData, a: ActionRef, name_input: str, edge_type: str, to_type: str) -> Edge | None:
    """Edge for a queue or credential use; None when the action has no name input at all (e.g. Mark Completed)."""
    p = pd.process
    expr = next((e for n, e in a.inputs if n == name_input), None)
    if expr is None:
        return None
    literal = is_literal(expr)
    if literal is not None:
        return Edge(p.id, p.id, p.type, literal, to_type, edge_type, a.stage_id, p.id, 0, p.release_id)
    return Edge(p.id, p.id, p.type, "", to_type, edge_type, a.stage_id, p.id, 1, p.release_id, str(len(expr)))


def build_edges(estate: Estate, cfg: dict[str, InternalObject]) -> GraphResult:
    procs = {pd.process.id: pd for pd in estate.processes}
    objects: dict[str, ProcessData] = {}
    notes: list[str] = []
    for pd in estate.processes:
        if pd.process.type == "object":
            objects.setdefault(pd.process.name, pd)
    for name in sorted({pd.process.name for pd in estate.processes if pd.process.type == "object"}):
        ids = sorted(pd.process.id for pd in estate.processes if pd.process.type == "object" and pd.process.name == name)
        if len(ids) > 1:
            notes.append(f"ambiguous_object name={q(name)} ids={','.join(ids)}")
    actions: dict[tuple[str, str], str] = {}
    action_counts: Counter[tuple[str, str]] = Counter()
    for pd in estate.processes:
        for pg in pd.pages:
            if pg.type == "Normal" and pg.is_published:
                actions.setdefault((pd.process.id, pg.name), pg.id)
                action_counts[(pd.process.name, pg.name)] += 1
    notes += [f"ambiguous_action object={q(o)} action={q(a)} count={n}" for (o, a), n in sorted(action_counts.items()) if n > 1]
    elements = {(pd.process.id, e.id) for pd in estate.processes for e in pd.app_elements}
    env_names = {e.name for e in estate.env_vars}
    edges: list[Edge] = []
    externals: set[str] = set()
    rmap: Counter[tuple[str, str, str]] = Counter()
    for pd in estate.processes:
        p = pd.process

        def edge(from_id: str, from_type: str, to_id: str, to_type: str, kind: str, stage_id: str, unresolved: int, detail: str = "",
                 internal: int = 0) -> None:
            edges.append(Edge(from_id, p.id, from_type, to_id, to_type, kind, stage_id, p.id, unresolved, p.release_id, detail, internal))

        page_ids = {pg.id for pg in pd.pages}
        for a in pd.actions:
            builtin = cfg.get(a.object_name)
            if builtin is not None:  # kept as a calls_object edge flagged is_internal; never external, never in the release map
                edge(p.id, p.type, a.object_name, "internal_object", "calls_object", a.stage_id, 0, "", 1)
                if builtin.role in ROLE_EDGES:
                    edges += filter(None, [_lookup_edge(pd, a, builtin.name_input, *ROLE_EDGES[builtin.role])])
            else:
                rmap[(p.name, a.object_name, a.action_name)] += 1
                target = objects.get(a.object_name)
                if target is None:
                    externals.add(a.object_name)
                    edge(p.id, p.type, a.object_name, "external_object", "calls_object", a.stage_id, 0)
                    continue
                edge(p.id, p.type, target.process.id, "object", "calls_object", a.stage_id, 0)
                page_id = actions.get((target.process.id, a.action_name))
                edge(p.id, p.type, key(target.process.id, page_id) if page_id else "", "page", "calls_action", a.stage_id,
                     int(page_id is None), "" if page_id else a.action_name)
        for t in pd.process_calls:
            target = procs.get(t.target_id)
            edge(p.id, p.type, t.target_id, "process", "calls_process", t.stage_id, int(target is None))
        for t in pd.page_calls:
            edge(key(p.id, t.page_id), "page", key(p.id, t.target_id) if t.target_id else "", "page", "calls_page", t.stage_id,
                 int(t.target_id not in page_ids))
        for t in pd.env_uses:
            edge(p.id, p.type, t.target_name, "environment_variable", "uses_env_var", t.stage_id, int(t.target_name not in env_names))
        for t in sorted({(t.stage_id, t.page_id, t.target_id) for t in pd.element_uses}):
            edge(key(p.id, t[1]), "page", key(p.id, t[2]), "app_element", "uses_element", t[0], int((p.id, t[2]) not in elements))
        for t in pd.exceptions:
            edge(key(p.id, t.page_id), "page", t.target_id, "exception_type", "handles_exception", t.stage_id, int(not t.target_id))
    assert all(e.from_id and e.evidence_stage_id for e in edges), "edge without from_id or evidence_stage_id"
    edges.sort(key=lambda e: (e.edge_type, e.from_id, e.to_id, e.evidence_stage_id))
    return GraphResult(edges, sorted(externals), sorted((*k, v) for k, v in rmap.items()), notes)

"""Owns the dataclasses shared by every stage of the pipeline (entities, edges, estate)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Release:
    id: str
    name: str
    created: str
    exported_by: str
    source_file: str


@dataclass(frozen=True)
class Process:
    id: str
    name: str
    type: str  # process | object
    release_id: str
    page_count: int
    stage_count: int
    version: str


@dataclass(frozen=True)
class Page:
    id: str
    process_id: str
    name: str
    type: str
    is_main: int
    is_published: int
    stage_count: int


@dataclass(frozen=True)
class Stage:
    id: str
    page_id: str
    name: str
    type: str
    x: int | None
    y: int | None


@dataclass(frozen=True)
class CodeStage:
    stage_id: str
    language: str
    line_count: int
    input_count: int
    output_count: int
    code_hash: str


@dataclass(frozen=True)
class DataItem:
    stage_id: str
    datatype: str
    exposure: str
    has_initial_value: int
    is_masked: int


@dataclass(frozen=True)
class CalcStage:
    stage_id: str
    expression_length: int
    literal_count: int


@dataclass(frozen=True)
class AppElement:
    id: str
    object_id: str
    name: str
    element_type: str
    parent_id: str | None
    attribute_count: int


@dataclass(frozen=True)
class WorkQueue:
    name: str
    key_field: str
    from_release: str


@dataclass(frozen=True)
class CredentialRef:
    name: str
    from_release: str


@dataclass(frozen=True)
class EnvVar:
    name: str
    datatype: str
    from_release: str


@dataclass(frozen=True)
class ActionRef:
    stage_id: str
    page_id: str
    object_name: str
    action_name: str
    inputs: tuple[tuple[str, str], ...]  # (name, sanitised expr)


@dataclass(frozen=True)
class TargetRef:
    """A stage pointing at something: a process id, page id, element id, exception type or env var name."""

    stage_id: str
    page_id: str
    target_id: str
    target_name: str = ""


@dataclass(frozen=True)
class MaskedItem:
    stage_id: str
    page_id: str
    patterns: str
    count: int


@dataclass
class ProcessData:
    process: Process
    pages: list[Page] = field(default_factory=list)
    stages: list[Stage] = field(default_factory=list)
    code_stages: list[CodeStage] = field(default_factory=list)
    data_items: list[DataItem] = field(default_factory=list)
    calc_stages: list[CalcStage] = field(default_factory=list)
    app_elements: list[AppElement] = field(default_factory=list)
    actions: list[ActionRef] = field(default_factory=list)
    process_calls: list[TargetRef] = field(default_factory=list)
    page_calls: list[TargetRef] = field(default_factory=list)
    element_uses: list[TargetRef] = field(default_factory=list)
    exceptions: list[TargetRef] = field(default_factory=list)
    env_uses: list[TargetRef] = field(default_factory=list)
    masked: list[MaskedItem] = field(default_factory=list)
    masked_total: int = 0


@dataclass
class ParsedFile:
    release: Release
    processes: list[ProcessData] = field(default_factory=list)
    queues: list[WorkQueue] = field(default_factory=list)
    credentials: list[CredentialRef] = field(default_factory=list)
    env_vars: list[EnvVar] = field(default_factory=list)
    env_masks: dict[str, tuple[str, int]] = field(default_factory=dict)


@dataclass(frozen=True)
class Collision:
    id: str
    name: str
    kept_file: str
    kept_created: str
    dropped_file: str
    dropped_created: str


@dataclass
class Estate:
    releases: list[Release] = field(default_factory=list)
    processes: list[ProcessData] = field(default_factory=list)
    queues: list[WorkQueue] = field(default_factory=list)
    credentials: list[CredentialRef] = field(default_factory=list)
    env_vars: list[EnvVar] = field(default_factory=list)
    env_masks: dict[str, tuple[str, int]] = field(default_factory=dict)


@dataclass(frozen=True)
class Edge:
    from_id: str
    from_type: str
    to_id: str
    to_type: str
    edge_type: str
    evidence_stage_id: str
    unresolved: int
    release_id: str
    detail: str = ""


@dataclass(frozen=True)
class Finding:
    finding_type: str
    entity_name: str
    entity_type: str
    page_name: str
    stage_name: str
    detail: str

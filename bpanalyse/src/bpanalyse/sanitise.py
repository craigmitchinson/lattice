"""Owns masking of sensitive literals in a parsed release tree, before any parsing of meaning."""

from __future__ import annotations

import copy
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

import yaml

MASK = "[MASKED]"


@dataclass(frozen=True)
class MaskConfig:
    patterns: tuple[tuple[str, re.Pattern[str]], ...]


def load_mask_config(path: Path) -> MaskConfig:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return MaskConfig(tuple((n, re.compile(p)) for n, p in (data.get("patterns") or {}).items()))


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def mask_text(text: str, cfg: MaskConfig) -> tuple[str, dict[str, int]]:
    """Return the text with every pattern match replaced, and hit counts per pattern name."""
    hits: dict[str, int] = {}
    for name, pattern in cfg.patterns:
        text, n = pattern.subn(MASK, text)
        if n:
            hits[name] = n
    return text, hits


def _merge(total: dict[str, int], hits: dict[str, int]) -> None:
    for k, v in hits.items():
        total[k] = total.get(k, 0) + v


def _annotate(el: ET.Element, total: dict[str, int]) -> int:
    n = sum(total.values())
    if n:
        el.set("_masked", "+".join(sorted(total)))
        el.set("_maskn", str(n))
    return n


def _mask_stage(stage: ET.Element, cfg: MaskConfig) -> int:
    total: dict[str, int] = {}
    for el in stage.iter():
        name = local(el.tag)
        if name in ("initialvalue", "argument") or (name == "expr" and el is not stage):
            if el.text:
                el.text, hits = mask_text(el.text, cfg)
                _merge(total, hits)
        if name in ("calculation", "decision") and "expression" in el.attrib:
            masked, hits = mask_text(el.get("expression", ""), cfg)
            el.set("expression", masked)
            _merge(total, hits)
        if name == "input" and "expr" in el.attrib:
            masked, hits = mask_text(el.get("expr", ""), cfg)
            el.set("expr", masked)
            _merge(total, hits)
    return _annotate(stage, total)


def sanitise(root: ET.Element, cfg: MaskConfig) -> tuple[ET.Element, Counter[str]]:
    """Return a masked deep copy and a count of masked values per process/object id (or env:<name>)."""
    tree = copy.deepcopy(root)
    counts: Counter[str] = Counter()
    top = {id(c) for c in tree}
    for el in tree.iter():
        name = local(el.tag)
        if name == "environment-variable" and "value" in el.attrib:
            masked, hits = mask_text(el.get("value", ""), cfg)
            el.set("value", masked)
            n = _annotate(el, hits)
            if n and id(el) in top:
                counts["env:" + el.get("name", "")] += n
    for wrapper in tree:
        if local(wrapper.tag) in ("process", "object"):
            for stage in wrapper.iter():
                if local(stage.tag) == "stage":
                    counts[wrapper.get("id", "")] += _mask_stage(stage, cfg)
    return tree, +counts

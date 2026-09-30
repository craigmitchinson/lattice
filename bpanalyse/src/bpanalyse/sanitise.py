"""Owns masking of sensitive literals in a parsed release tree, before any parsing of meaning."""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

import yaml

MASK = "[MASKED]"
Marks = dict[int, tuple[str, int]]  # id(element) -> ("pattern+pattern", masked value count); side table, never XML attributes

# Identifier names left unmasked inside a stage (element name -> attributes). "*" means every attribute.
_KEEP_ATTRS = {
    "stage": {"stageid", "name", "type"}, "element": {"id"},
    "resource": {"object", "action"}, "input": {"name", "type"}, "output": {"name", "type", "stage"}, "display": {"*"},
    "code": {"language"}, "field": {"name", "type"}, "choice": {"name", "ontrue"},
}
_KEEP_TEXT = frozenset({"subsheetid", "processid", "onsuccess", "ontrue", "onfalse", "datatype", "exposure", "language",
                        "groupid", "looptype", "loopdata", "comparetype", "name", "id"})
_ENCRYPTED = "initialvalueenc"  # an encrypted value: never read, so it is replaced whole and reported as its own pattern


class ConfigError(Exception):
    """The mask configuration is missing or unusable; masking must never fail open."""


@dataclass(frozen=True)
class MaskConfig:
    patterns: tuple[tuple[str, re.Pattern[str], tuple[str, ...]], ...]  # name, regex, pre-filter literals


def load_mask_config(path: Path) -> MaskConfig:
    if not path.is_file():
        raise ConfigError(f"mask config missing: {path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    patterns = data.get("patterns") if isinstance(data, dict) else None
    if not isinstance(patterns, dict) or not patterns:
        raise ConfigError(f"mask config has no patterns: {path}")
    out = []
    for name, spec in patterns.items():
        spec = {"regex": spec} if isinstance(spec, str) else spec
        try:
            rx = re.compile(spec["regex"])
        except (TypeError, KeyError, re.error) as exc:
            raise ConfigError(f"mask pattern {name} invalid: {exc!r}") from exc
        need = tuple(str(r).lower() if rx.flags & re.I else str(r) for r in spec.get("requires") or ())
        out.append((str(name), rx, need))
    return MaskConfig(tuple(out))


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def mask_text(text: str, cfg: MaskConfig) -> tuple[str, dict[str, int]]:
    """Return the text with every pattern match replaced, and hit counts per pattern name."""
    hits: dict[str, int] = {}
    low = text.lower() if text else text
    for name, pattern, need in cfg.patterns:
        if need and not any(r in (low if pattern.flags & re.I else text) for r in need):
            continue
        text, n = pattern.subn(MASK, text)
        if n:
            hits[name] = n
            low = text.lower()
    return text, hits


def _merge(total: dict[str, int], hits: dict[str, int]) -> None:
    for k, v in hits.items():
        total[k] = total.get(k, 0) + v


def _mask_stage(stage: ET.Element, cfg: MaskConfig) -> tuple[str, int]:
    """Mask every attribute value and text node under the stage except identifiers; initialvalue is masked whole."""
    total: dict[str, int] = {}
    initial = {id(x) for iv in stage.iter() if local(iv.tag) == "initialvalue" for x in iv.iter()}
    for el in stage.iter():
        name, whole = local(el.tag), id(el) in initial
        keep = _KEEP_ATTRS.get(name, ())
        for key in list(el.attrib):
            if whole or not (key in keep or "*" in keep):
                el.set(key, _hit(el.get(key, ""), cfg, total))
        if name == _ENCRYPTED:
            el.attrib.clear()
            if el.text:
                el.text = MASK
                total["encrypted"] = total.get("encrypted", 0) + 1
        elif el.text and (whole or name not in _KEEP_TEXT):
            el.text = _hit(el.text, cfg, total)
        if el.tail and el is not stage:
            el.tail = _hit(el.tail, cfg, total)
    return "+".join(sorted(total)), sum(total.values())


def _hit(value: str, cfg: MaskConfig, total: dict[str, int]) -> str:
    masked, hits = mask_text(value, cfg)
    _merge(total, hits)
    return masked


def sanitise(root: ET.Element, cfg: MaskConfig) -> tuple[ET.Element, Marks]:
    """Return a masked deep copy and a side table of masked-value counts keyed by id() of stage / environment-variable elements."""
    tree = copy.deepcopy(root)
    marks: Marks = {}
    for el in tree.iter():
        name = local(el.tag)
        if name == "environment-variable" and "value" in el.attrib:
            total: dict[str, int] = {}
            el.set("value", _hit(el.get("value", ""), cfg, total))
            if total:
                marks[id(el)] = ("+".join(sorted(total)), sum(total.values()))
        elif name == "stage":
            hit = _mask_stage(el, cfg)
            if hit[1]:
                marks[id(el)] = hit
    return tree, marks

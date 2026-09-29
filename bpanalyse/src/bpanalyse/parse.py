"""Owns XML traversal: loading a release, spotting unrecognised structure, and extracting entities."""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

from bpanalyse.model import (
    ActionRef, AppElement, CalcStage, CodeStage, CredentialRef, DataItem, EnvVar, MaskedItem, Page,
    ParsedFile, Process, ProcessData, Release, Stage, TargetRef, WorkQueue, q,
)
from bpanalyse.sanitise import Marks, local

STAGE_TYPES = frozenset(
    "Decision Calculation MultipleCalculation Data Collection Action SubSheet Process Code Navigate Read "
    "Write WaitStart Exception Alert ChoiceStart Start End Recover Resume Note Anchor LoopStart LoopEnd "
    "Block ChoiceEnd WaitEnd SubSheetInfo ProcessInfo".split()
)
STEP_TYPES = frozenset({"Navigate", "Read", "Write", "WaitStart"})
OPAQUE = frozenset({"tile", "dashboard", "font", "process-group"})
_LITERAL = re.compile(r'"(?:[^"]|"")*"')
_LEAD = "\ufeff \t\r\n"
_XMLDECL = re.compile(r"<\?xml[^>]*\?>\s*")
_PROCESS_OPEN = re.compile(r"<(?:[\w.-]+:)?process[\s>/]")


class ReleaseError(ValueError):
    """A release file that cannot be used; `fields` is the log detail and `line` the file line (0 = not yet located)."""

    def __init__(self, fields: str, name: str = "", ident: str = "", line: int = 0, event: str = "parse_error") -> None:
        super().__init__(fields)
        self.fields, self.name, self.ident, self.line, self.event = fields, name, ident, line, event


def _s(attrs: str = "", kids: str = "") -> tuple[frozenset[str], frozenset[str]]:
    return frozenset(attrs.split()), frozenset(kids.split())


_TOP = "process object work-queue environment-variable credential tile dashboard font process-group"
SCHEMA = {
    "release": _s("", "name created package-id package-name user-created-by release-notes contents " + _TOP),
    "contents": _s("count", _TOP),
    "manifest-item": _s("id name bpversion datatype value description"),
    "wrapper": _s("id name bpversion", "process"),
    "process": _s("id name version bpversion narrative type", "subsheet stage appdef"),
    "subsheet": _s("subsheetid type published", "name"),
    "appdef": _s("", "applicationname element"),
    "element": _s("id name", "type element"),
    "stage": _s(
        "stageid name type",
        "narrative subsheetid display loginhibit onsuccess decision ontrue onfalse calculation steps datatype "
        "initialvalue exposure alwaysinit collectioninfo resource inputs outputs target code step timeout "
        "exception alert choice",
    ),
    "display": _s("x y w h"), "decision": _s("expression"), "calculation": _s("expression stage"),
    "steps": _s("", "calculation"), "collectioninfo": _s("", "field"), "field": _s("name type"),
    "resource": _s("object action"), "inputs": _s("", "input"), "input": _s("name type expr"),
    "outputs": _s("", "output"), "output": _s("name type stage"),
    "target": _s("subsheetid processname processid"), "code": _s("language"),
    "step": _s("", "element action condition arguments storein expr"),
    "arguments": _s("", "argument"), "argument": _s("name"), "action": _s("name"), "condition": _s("name"),
    "exception": _s("type detail usecurrent savedetail"), "alert": _s("expression"),
    "choice": _s("name expression ontrue"),
    "work-queue": _s("id name", "keyfield maxattempts"),
    "environment-variable": _s("name datatype value description"),
    "credential": _s("id name", "description"),
}


def child(el: ET.Element, name: str) -> ET.Element | None:
    return next((c for c in el if local(c.tag) == name), None)


def children(el: ET.Element, name: str) -> list[ET.Element]:
    return [c for c in el if local(c.tag) == name]


def text(el: ET.Element, name: str) -> str:
    c = child(el, name)
    return (c.text or "").strip() if c is not None else ""


def line_of(path: Path, ident: str, name: str) -> int:
    """Line of a process/object wrapper in the raw file (ET gives no lines): first tag after the manifest with that id, else name."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    manifest_end = re.search(r"</(?:[\w.-]+:)?contents\s*>", raw)
    start = manifest_end.end() if manifest_end else 0
    for attr, value in (("id", ident), ("name", name)):
        if value:
            m = re.compile(r"<(?:[\w.-]+:)?(?:process|object)\b[^>]*?\b%s=[\"']%s[\"']" % (attr, re.escape(escape(value)))).search(raw, start)
            if m:
                return raw.count("\n", 0, m.start()) + 1
    return 0


def _escaped_process(wrapper: ET.Element, path: Path) -> ET.Element:
    """Re-parse the escaped `<process>` text of a wrapper, tolerating a BOM, an XML declaration and a prefixed tag."""
    ident, name = wrapper.get("id", ""), wrapper.get("name", "")
    raw = wrapper.text or ""
    body = _XMLDECL.sub("", raw.lstrip(_LEAD), count=1).lstrip(_LEAD)
    if not _PROCESS_OPEN.match(body):
        raise ReleaseError(f"name={q(name)} id={ident}", name, ident, line_of(path, ident, name), "unparsed_wrapper")
    try:
        return ET.fromstring(body)
    except ET.ParseError as exc:
        row = exc.position[0] if exc.position else 1
        exc.position = (line_of(path, ident, name) + raw[: len(raw) - len(body)].count("\n") + row - 1, exc.position[1] if exc.position else 0)
        raise


def load_tree(path: Path) -> ET.Element:
    """Parse a release and re-parse any escaped `<process>` text held inside a process/object wrapper."""
    root = ET.fromstring(path.read_bytes())
    if local(root.tag) != "release":
        raise ValueError("root")
    for wrapper in root:
        if local(wrapper.tag) in ("process", "object") and child(wrapper, "process") is None:
            wrapper.append(_escaped_process(wrapper, path))
            wrapper.text = None
    return root


def _disp(tag: str) -> str:
    return ("bpr:" if tag.startswith("{") else "") + local(tag)


def _schema_key(parent_key: str, name: str) -> str:
    if parent_key == "release" and name in ("process", "object"):
        return "wrapper"
    return "manifest-item" if parent_key == "contents" else name


def find_unknowns(root: ET.Element) -> Counter[str]:
    """Count unrecognised elements, attributes and stage types by path. Never raises on unknowns."""
    counts: Counter[str] = Counter()

    def visit(el: ET.Element, path: str, key: str) -> None:
        attrs, kids = SCHEMA.get(key, _s())
        for a in el.attrib:
            if a not in attrs:
                counts[path + "@" + a] += 1
        if local(el.tag) == "stage" and el.get("type", "") not in STAGE_TYPES:
            # The value is included on purpose: an unknown stage type is a type identifier, not data. Capped at 40 chars.
            counts[path + "[type=" + el.get("type", "")[:40] + "]"] += 1
        for c in el:
            name = local(c.tag)
            cpath = path + "/" + _disp(c.tag)
            if name not in kids:
                counts[cpath] += 1
            elif not (key == "release" and name in OPAQUE):
                visit(c, cpath, _schema_key(key, name))

    visit(root, _disp(root.tag), "release")
    return counts


def _int(value: str | None) -> int | None:
    try:
        return int(float(value)) if value is not None else None
    except ValueError:
        return None


def _calc_exprs(stage: ET.Element) -> list[str]:
    nodes = children(stage, "calculation")
    steps = child(stage, "steps")
    if steps is not None:
        nodes += children(steps, "calculation")
    return [n.get("expression", "") for n in nodes]


def _parse_elements(parent: ET.Element, object_id: str, parent_id: str | None, out: list[AppElement]) -> None:
    for el in children(parent, "element"):
        out.append(AppElement(el.get("id", ""), object_id, el.get("name", ""), text(el, "type"), parent_id, len(el.attrib)))
        _parse_elements(el, object_id, el.get("id", ""), out)


def _parse_stage(st: ET.Element, pd: ProcessData, marks: Marks) -> None:
    pid, pname = pd.process.id, pd.process.name
    sid, page, kind, sname = st.get("stageid", ""), text(st, "subsheetid"), st.get("type", ""), st.get("name", "")
    if not sid:
        raise ReleaseError(f"process={q(pname)} reason=stage_missing_id", pname, pid)
    disp = child(st, "display")
    pd.stages.append(Stage(sid, pid, page, sname, kind, _int(disp.get("x")) if disp is not None else None,
                           _int(disp.get("y")) if disp is not None else None))
    patterns, masked = marks.get(id(st), ("", 0))
    if masked:
        pd.masked.append(MaskedItem(sid, page, patterns, masked))
    if kind in ("Data", "Collection"):
        exposure = text(st, "exposure") or "None"
        iv = child(st, "initialvalue")
        has_initial = iv is not None and (bool((iv.text or "").strip()) or len(iv) > 0)
        pd.data_items.append(DataItem(sid, pid, text(st, "datatype"), exposure, int(has_initial), int(bool(masked))))
        if exposure == "Environment":
            pd.env_uses.append(TargetRef(sid, page, "", sname))
    elif kind in ("Calculation", "MultipleCalculation"):
        exprs = _calc_exprs(st)
        pd.calc_stages.append(CalcStage(sid, pid, sum(len(e) for e in exprs), sum(len(_LITERAL.findall(e)) for e in exprs)))
    elif kind == "Code":
        code = child(st, "code")
        body = (code.text or "") if code is not None else ""
        io = [len(children(child(st, n), t)) if child(st, n) is not None else 0 for n, t in (("inputs", "input"), ("outputs", "output"))]
        norm = "".join(body.split())  # empty bodies get no hash so they never count as duplicates
        pd.code_stages.append(CodeStage(sid, pid, code.get("language", "") if code is not None else "", len(body.splitlines()),
                                        io[0], io[1], hashlib.sha256(norm.encode("utf-8")).hexdigest() if norm else ""))
    elif kind == "Action":
        res = child(st, "resource")
        inputs = child(st, "inputs")
        pairs = tuple((i.get("name", ""), i.get("expr", "")) for i in children(inputs, "input")) if inputs is not None else ()
        if res is not None:
            pd.actions.append(ActionRef(sid, page, res.get("object", ""), res.get("action", ""), pairs))
        else:
            pd.notes.append(f"stage_missing_resource process={q(pname)} stage={q(sname)}")
    elif kind == "SubSheet":
        tgt = child(st, "target")
        pd.page_calls.append(TargetRef(sid, page, tgt.get("subsheetid", "") if tgt is not None else ""))
    elif kind == "Process":
        tgt = child(st, "target")
        if tgt is not None and (tgt.get("processid") or tgt.get("processname")):
            pd.process_calls.append(TargetRef(sid, page, tgt.get("processid", ""), tgt.get("processname", "")))
        else:
            pd.notes.append(f"stage_missing_resource process={q(pname)} stage={q(sname)}")
    elif kind == "Exception":
        exc = child(st, "exception")
        pd.exceptions.append(TargetRef(sid, page, exc.get("type", "") if exc is not None else ""))
    if kind in STEP_TYPES:
        for step in children(st, "step"):
            ref = child(step, "element")
            if ref is not None and ref.get("id"):
                pd.element_uses.append(TargetRef(sid, page, ref.get("id", "")))


def _manifest(root: ET.Element) -> dict[tuple[str, str], str]:
    """Ids from the `bpr:contents` manifest, by (process|object, name)."""
    contents = child(root, "contents")
    items = list(contents) if contents is not None else []
    return {(local(i.tag), i.get("name", "")): i.get("id", "") for i in items if local(i.tag) in ("process", "object") and i.get("id")}


def _parse_process(wrapper: ET.Element, release_id: str, marks: Marks, manifest: dict[tuple[str, str], str]) -> ProcessData | None:
    inner = child(wrapper, "process")
    if inner is None:
        return None
    kind = "object" if inner.get("type") == "object" or local(wrapper.tag) == "object" else "process"
    pname = inner.get("name") or wrapper.get("name", "")
    pid = inner.get("id") or wrapper.get("id") or manifest.get((local(wrapper.tag), pname), "")
    if not pid:
        raise ReleaseError(f"process={q(pname)} reason=missing_id", pname, "")
    pages = [
        Page(s.get("subsheetid", ""), pid, text(s, "name"), s.get("type", ""), int(s.get("type") == "MainPage"),
             int(s.get("published", "").lower() == "true"), 0)
        for s in children(inner, "subsheet")
    ]
    stages = children(inner, "stage")
    per_page = Counter(text(s, "subsheetid") for s in stages)
    pages = [Page(p.id, p.process_id, p.name, p.type, p.is_main, p.is_published, per_page[p.id]) for p in pages]
    pd = ProcessData(Process(pid, pname, kind, release_id, len(pages), len(stages), inner.get("version", "")), pages=pages,
                     masked_total=sum(marks.get(id(s), ("", 0))[1] for s in stages))
    for st in stages:
        _parse_stage(st, pd, marks)
    appdef = child(inner, "appdef")
    if appdef is not None:
        _parse_elements(appdef, pid, None, pd.app_elements)
    return pd


def parse_release(root: ET.Element, source_file: str, marks: Marks) -> ParsedFile:
    """Extract entities from a sanitised release tree."""
    rid = text(root, "package-id") or "file:" + source_file
    pf = ParsedFile(Release(rid, text(root, "name"), text(root, "created"), text(root, "user-created-by"), source_file))
    manifest = _manifest(root)
    for el in root:
        name = local(el.tag)
        if name in ("process", "object"):
            pd = _parse_process(el, rid, marks, manifest)
            if pd is not None:
                pf.processes.append(pd)
        elif name == "work-queue":
            pf.queues.append(WorkQueue(el.get("name", ""), text(el, "keyfield"), rid))
        elif name == "credential":
            pf.credentials.append(CredentialRef(el.get("name", ""), rid))
        elif name == "environment-variable":
            pf.env_vars.append(EnvVar(el.get("name", ""), el.get("datatype", ""), rid))
            if id(el) in marks:
                pf.env_masks[el.get("name", "")] = marks[id(el)]
    return pf

"""Owns XML traversal: loading a release, the path census (discover and unrecognised structure), and extracting entities."""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import replace
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

from bpanalyse.model import (
    ActionRef, AppElement, CalcStage, CodeStage, CredentialRef, DataItem, EnvVar, Group, GroupMember, MaskedItem, Page,
    ParsedFile, Process, ProcessData, Release, Stage, TargetRef, WebApiService, WorkQueue, q,
)
from bpanalyse.sanitise import Marks, local

STAGE_TYPES = frozenset(
    "Decision Calculation MultipleCalculation Data Collection Action SubSheet Process Code Navigate Read "
    "Write WaitStart Exception Alert ChoiceStart Start End Recover Resume Note Anchor LoopStart LoopEnd "
    "Block ChoiceEnd WaitEnd SubSheetInfo ProcessInfo".split()
)
STEP_TYPES = frozenset({"Navigate", "Read", "Write", "WaitStart"})
# Contents kinds recognised by name and counted but not read (their subtree is known-ignored).
OPAQUE_KINDS = ("tile", "dashboard", "font", "schedule", "skill")
_LITERAL = re.compile(r'"(?:[^"]|"")*"')
_LEAD = "\ufeff \t\r\n"
_XMLDECL = re.compile(r"<\?xml[^>]*\?>\s*")
_PROCESS_OPEN = re.compile(r"<(?:[\w.-]+:)?process[\s>/]")


class ReleaseError(ValueError):
    """A release file that cannot be used; `fields` is the log detail and `line` the file line (0 = not yet located)."""

    def __init__(self, fields: str, name: str = "", ident: str = "", line: int = 0, event: str = "parse_error") -> None:
        super().__init__(fields)
        self.fields, self.name, self.ident, self.line, self.event = fields, name, ident, line, event


# ---- schema: what the parser knows. node = (attributes, {child element: node key, or None = known, subtree ignored}) ----------

def _n(attrs: str = "", kids: str = "") -> tuple[frozenset[str], dict[str, str | None]]:
    out: dict[str, str | None] = {}
    for k in kids.split():
        name, _, target = k.partition("=")
        out[name] = None if target == "~" else (target or name)
    return frozenset(attrs.split()), out


_STAGE_COMMON = ("narrative subsheetid display displayx displayy displaywidth displayheight font=~ loginhibit "
                 "loginhibitparameters=~ onsuccess preconditions=~ postconditions=~")
_DATA = "datatype initialvalue initialvalueenc private alwaysinit exposure"
_CALL = "inputs outputs"
STAGE_KIDS = {
    "Start": "inputs", "End": "outputs", "Decision": "decision ontrue onfalse", "Calculation": "calculation",
    "MultipleCalculation": "steps", "Data": _DATA, "Collection": _DATA + " collectioninfo", "Action": "resource " + _CALL,
    "SubSheet": "processid " + _CALL, "Process": "processid " + _CALL, "Code": "code " + _CALL,
    "ProcessInfo": "language references imports globalcode code", "Navigate": "step", "Read": "step", "Write": "step",
    "WaitStart": "groupid timeout choices", "WaitEnd": "groupid", "LoopStart": "groupid looptype loopdata", "LoopEnd": "groupid",
    "ChoiceStart": "groupid choices", "ChoiceEnd": "groupid", "Exception": "exception",
    "Recover": "", "Resume": "", "Block": "", "Anchor": "", "Note": "", "SubSheetInfo": "", "Alert": "",
}
_MEMBERS = "process=member object=member"
SCHEMA = {
    "release": _n("", "name release-notes created package-id package-name user-created-by contents"),
    "contents": _n("count", "process=wrapper object=wrapper credential environment-variable process-group=group object-group=group "
                            "webapiservice work-queue " + " ".join(k + "=~" for k in OPAQUE_KINDS)),
    "wrapper": _n("id name published", "process"),
    "process": _n("name version bpversion narrative type runmode byrefcollection", "subsheet stage appdef view=~ preconditions=~ endpoint=~"),
    "subsheet": _n("subsheetid type published", "name view=~"),
    "appdef": _n("", "element=app-element apptypeinfo=~"),
    "app-element": _n("name", "id type basetype datatype diagnose attributes=~ element=app-element"),
    "display": _n("x y w h"), "loginhibit": _n("onsuccess"), "initialvalue": _n("space", "row"), "row": _n("", "field"),
    "field": _n("name type value description"), "collectioninfo": _n("", "field"),
    "inputs": _n("", "input"), "outputs": _n("", "output"),
    "input": _n("name type narrative expr stage friendlyname"), "output": _n("name type narrative expr stage friendlyname"),
    "resource": _n("object action"), "decision": _n("expression"), "calculation": _n("expression stage"), "steps": _n("", "calculation"),
    "exception": _n("type detail usecurrent savedetail localized"), "references": _n("", "reference"), "imports": _n("", "import"),
    "step": _n("stage expr", "element action"), "element": _n("id"), "action": _n("", "id arguments"),
    "arguments": _n("", "argument"), "argument": _n("", "id value"),
    "choices": _n("", "choice"), "choice": _n("reply expression", "name distance ontrue element condition comparetype"),
    "condition": _n("", "id"),
    "credential": _n("id name", "credentialType members"), "members": _n("", _MEMBERS), "member": _n("id name"),
    "group": _n("id name isDefaultGroup", "members"), "environment-variable": _n("id name type value", "description"),
    "webapiservice": _n("id name enabled", "configuration=~"), "work-queue": _n("id name", "keyfield maxattempts"),
}
for _t in STAGE_TYPES:
    SCHEMA["stage:" + _t] = _n("stageid name type", _STAGE_COMMON + " " + STAGE_KIDS.get(_t, ""))
_EMPTY = _n()
_MISSING = object()


def census(root: ET.Element) -> tuple[Counter[str], Counter[str]]:
    """One traversal, two results: every element and attribute path with its count (stage paths keyed by stage type), and the
    subset the parser does not recognise. Names only, never values (except stage type names). Never raises on unknowns."""
    paths: Counter[str] = Counter()
    unknown: Counter[str] = Counter()

    def visit(el: ET.Element, path: str, key: str | None) -> None:
        paths[path] += 1
        attrs, kids = (SCHEMA.get(key, _EMPTY) if key else (None, None))
        for a in el.attrib:
            apath = path + "@" + local(a)
            paths[apath] += 1
            if attrs is not None and local(a) not in attrs:
                unknown[apath] += 1
        for c in el:
            name = local(c.tag)
            ckey = kids.get(name, _MISSING) if kids is not None else None
            cpath = path + "/" + name
            if ckey == "stage":
                kind = c.get("type", "")
                cpath += "[" + kind[:40] + "]"
                ckey = "stage:" + kind if kind in STAGE_TYPES else None
                if ckey is None:
                    unknown[cpath] += 1
            elif ckey is _MISSING:
                unknown[cpath] += 1
                ckey = None
            visit(c, cpath, ckey)  # type: ignore[arg-type]

    visit(root, "/" + local(root.tag), "release")
    return paths, unknown


def child(el: ET.Element, name: str) -> ET.Element | None:
    return next((c for c in el if local(c.tag) == name), None)


def children(el: ET.Element | None, name: str) -> list[ET.Element]:
    return [c for c in el if local(c.tag) == name] if el is not None else []


def text(el: ET.Element, name: str) -> str:
    c = child(el, name)
    return (c.text or "").strip() if c is not None else ""


def line_of(path: Path, ident: str, name: str) -> int:
    """Line of a process/object wrapper in the raw file (ET gives no lines): first such tag with that id, else that name."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    for attr, value in (("id", ident), ("name", name)):
        if value:
            m = re.compile(r"<(?:[\w.-]+:)?(?:process|object)\b[^>]*?\b%s=[\"']%s[\"']" % (attr, re.escape(escape(value)))).search(raw)
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


def contents_of(root: ET.Element) -> list[ET.Element]:
    """Every definition lives under `contents`; there are no siblings after it."""
    c = child(root, "contents")
    return list(c) if c is not None else []


def load_tree(path: Path) -> ET.Element:
    """Parse a release. The inner `<process>` is normally a child element of its wrapper; escaped text (older exports) is re-parsed."""
    root = ET.fromstring(path.read_bytes())
    if local(root.tag) != "release":
        raise ValueError("root")
    for wrapper in contents_of(root):
        if local(wrapper.tag) in ("process", "object") and child(wrapper, "process") is None:
            wrapper.append(_escaped_process(wrapper, path))
            wrapper.text = None
    return root


def file_id(path: Path) -> str:
    """Release identity: first 16 hex chars of the SHA-256 of the file bytes (the header package-id repeats across files)."""
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def _int(value: str | None) -> int | None:
    try:
        return int(float(value)) if value is not None else None
    except ValueError:
        return None


def _calc_exprs(stage: ET.Element) -> list[str]:
    nodes = children(stage, "calculation") + children(child(stage, "steps"), "calculation")
    return [n.get("expression", "") for n in nodes]


def _parse_elements(parent: ET.Element, object_id: str, parent_id: str | None, out: list[AppElement], notes: list[str]) -> None:
    for el in children(parent, "element"):
        eid = text(el, "id")  # the id is a child element here, not an attribute
        if eid:
            out.append(AppElement(eid, object_id, el.get("name", ""), text(el, "type"), parent_id,
                                  len(children(child(el, "attributes"), "attribute"))))  # attribute values are never read
        else:
            notes.append(f"element_missing_id object={q(object_id)} name={q(el.get('name', ''))}")
        _parse_elements(el, object_id, eid or None, out, notes)


def _code_hash(body: str) -> str:
    norm = "".join(body.split())  # empty bodies get no hash so they never count as duplicates
    return hashlib.sha256(norm.encode("utf-8")).hexdigest() if norm else ""


def _position(st: ET.Element) -> tuple[int | None, int | None]:
    disp = child(st, "display")
    if disp is not None:
        return _int(disp.get("x")), _int(disp.get("y"))
    x, y = child(st, "displayx"), child(st, "displayy")  # older exports: separate text elements
    return _int(x.text) if x is not None else None, _int(y.text) if y is not None else None


def _parse_stage(st: ET.Element, pd: ProcessData, marks: Marks, main_id: str) -> None:
    pid, pname = pd.process.id, pd.process.name
    sid, page, kind, sname = st.get("stageid", ""), text(st, "subsheetid") or main_id, st.get("type", ""), st.get("name", "")
    if not sid:
        raise ReleaseError(f"process={q(pname)} reason=stage_missing_id", pname, pid)
    x, y = _position(st)
    pd.stages.append(Stage(sid, pid, page, sname, kind, x, y))
    patterns, masked = marks.get(id(st), ("", 0))
    if masked:
        pd.masked.append(MaskedItem(sid, page, patterns, masked))
    if kind in ("Data", "Collection"):
        exposure = text(st, "exposure") or "None"  # only present when set
        iv = child(st, "initialvalue")
        encrypted = child(st, "initialvalueenc") is not None  # the value is never read or stored
        has_initial = encrypted or (iv is not None and (bool((iv.text or "").strip()) or len(iv) > 0))
        pd.data_items.append(DataItem(sid, pid, text(st, "datatype"), exposure, int(has_initial), int(bool(masked)), int(encrypted)))
        if exposure == "Environment":
            pd.env_uses.append(TargetRef(sid, page, "", sname))
    elif kind in ("Calculation", "MultipleCalculation"):
        exprs = _calc_exprs(st)
        pd.calc_stages.append(CalcStage(sid, pid, sum(len(e) for e in exprs), sum(len(_LITERAL.findall(e)) for e in exprs)))
    elif kind == "Code":
        code = child(st, "code")
        body = (code.text or "") if code is not None else ""
        io = [len(children(child(st, n), t)) for n, t in (("inputs", "input"), ("outputs", "output"))]
        pd.code_stages.append(CodeStage(sid, pid, code.get("language", "") if code is not None else "", len(body.splitlines()),
                                        io[0], io[1], _code_hash(body)))
    elif kind == "ProcessInfo":
        glob = (child(st, "globalcode").text or "") if child(st, "globalcode") is not None else ""
        pd.process = replace(pd.process, language=text(st, "language"), global_code_hash=_code_hash(glob),
                             global_code_line_count=len(glob.splitlines()))
    elif kind == "Action":
        res = child(st, "resource")
        pairs = tuple((i.get("name", ""), i.get("expr", "")) for i in children(child(st, "inputs"), "input"))
        if res is not None and res.get("object"):
            pd.actions.append(ActionRef(sid, page, res.get("object", ""), res.get("action", ""), pairs))
        else:
            pd.notes.append(f"stage_missing_resource process={q(pname)} stage={q(sname)}")
    elif kind == "SubSheet":  # `processid` holds the TARGET PAGE's subsheetid, within the same process
        pd.page_calls.append(TargetRef(sid, page, text(st, "processid")))
    elif kind == "Process":  # `processid` holds the target process id
        if text(st, "processid"):
            pd.process_calls.append(TargetRef(sid, page, text(st, "processid")))
        else:
            pd.notes.append(f"stage_missing_resource process={q(pname)} stage={q(sname)}")
    elif kind == "Exception":
        exc = child(st, "exception")
        pd.exceptions.append(TargetRef(sid, page, exc.get("type", "") if exc is not None else ""))
    if kind in STEP_TYPES:
        refs = [child(step, "element") for step in children(st, "step")]
        refs += [child(ch, "element") for ch in children(child(st, "choices"), "choice")]  # WaitStart conditions
        for ref in refs:
            if ref is not None and ref.get("id"):
                pd.element_uses.append(TargetRef(sid, page, ref.get("id", "")))


def _parse_process(wrapper: ET.Element, release_id: str, marks: Marks) -> ProcessData | None:
    inner = child(wrapper, "process")
    if inner is None:
        return None
    kind = "object" if inner.get("type") == "object" or local(wrapper.tag) == "object" else "process"
    pname = inner.get("name") or wrapper.get("name", "")
    pid = wrapper.get("id", "")  # the id is on the wrapper only
    if not pid:
        raise ReleaseError(f"process={q(pname)} reason=missing_id", pname, "")
    listed = [Page(s.get("subsheetid", ""), pid, text(s, "name"), s.get("type", ""), int(s.get("type") == "MainPage"),
                   int(s.get("published", "").lower() == "true"), 0) for s in children(inner, "subsheet")]
    main = next((p for p in listed if p.is_main), None)
    if main is None:  # the main page is not listed: stages with no subsheetid belong to it
        main = Page(pid + "/main", pid, "Initialise" if kind == "object" else "Main Page", "MainPage", 1, 0, 0)
        listed.insert(0, main)
    stages = children(inner, "stage")
    per_page = Counter(text(s, "subsheetid") or main.id for s in stages)
    pages = [replace(p, stage_count=per_page[p.id]) for p in listed]
    pd = ProcessData(Process(pid, pname, kind, release_id, len(pages), len(stages), inner.get("version", "")), pages=pages,
                     masked_total=sum(marks.get(id(s), ("", 0))[1] for s in stages))
    for st in stages:
        _parse_stage(st, pd, marks, main.id)
    if pd.process.language:  # code stages carry no language of their own; it comes from the object's ProcessInfo
        pd.code_stages = [c if c.language else replace(c, language=pd.process.language) for c in pd.code_stages]
    appdef = child(inner, "appdef")
    if appdef is not None:
        _parse_elements(appdef, pid, None, pd.app_elements, pd.notes)
    return pd


def _flag(value: str) -> int:
    return int(value.strip().lower() == "true")


def parse_release(root: ET.Element, source_file: str, release_id: str, marks: Marks) -> ParsedFile:
    """Extract entities from a sanitised release tree."""
    pf = ParsedFile(Release(release_id, text(root, "name"), text(root, "created"), text(root, "user-created-by"), source_file,
                            text(root, "package-id")))
    items = contents_of(root)
    declared = child(root, "contents")
    if declared is None:
        pf.notes.append(f"no_contents file={source_file}")
    elif _int(declared.get("count")) not in (None, len(items)):
        pf.notes.append(f"contents_count_mismatch file={source_file} declared={_int(declared.get('count'))} actual={len(items)}")
    kinds: Counter[str] = Counter(local(el.tag) for el in items)
    pf.kind_counts = {k: n for k, n in kinds.items() if k in OPAQUE_KINDS}
    for el in items:
        name = local(el.tag)
        if name in ("process", "object"):
            pd = _parse_process(el, release_id, marks)
            if pd is not None:
                pf.processes.append(pd)
        elif name == "work-queue":
            pf.queues.append(WorkQueue(el.get("name", ""), text(el, "keyfield"), release_id))
        elif name == "credential":
            members = child(el, "members")
            pf.credentials.append(CredentialRef(el.get("name") or el.get("id", ""), release_id,
                                                len(children(members, "process")) + len(children(members, "object"))))
        elif name == "environment-variable":
            ident = el.get("id") or el.get("name", "")  # the id IS the name
            pf.env_vars.append(EnvVar(ident, el.get("type", ""), release_id))
            if id(el) in marks:
                pf.env_masks[ident] = marks[id(el)]
        elif name in ("process-group", "object-group"):
            members = [m for kind in ("process", "object") for m in children(child(el, "members"), kind)]
            pf.groups.append(Group(el.get("id", ""), el.get("name", ""), name.split("-")[0], _flag(el.get("isDefaultGroup", "")), len(members)))
            pf.group_members += [GroupMember(el.get("id", ""), m.get("id", "")) for m in members]
        elif name == "webapiservice":
            actions = children(child(child(el, "configuration"), "actions") if child(el, "configuration") is not None else None, "action")
            pf.web_api_services.append(WebApiService(el.get("id", ""), el.get("name", ""), _flag(el.get("enabled", "")), len(actions)))
    return pf

"""Generates the three synthetic fixture releases in fixtures/releases/ in the REAL Blue Prism release shape (as observed in the
public corpus, see SPEC 2.5): every definition nested under `bpr:contents`, the inner `<process>` in the process namespace,
the main page implicit (stages with no `subsheetid`), SubSheet targets in `processid`, credentials, environment variables
(id attribute), groups and a web API service. Run from the bpanalyse directory:

    python fixtures/generate.py

Every id is a uuid5 on a fixed namespace, so the output is byte-identical on every run. All content is synthetic.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from xml.sax.saxutils import escape

NS = uuid.UUID("6f1f2a4e-5b1c-4d2e-8a3f-0b9a1c2d3e4f")
REL = "http://www.blueprism.co.uk/product/release"
PROC = "http://www.blueprism.co.uk/product/process"
WORK_QUEUES = "Blueprism.Automate.clsWorkQueuesActions"
CREDENTIALS = "Blueprism.Automate.clsCredentialsActions"
COLLECTIONS = "Blueprism.AutomateProcessCore.clsCollectionActions"
SHARED_CODE = "Dim s As String = Input1\nResult = s.Trim().ToUpper()"
ENCRYPTED = "ENCRYPTED-FIXTURE-VALUE-0001"


def uid(key: str) -> str:
    return str(uuid.uuid5(NS, key))


def sid(proc: str, stage: str, page: str | None = None) -> str:
    return uid(f"stage:{proc}:{page or ''}:{stage}")


def a(value: str) -> str:
    return '"' + escape(value, {'"': "&quot;"}) + '"'


def io(items: list[tuple[str, ...]], tag: str) -> str:
    if not items:
        return ""
    if tag == "input":
        rows = "".join(f'<input type={a(t)} name={a(n)} narrative="" expr={a(e)} />' for t, n, e in items)
    else:
        rows = "".join(f'<output type={a(t)} name={a(n)} narrative="" stage={a(s)} />' for t, n, s in items)
    return f"<{tag}s>{rows}</{tag}s>"


# ---- stage bodies ---------------------------------------------------------------------------------------------------

def action(obj: str, act: str, ins=(), outs=()) -> str:
    return io(list(ins), "input") + io(list(outs), "output") + f"<resource object={a(obj)} action={a(act)} />"


def data(dtype: str = "text", initial: str | None = None, exposure: str | None = None, enc: str | None = None) -> str:
    out = f"<datatype>{dtype}</datatype>"
    if enc is not None:
        out += f"<initialvalueenc>{enc}</initialvalueenc>"
    elif initial is not None:
        out += f'<initialvalue xml:space="preserve">{escape(initial)}</initialvalue>' if initial else "<initialvalue />"
    out += "<private /><alwaysinit />"
    return out + (f"<exposure>{exposure}</exposure>" if exposure else "")


def code(body: str, ins=(), outs=()) -> str:
    return io(list(ins), "input") + io(list(outs), "output") + f"<code><![CDATA[{body}]]></code>"


def exception(kind: str, detail: str) -> str:
    return f'<exception type={a(kind)} detail={a(detail)} usecurrent="False" savedetail="True" />'


class S:
    """One stage: name, type, body xml, owning page name (None = the implicit main page)."""

    def __init__(self, name: str, kind: str, body: str = "", page: str | None = None, chain: bool = True) -> None:
        self.name, self.kind, self.body, self.page, self.chain = name, kind, body, page, chain


def process_xml(name: str, kind: str, version: str, pages: list[tuple[str, str, bool]], stages: list[S], appdef: str = "",
                legacy: bool = False, published: bool = False, escaped: bool = False, narrative: str = "") -> str:
    pid = uid(f"{kind}:{name}")
    page_id = {p: uid(f"page:{name}:{p}") for p, _, _ in pages}
    subsheets = "".join(f'<subsheet subsheetid="{page_id[p]}" type="{t}" published="{pub}"><name>{escape(p)}</name>'
                        f'<view><camerax>0</camerax><cameray>0</cameray><zoom>1</zoom></view></subsheet>' for p, t, pub in
                        ((p, t, "True" if u else "False") for p, t, u in pages))
    by_page: dict[str | None, list[S]] = {}
    for s in stages:
        by_page.setdefault(s.page, []).append(s)
    out = []
    for page, group in by_page.items():
        for i, s in enumerate(group):
            x, y = 15 + 90 * i, 15
            disp = (f"<displayx>{x}</displayx><displayy>{y}</displayy><displaywidth>60</displaywidth><displayheight>30</displayheight>"
                    if legacy else f'<display x="{x}" y="{y}" w="60" h="30" />')
            nxt = group[i + 1] if i + 1 < len(group) else None
            succ = f"<onsuccess>{sid(name, nxt.name, page)}</onsuccess>" if nxt and s.chain and s.kind not in ("End", "Decision") else ""
            sub = f"<subsheetid>{page_id[page]}</subsheetid>" if page else ""
            out.append(f'<stage stageid="{sid(name, s.name, page)}" name={a(s.name)} type="{s.kind}"><narrative></narrative>{disp}'
                       f'<font family="Tahoma" size="10" style="Regular" color="000000" />{sub}{s.body}{succ}</stage>')
    obj = ' type="object" runmode="Background"' if kind == "object" else ""
    inner = (f'<process name={a(name)} version="{version}" bpversion="7.2.1" narrative={a(narrative)}{obj}>'
             f'<view><camerax>0</camerax><cameray>0</cameray><zoom>1</zoom></view><preconditions /><endpoint narrative="" />'
             f"{subsheets}{''.join(out)}{appdef}</process>")
    pub = ' published="true"' if published else ""
    if escaped:  # older exports: the inner process as escaped text
        return f'<{kind} id="{pid}" name={a(name)}{pub} xmlns="{PROC}">{escape(inner.replace("<process ", f"<process xmlns={chr(34)}{PROC}{chr(34)} ", 1))}</{kind}>'
    return f'<{kind} id="{pid}" name={a(name)}{pub} xmlns="{PROC}">{inner}</{kind}>'


def appdef(app: str, elements: list[tuple[str, str, list[str]]]) -> str:
    """elements: (name, type, [child names]); ids come from a `id` child element, attribute values are never stored by the tool."""
    def el(name: str, kind: str, kids: str = "") -> str:
        attrs = '<attributes><attribute name="Path" inuse="True"><ProcessValue datatype="text" value="C:\\Apps\\Fixture\\app.exe" /></attribute></attributes>'
        return (f'<element name={a(name)}><id>{uid(f"element:{app}:{name}")}</id><type>{kind}</type><basetype>{kind}</basetype>'
                f"<datatype>unknown</datatype><diagnose />{attrs}{kids}</element>")
    root = elements[0]
    kids = "".join(el(n, t) for n, t, _ in elements[1:])
    return (f"<appdef>{el(root[0], root[1], kids)}<apptypeinfo><id>{app}</id><parameters><parameter><name>Path</name>"
            f"<value>C:\\Apps\\Fixture\\app.exe</value></parameter></parameters></apptypeinfo></appdef>")


def element_id(app: str, name: str) -> str:
    return uid(f"element:{app}:{name}")


def step(app: str, elem: str, action_id: str = "Click", **attrs: str) -> str:
    extra = "".join(f" {k}={a(v)}" for k, v in attrs.items())
    return f'<step{extra}><element id="{element_id(app, elem)}" /><action><id>{action_id}</id></action></step>'


# ---- release wrapper ------------------------------------------------------------------------------------------------

def credential(name: str, members: list[str]) -> str:
    rows = "".join(f'<{k} id="{uid(f"{k}:{n}")}" />' for k, n in (m.split(":", 1) for m in members))
    return (f'<credential id="{uid("credential:" + name)}" name={a(name)} xmlns="http://www.blueprism.co.uk/product/credential">'
            f"<credentialType>General</credentialType><members>{rows}</members></credential>")


def env_var(name: str, value: str, kind: str = "text") -> str:
    return (f'<environment-variable id={a(name)} name={a(name)} type="{kind}" value={a(value)} '
            f'xmlns="http://www.blueprism.co.uk/product/environment-variable"><description>{escape(name)} setting</description></environment-variable>')


def group(kind: str, name: str, members: list[str], default: bool = False) -> str:
    rows = "".join(f'<{kind} id="{uid(f"{kind}:{n}")}" name={a(n)} />' for n in members)
    return (f'<{kind}-group id="{uid(f"{kind}-group:{name}")}" name={a(name)} isDefaultGroup="{default}" '
            f'xmlns="http://www.blueprism.co.uk/product/{kind}-group"><members>{rows}</members></{kind}-group>')


def web_api_service(name: str) -> str:
    acts = "".join(f'<action id="{uid(f"webapi:{name}:{n}")}" name="{n}" enabled="true"><request httpmethod="GET" urlpath="/{n.lower()}">'
                   f'<headers /><bodycontent type="None" /></request></action>' for n in ("Check", "Convert"))
    return (f'<webapiservice id="{uid("webapiservice:" + name)}" name={a(name)} enabled="true" '
            f'xmlns="http://www.blueprism.co.uk/product/webapiservice"><configuration baseurl="https://api.fixture.example.com">'
            f"<actions>{acts}</actions></configuration></webapiservice>")


def release(name: str, package_id: int, created: str, items: list[str]) -> str:
    body = "\n".join("    " + i for i in items)
    return (f'<?xml version="1.0" encoding="utf-8"?>\n<bpr:release xmlns:bpr="{REL}">\n    <bpr:name>{name}</bpr:name>\n'
            f"    <bpr:release-notes />\n    <bpr:created>{created}</bpr:created>\n    <bpr:package-id>{package_id}</bpr:package-id>\n"
            f"    <bpr:package-name>{name}</bpr:package-name>\n    <bpr:user-created-by>fixture</bpr:user-created-by>\n"
            f'    <bpr:contents count="{len(items)}">\n{body}\n    </bpr:contents>\n</bpr:release>\n')


# ---- scenarios ------------------------------------------------------------------------------------------------------

def policy_lookup(version: str, legacy: bool = False, escaped: bool = False) -> str:
    app = "Policy Lookup"
    els = appdef(app, [("Main Window", "Window", []), ("Policy Number Field", "Field", []), ("Search Button", "Button", []),
                       ("Status Label", "Label", [])])
    stages = [
        S("Start", "Start"), S("End", "End"),
        S("Start", "Start", page="Clean Up"), S("End", "End", page="Clean Up"),
        S("Start", "Start", page="Get Policy"), S("Policy Number", "Data", data(), "Get Policy"), S("Status", "Data", data(), "Get Policy"),
        S("Write Policy Number", "Write", step(app, "Policy Number Field", "Value", expr="[Policy Number]"), "Get Policy"),
        S("Click Search", "Navigate", step(app, "Search Button", "ClickCentre"), "Get Policy"),
        S("Read Status", "Read", step(app, "Status Label", "Text", stage="Status"), "Get Policy"),
        S("Normalise Status", "Code", code(SHARED_CODE, [("text", "Input1", "[Status]")], [("text", "Result", "Status")]), "Get Policy"),
        S("Recover", "Recover", page="Get Policy"), S("Resume", "Resume", page="Get Policy"), S("End", "End", page="Get Policy"),
        S("Start", "Start", page="Unused Helper"), S("End", "End", page="Unused Helper"),
        S("Info", "ProcessInfo", "<language>visualbasic</language><references /><imports /><globalcode><![CDATA[]]></globalcode><code><![CDATA[]]></code>"),
    ]
    pages = [("Clean Up", "CleanUp", False), ("Get Policy", "Normal", True), ("Unused Helper", "Normal", False)]
    return process_xml("Policy Lookup", "object", version, pages, stages, els, legacy=legacy, escaped=escaped)


def claims_core() -> str:
    validate, notify = uid("page:Claims Intake:Validate Claim"), uid("process:Claims Notify")
    intake = process_xml("Claims Intake", "process", "1.3", [("Validate Claim", "Normal", False), ("Old Validation", "Normal", False)], [
        S("Start", "Start"), S("Policy Number", "Data", data()), S("Status", "Data", data()), S("Item ID", "Data", data()),
        S("API Base URL", "Data", data(exposure="Environment")),
        S("Ops Mailbox", "Data", data(initial="ops.mailbox@example.com")),
        S("Vault Token", "Data", data(enc=ENCRYPTED)),
        S("Claims", "Collection", data("collection") + '<collectioninfo><field name="Reference" type="text" /></collectioninfo>'),
        S("Get Next Claim", "Action", action(WORK_QUEUES, "Get Next Item", [("text", "Queue Name", '"Claims Queue"')], [("text", "Item ID", "Item ID")])),
        S("Validate", "SubSheet", f"<processid>{validate}</processid>"),
        S("Get API Credential", "Action", action(CREDENTIALS, "Get Credential", [("text", "Credentials Name", '"Policy API"')])),
        S("Lookup Policy", "Action", action("Policy Lookup", "Get Policy", [("text", "Policy Number", "[Policy Number]")], [("text", "Status", "Status")])),
        S("Build Message", "Calculation", f'<calculation expression={a(chr(34) + "Policy " + chr(34) + " & [Policy Number] & " + chr(34) + " is " + chr(34) + " & [Status]")} stage="Status" />'),
        S("Add Row", "Action", action(COLLECTIONS, "Add Row", [("collection", "Collection", "[Claims]")])),
        S("Notify", "Process", f"<processid>{notify}</processid>" + io([("text", "Message", "[Status]")], "input")),
        S("Mark Complete", "Action", action(WORK_QUEUES, "Mark Completed", [("text", "Item ID", "[Item ID]")])),
        S("Recover", "Recover"), S("Resume", "Resume"), S("End", "End"),
        S("Start", "Start", page="Validate Claim"),
        S("Is Valid", "Decision", '<decision expression="Len([Policy Number]) &gt; 0" />' + f'<ontrue>{sid("Claims Intake", "End", "Validate Claim")}</ontrue>', "Validate Claim", chain=False),
        S("Invalid Claim", "Exception", exception("Business Exception", "Missing policy number"), "Validate Claim"),
        S("End", "End", page="Validate Claim"),
        S("Start", "Start", page="Old Validation"), S("End", "End", page="Old Validation"),
    ], published=True, narrative="Takes claims from the queue and looks up policy status.")
    notify_p = process_xml("Claims Notify", "process", "1.0", [], [
        S("Start", "Start"), S("Message", "Data", data()), S("Queue Name", "Data", data()), S("Status", "Data", data()),
        S("Lookup Policy Again", "Action", action("Policy Lookup", "Get Policy", [("text", "Policy Number", '"P123"')], [("text", "Status", "Status")])),
        S("Add To Audit Queue", "Action", action(WORK_QUEUES, "Add To Queue", [("text", "Queue Name", "[Queue Name]")])),
        S("Send Email", "Action", action("External Mailer", "Send", [("text", "Body", "[Message]")])),
        S("End", "End"),
    ])
    strings = process_xml("Utility Strings", "object", "2.0", [("Upper Trim", "Normal", True)], [
        S("Start", "Start"), S("End", "End"),
        S("Start", "Start", page="Upper Trim"), S("Input1", "Data", data(), "Upper Trim"), S("Result", "Data", data(), "Upper Trim"),
        S("Upper Trim Code", "Code", code("  " + SHARED_CODE.replace("\n", "\n\n  ") + "  ", [("text", "Input1", "[Input1]")], [("text", "Result", "Result")]), "Upper Trim"),
        S("End", "End", page="Upper Trim"),
        S("Info", "ProcessInfo", "<language>visualbasic</language><references /><imports /><globalcode><![CDATA[Dim shared As Integer = 1]]></globalcode><code><![CDATA[]]></code>"),
    ])
    return release("Claims Estate Core", 1, "2026-03-10 09:00:00Z", [
        intake, notify_p, policy_lookup("1.4"), strings,
        credential("Policy API", ["process:Claims Intake", "object:Policy Lookup"]),
        env_var("API Base URL", "https://policy.internal.example.com/api"),
        f'<work-queue id="{uid("queue:Claims Queue")}" name="Claims Queue" xmlns="http://www.blueprism.co.uk/product/work-queue"><keyfield>Reference</keyfield><maxattempts>3</maxattempts></work-queue>',
        group("process", "Default", ["Claims Intake", "Claims Notify"], True), group("object", "Default", ["Policy Lookup", "Utility Strings"], True),
        web_api_service("Policy Web Service"),
    ])


def legacy() -> str:
    reporter = process_xml("Legacy Reporter", "process", "0.9", [], [
        S("Start", "Start"), S("Account", "Data", data(initial="12345678")), S("Note", "Note"), S("End", "End"),
    ], legacy=True, escaped=True)
    return release("Policy Lookup Legacy", 2, "2025-11-02 14:30:00Z", [policy_lookup("1.2", legacy=True, escaped=True), reporter])


def every_stage_type() -> str:
    app = "UI Automation Object"
    els = appdef(app, [("Root", "Application", []), ("Login Button", "Button", []), ("Username Field", "Field", [])])
    util, companion = uid("page:UI Automation Object:Utility Page"), uid("process:Companion Process")
    ui = process_xml("UI Automation Object", "object", "1.0", [("Utility Page", "Normal", False)], [
        S("Start Stage", "Start", '<inputs><input type="text" name="In1" narrative="" stage="Result" /></inputs>'),
        S("Decision Stage", "Decision", '<decision expression="[Counter]&gt;1" />' + f'<ontrue>{sid(app, "Calculation Stage")}</ontrue><onfalse>{sid(app, "End Stage")}</onfalse>', chain=False),
        S("Calculation Stage", "Calculation", '<calculation expression="[a]+[b]" stage="Result" />'),
        S("MultipleCalculation Stage", "MultipleCalculation", '<steps><calculation expression="[a]+[b]" stage="Result" /><calculation expression="[a]-[b]" stage="Diff" /></steps>'),
        S("ChoiceStart Stage", "ChoiceStart", '<groupid>g1</groupid><choices><choice expression="[x]=1"><name>Option A</name><distance>1</distance><ontrue>' + sid(app, "ChoiceEnd Stage") + '</ontrue></choice></choices>'),
        S("ChoiceEnd Stage", "ChoiceEnd", "<groupid>g1</groupid>"),
        S("Data Stage", "Data", data(initial="Hello", exposure="Session")),
        S("Collection Stage", "Collection", data("collection") + '<collectioninfo><field name="Reference" type="text" /></collectioninfo>'),
        S("Action Stage", "Action", action("Utility Object", "Do Something", [("text", "Input1", '"value"')], [("text", "Output1", "Result")])),
        S("Empty Action", "Action", '<resource object="" action="" />'),
        S("SubSheet Stage", "SubSheet", f"<processid>{util}</processid>"),
        S("Process Stage", "Process", f"<processid>{companion}</processid>"),
        S("Code Stage", "Code", code("return a + b;", [("number", "a", "1")], [("number", "result", "Result")])),
        S("Navigate Stage", "Navigate", '<step><element id="' + element_id(app, "Login Button") + '" /><action><id>ClickCentre</id><arguments><argument><id>X</id><value>10</value></argument></arguments></action></step>'),
        S("Read Stage", "Read", step(app, "Username Field", "Text", stage="Username Value")),
        S("Write Stage", "Write", step(app, "Username Field", "Text", expr='"admin"')),
        S("WaitStart Stage", "WaitStart", '<groupid>g2</groupid><timeout>5</timeout><choices><choice reply="True"><name>Found</name><distance>1</distance>'
          f'<ontrue>{sid(app, "WaitEnd Stage")}</ontrue><element id="{element_id(app, "Login Button")}" /><condition><id>CheckExists</id></condition><comparetype>Equal</comparetype></choice></choices>'),
        S("WaitEnd Stage", "WaitEnd", "<groupid>g2</groupid>"),
        S("Exception Stage", "Exception", exception("System Exception", "Login failed")),
        S("Recover Stage", "Recover"), S("Resume Stage", "Resume"), S("Alert Stage", "Alert"), S("Note Stage", "Note"), S("Anchor Stage", "Anchor"),
        S("LoopStart Stage", "LoopStart", "<groupid>g3</groupid><looptype>ForEach</looptype><loopdata>Collection Stage</loopdata>"),
        S("LoopEnd Stage", "LoopEnd", "<groupid>g3</groupid>"), S("Block Stage", "Block"), S("SubSheetInfo Stage", "SubSheetInfo", page="Utility Page"),
        S("ProcessInfo Stage", "ProcessInfo", "<language>visualbasic</language><references><reference>System.dll</reference></references><imports><import>System</import></imports><globalcode><![CDATA[Dim shared As Integer = 1]]></globalcode><code><![CDATA[]]></code>"),
        S("Future Stage", "FutureStage"),
        S("End Stage", "End"),
        S("Utility Start", "Start", page="Utility Page"), S("Utility End", "End", page="Utility Page"),
    ], els, narrative="Exercises every known stage type.")
    utility = process_xml("Utility Object", "object", "1.0", [("Do Something", "Normal", True)], [
        S("Start", "Start"), S("End", "End"), S("Start", "Start", page="Do Something"), S("End", "End", page="Do Something")])
    comp = process_xml("Companion Process", "process", "1.0", [], [S("Start", "Start"), S("End", "End")])
    tile = f'<tile id="{uid("tile:Throughput")}" name="Throughput Tile" xmlns="http://www.blueprism.co.uk/product/tile" />'
    future = f'<future-thing id="{uid("future-thing")}" xmlns="http://www.blueprism.co.uk/product/future-thing">ignored</future-thing>'
    return release("Every Stage Type", 3, "2026-01-15 08:00:00Z", [comp, ui, utility, tile, future])


def main() -> None:
    out = Path(__file__).resolve().parent / "releases"
    out.mkdir(exist_ok=True)
    for file, xml in (("claims-core", claims_core()), ("policy-lookup-legacy", legacy()), ("every-stage-type", every_stage_type())):
        (out / f"{file}.bprelease").write_text(xml, encoding="utf-8", newline="\n")
        print(f"wrote {file}.bprelease")


if __name__ == "__main__":
    main()

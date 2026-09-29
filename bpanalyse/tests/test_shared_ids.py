"""SPEC 3: stage, page and element ids repeat across copied objects; rows and evidence stay attributed to the right process."""

import sqlite3

from conftest import MAIN, process_xml, release_xml, run_files, sheet_cells, stage_xml, wrapper_xml

from bpanalyse.query import named_edges


def _obj(pid: str, tag: str) -> str:
    pages = MAIN + (("pg-shared", f"Do {tag}", "Normal", "True"),)
    appdef = f'<appdef><element id="el-shared" name="Button {tag}"><type>Button</type></element></appdef>'
    stages = [
        stage_xml("st-act", f"Action {tag}", "Action", "pg-shared", '<resource object="Ext Mailer" action="Send"/><inputs/>'),
        stage_xml("st-code", f"Code {tag}", "Code", "pg-shared", f"<code language=\"csharp\">return {len(tag) + 1};</code>"),
        stage_xml("st-nav", f"Nav {tag}", "Navigate", "pg-shared", '<step><element id="el-shared"/></step>'),
        stage_xml("st-data", f"Data {tag}", "Data", "pg-shared", "<datatype>text</datatype><exposure>None</exposure>"),
    ]
    return wrapper_xml(pid, f"Obj {tag}", process_xml(pid, f"Obj {tag}", stages, pages=pages, obj=True, appdef=appdef), obj=True)


def test_shared_guids_attributed_per_process(tmp_path):
    rc, out = run_files(tmp_path, {"a.bprelease": release_xml(_obj("obj-a", "A"), _obj("obj-b", "B"))})
    assert rc == 0
    db = sqlite3.connect(out / "estate.sqlite")
    joined = db.execute("SELECT p.name, s.name FROM code_stage c JOIN stage s ON s.id = c.stage_id AND s.process_id = c.process_id "
                        "JOIN process p ON p.id = c.process_id ORDER BY 1").fetchall()
    assert joined == [("Obj A", "Code A"), ("Obj B", "Code B")]
    assert db.execute("SELECT count(*) FROM stage WHERE id = 'st-act'").fetchone() == (2,)
    rows = {(r[0], r[2], r[4], r[5], r[6]) for r in (e.row for e in named_edges(db))}
    assert ("Obj A", "Ext Mailer", "Do A", "Action A", 0) in rows and ("Obj B", "Ext Mailer", "Do B", "Action B", 0) in rows
    assert ("Do A", "Button A", "Do A", "Nav A", 0) in rows and ("Do B", "Button B", "Do B", "Nav B", 0) in rows
    findings = set(db.execute("SELECT entity_name, page_name, stage_name FROM finding WHERE finding_type = 'external_object'"))
    assert findings == {("Obj A", "Do A", "Action A"), ("Obj B", "Do B", "Action B")}
    inventory = sheet_cells(out / "inventory.xlsx")
    assert [r[0:3] for r in inventory["stage"][1:] if r[0] == "st-code"] == [("st-code", "obj-a", "pg-shared"), ("st-code", "obj-b", "pg-shared")]
    assert len(inventory["code_stage"]) == 3 and len({r[1] for r in inventory["code_stage"][1:]}) == 2
    assert len(inventory["app_element"]) == 3
    graph = (out / "graph.json").read_text()
    assert '"id": "obj-a/pg-shared"' in graph and '"id": "obj-b/pg-shared"' in graph


def test_empty_code_body_is_not_a_duplicate(tmp_path):
    def obj(pid, body):
        stage = stage_xml("st", "Code", "Code", inner=f'<code language="csharp">{body}</code>')
        return wrapper_xml(pid, f"O{pid}", process_xml(pid, f"O{pid}", [stage], obj=True), obj=True)

    rc, out = run_files(tmp_path, {"a.bprelease": release_xml(obj("1", ""), obj("2", "  \n "), obj("3", "x = 1"), obj("4", "x=1"))})
    assert rc == 0
    db = sqlite3.connect(out / "estate.sqlite")
    hashes = sorted(h for (h,) in db.execute("SELECT code_hash FROM code_stage"))
    assert hashes[:2] == ["", ""] and hashes[2] == hashes[3] != ""
    dup = db.execute("SELECT entity_name FROM finding WHERE finding_type = 'duplicate_code' ORDER BY 1").fetchall()
    assert dup == [("O3",), ("O4",)]
    assert db.execute("SELECT sum(duplicate_code_stages) FROM metrics").fetchone() == (2,)

"""SPEC 2.6: the real release shape (contents-nested, process namespace, implicit main page, processid targets, id-child elements)."""

import hashlib

from conftest import RELEASES, all_output_bytes


def one(db, sql, *args):
    return db.execute(sql, args).fetchall()


def test_release_identity_is_the_file_hash_and_package_id_its_own_column(db):
    rows = dict(one(db, "SELECT source_file, id || '/' || package_id FROM release"))
    for path in RELEASES.glob("*.bprelease"):
        assert rows[path.name].split("/")[0] == hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    assert {r.split("/")[1] for r in rows.values()} == {"1", "2", "3"}


def test_space_separated_created_parses(out_dir):
    assert "bad_created" not in (out_dir / "run.log").read_text()


def test_main_page_is_synthesised(db):
    assert one(db, "SELECT p.id || '/main' = g.id, g.name, g.type, g.is_main, g.is_published, g.stage_count FROM page g "
                   "JOIN process p ON p.id = g.process_id WHERE p.name = 'Claims Notify' AND g.is_main = 1") == [(1, "Main Page", "MainPage", 1, 0, 8)]
    assert one(db, "SELECT g.name FROM page g JOIN process p ON p.id = g.process_id WHERE p.name = 'Policy Lookup' AND g.is_main = 1") == [("Initialise",)]
    assert one(db, "SELECT count(*) FROM page g JOIN process p ON p.id = g.process_id WHERE p.name = 'Claims Intake'") == [(3,)]


def test_position_from_display_and_from_legacy_displayx(db):
    assert one(db, "SELECT x, y FROM stage WHERE name = 'Get Next Claim'") == [(15 + 90 * 8, 15)]
    assert one(db, "SELECT x, y FROM stage WHERE name = 'Account'") == [(105, 15)]  # displayx / displayy elements


def test_encrypted_initial_value(db, out_dir):
    assert one(db, "SELECT d.has_initial_value, d.is_masked, d.is_encrypted FROM data_item d JOIN stage s ON s.id = d.stage_id WHERE s.name = 'Vault Token'") == [(1, 1, 1)]
    assert one(db, "SELECT count(*) FROM data_item WHERE is_encrypted = 1") == [(1,)]
    assert ("Claims Intake", "encrypted") in one(db, "SELECT entity_name, detail FROM finding WHERE finding_type = 'masked_literal'")
    assert all(b"ENCRYPTED-FIXTURE-VALUE" not in blob for blob in all_output_bytes(out_dir))


def test_exposure_defaults_and_environment_edge(db):
    assert dict(one(db, "SELECT s.name, d.exposure FROM data_item d JOIN stage s ON s.id = d.stage_id "
                        "WHERE s.name IN ('Policy Number', 'API Base URL', 'Data Stage')")) == {
        "Policy Number": "None", "API Base URL": "Environment", "Data Stage": "Session"}
    assert one(db, "SELECT unresolved, to_id FROM edge WHERE edge_type = 'uses_env_var'") == [(0, "API Base URL")]
    assert one(db, "SELECT name, datatype FROM environment_variable") == [("API Base URL", "text")]


def test_credential_groups_and_web_api_service(db):
    assert one(db, "SELECT name, member_count FROM credential_ref") == [("Policy API", 2)]
    assert one(db, 'SELECT kind, is_default, member_count FROM "group" ORDER BY kind') == [("object", 1, 2), ("process", 1, 2)]
    assert one(db, "SELECT count(*) FROM group_member") == [(4,)]
    assert one(db, "SELECT name, enabled, action_count FROM web_api_service") == [("Policy Web Service", 1, 2)]


def test_subsheet_and_process_stages_link_by_processid(db):
    assert one(db, "SELECT e.unresolved, s.name FROM edge e JOIN stage s ON s.id = e.evidence_stage_id AND s.process_id = e.evidence_process_id "
                   "WHERE e.edge_type = 'calls_page' ORDER BY 2") == [(0, "SubSheet Stage"), (0, "Validate")]
    assert one(db, "SELECT p.name, e.unresolved FROM edge e JOIN process p ON p.id = e.to_id WHERE e.edge_type = 'calls_process' ORDER BY 1") == [
        ("Claims Notify", 0), ("Companion Process", 0)]


def test_internal_objects_are_flagged_not_external_and_not_mapped(db):
    rows = one(db, "SELECT to_id, to_type, count(*) FROM edge WHERE edge_type = 'calls_object' AND is_internal = 1 GROUP BY 1, 2 ORDER BY 1")
    assert rows == [("Blueprism.Automate.clsCredentialsActions", "internal_object", 1),
                    ("Blueprism.Automate.clsWorkQueuesActions", "internal_object", 3),
                    ("Blueprism.AutomateProcessCore.clsCollectionActions", "internal_object", 1)]
    assert one(db, "SELECT name FROM external_object") == [("External Mailer",)]
    assert one(db, "SELECT count(*) FROM release_map WHERE object_name LIKE 'Blueprism.%'") == [(0,)]
    assert one(db, "SELECT count(*) FROM edge WHERE is_internal = 1 AND edge_type != 'calls_object'") == [(0,)]
    assert one(db, "SELECT fan_out FROM metrics WHERE name = 'Claims Intake'") == [(1,)]  # Policy Lookup only; built-ins are not fan-out


def test_global_code_language_and_app_elements(db):
    assert one(db, "SELECT language, global_code_hash != '', global_code_line_count FROM process WHERE name = 'Utility Strings'") == [("visualbasic", 1, 1)]
    assert one(db, "SELECT DISTINCT c.language FROM code_stage c JOIN process p ON p.id = c.process_id WHERE p.name = 'Utility Strings'") == [("visualbasic",)]
    # ids come from the `id` child element; attribute values (paths) are never stored
    assert one(db, "SELECT count(*), sum(attribute_count) FROM app_element e JOIN process p ON p.id = e.object_id WHERE p.name = 'UI Automation Object'") == [(3, 3)]
    assert one(db, "SELECT count(*) FROM edge WHERE edge_type = 'uses_element' AND unresolved = 1") == [(0,)]

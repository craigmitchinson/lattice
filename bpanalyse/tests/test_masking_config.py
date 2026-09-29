"""SPEC 2.2: masking is generic, fails closed on a bad config, and is linear-time."""

import time

import pytest
from conftest import MAIN, all_output_bytes, make_config, process_xml, release_xml, run_files, stage_xml, wrapper_xml

from bpanalyse.cli import DEFAULT_CONFIG, main
from bpanalyse.sanitise import ConfigError, load_mask_config, mask_text

OBJ = "11111111-0000-0000-0000-000000000001"
SECRET = "hidden.person@corp.example.com"


def _rel(*stages, extra_pages=()):
    return release_xml(wrapper_xml(OBJ, "Obj", process_xml(OBJ, "Obj", list(stages), pages=MAIN + tuple(extra_pages), obj=True), obj=True))


@pytest.mark.parametrize("yaml_text", [None, "", "other: 1\n", "patterns:\n", "patterns: {}\n", "- a\n"])
def test_bad_mask_config_fails_closed(tmp_path, yaml_text, capsys):
    cfg = make_config(tmp_path, yaml_text)
    rc, out = run_files(tmp_path, {"a.bprelease": _rel()}, cfg)
    assert rc == 1 and "mask_config_error" in capsys.readouterr().err
    assert not (out / "graph.json").exists()


def test_missing_config_dir(tmp_path, capsys):
    rc, _ = run_files(tmp_path, {"a.bprelease": _rel()}, tmp_path / "nope")
    assert rc == 1 and "config_dir_missing" in capsys.readouterr().err


def test_default_config_is_package_relative():
    assert (DEFAULT_CONFIG / "mask_patterns.yaml").is_file() and "bpanalyse" in DEFAULT_CONFIG.parts
    with pytest.raises(ConfigError):
        load_mask_config(DEFAULT_CONFIG / "absent.yaml")


def test_masking_is_linear_on_hostile_input():
    cfg = load_mask_config(DEFAULT_CONFIG / "mask_patterns.yaml")
    for text in ("a" * 200_000, "a." * 100_000, "a" * 200_000 + "@", "password" + " " * 200_000):
        start = time.perf_counter()
        mask_text(text, cfg)
        assert time.perf_counter() - start < 1, text[:10]


def test_requires_prefilter_and_bounded_patterns():
    cfg = load_mask_config(DEFAULT_CONFIG / "mask_patterns.yaml")
    assert mask_text("mail " + SECRET, cfg)[1] == {"email": 1}
    assert mask_text("no at sign here", cfg) == ("no at sign here", {})
    assert mask_text("PASSWORD=hunter2", cfg)[1] == {"credential_keyword": 1}


def test_exception_type_and_detail_masked(tmp_path):
    exc = stage_xml("s-exc", "Raise", "Exception", inner=f'<exception type="Bad {SECRET}" detail="{SECRET}" usecurrent="False"/>')
    rc, out = run_files(tmp_path, {"a.bprelease": _rel(exc)})
    assert rc == 0
    import sqlite3

    (to_id,) = sqlite3.connect(out / "estate.sqlite").execute("SELECT to_id FROM edge WHERE edge_type = 'handles_exception'").fetchone()
    assert SECRET not in to_id and "[MASKED]" in to_id
    assert all(SECRET.encode() not in blob for blob in all_output_bytes(out))


def test_nested_collection_initial_value_masked(tmp_path):
    nested = (f'<datatype>collection</datatype><initialvalue><row><field name="Mail" type="text" value="{SECRET}"/></row></initialvalue>'
              f'<exposure>None</exposure>')
    plain = '<datatype>text</datatype><initialvalue>  </initialvalue>'
    rc, out = run_files(tmp_path, {"a.bprelease": _rel(stage_xml("s1", "Coll", "Collection", inner=nested),
                                                        stage_xml("s2", "Empty", "Data", inner=plain))})
    assert rc == 0
    import sqlite3

    rows = dict(sqlite3.connect(out / "estate.sqlite").execute(
        "SELECT s.name, d.has_initial_value || d.is_masked FROM data_item d JOIN stage s ON s.id = d.stage_id"))
    assert rows == {"Coll": "11", "Empty": "00"}
    assert all(SECRET.encode() not in blob for blob in all_output_bytes(out))

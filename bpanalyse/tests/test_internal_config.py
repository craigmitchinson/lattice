"""config/internal_objects.yaml is a list of {object, role, name_input}; a bad file is a fatal usage error."""

import shutil

from conftest import make_config, process_xml, release_xml, run_files, wrapper_xml

from bpanalyse.cli import DEFAULT_CONFIG
from bpanalyse.graph import load_internal_objects


def test_default_internal_objects():
    cfg = load_internal_objects(DEFAULT_CONFIG / "internal_objects.yaml")
    assert {k: (v.role, v.name_input) for k, v in cfg.items()} == {
        "Blueprism.Automate.clsWorkQueuesActions": ("work_queue", "Queue Name"),
        "Blueprism.Automate.clsCredentialsActions": ("credential", "Credentials Name"),
        "Blueprism.AutomateProcessCore.clsCollectionActions": ("collection", ""),
    }


def test_bad_internal_config_exits_1(tmp_path, capsys):
    cfg = make_config(tmp_path, "patterns:\n  a: 'x'\n")
    (cfg / "internal_objects.yaml").write_text("work_queues: {}\n")
    rc, _ = run_files(tmp_path, {"a.bprelease": release_xml(wrapper_xml("1", "P", process_xml("P")))}, cfg)
    assert rc == 1 and "internal_objects_config_error" in capsys.readouterr().err
    shutil.rmtree(cfg)

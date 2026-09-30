"""SPEC 2.5: `discover` writes a sorted, value-free path census; the run.log unrecognised list comes from the same traversal."""

import re

from conftest import RELEASES

from bpanalyse.cli import main


def test_discover_census_is_sorted_and_value_free(tmp_path):
    out = tmp_path / "sub" / "census.txt"
    assert main(["discover", str(RELEASES), str(out)]) == 0
    text = out.read_text()
    lines = text.splitlines()
    assert lines == sorted(lines) and all(re.fullmatch(r"/\S+ \d+", line) for line in lines)
    assert "/release/contents/process/process/stage[Data]/initialvalueenc 1" in lines
    assert any(line.startswith("/release/contents/object/process/stage[Action]/resource@object ") for line in lines)
    assert "/release/contents/object/process/stage[FutureStage] 1" in lines
    assert "/release/contents/future-thing 1" in lines
    for value in ("ops.mailbox", "12345678", "ENCRYPTED-FIXTURE", "Claims Queue", "policy.internal", "Claims Intake"):
        assert value not in text
    out2 = tmp_path / "again.txt"
    assert main(["discover", str(RELEASES), str(out2)]) == 0 and out2.read_bytes() == out.read_bytes()


def test_run_log_unrecognised_is_a_subset_of_the_census(tmp_path, out_dir):
    census = tmp_path / "c.txt"
    main(["discover", str(RELEASES), str(census)])
    paths = {line.rsplit(" ", 1)[0] for line in census.read_text().splitlines()}
    unknown = [line.split(" ")[1] for line in (out_dir / "run.log").read_text().splitlines() if line.startswith("unrecognised ")]
    assert unknown and set(unknown) <= paths


def test_discover_usage_and_bad_files(tmp_path, capsys):
    assert main(["discover", str(tmp_path / "missing"), str(tmp_path / "o.txt")]) == 1
    (tmp_path / "in").mkdir()
    (tmp_path / "in" / "bad.bprelease").write_text("<not xml")
    assert main(["discover", str(tmp_path / "in"), str(tmp_path / "o.txt")]) == 2
    assert "parse_error file=bad.bprelease" in capsys.readouterr().err

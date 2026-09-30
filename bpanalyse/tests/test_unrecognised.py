"""SPEC 9: unknown stage types and contents items are logged and the run still succeeds."""


def test_unrecognised_logged(out_dir):
    lines = (out_dir / "run.log").read_text().splitlines()
    unknown = [line for line in lines if line.startswith("unrecognised ")]
    assert unknown == ["unrecognised /release/contents/future-thing 1", "unrecognised /release/contents/object/process/stage[FutureStage] 1"]
    assert "file=every-stage-type.bprelease" in "\n".join(lines) and "skipped_tile=1" in "\n".join(lines)

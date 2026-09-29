"""SPEC 9: unknown stage types and elements are logged and the run still succeeds."""


def test_unrecognised_logged(out_dir):
    log = (out_dir / "run.log").read_text()
    assert "[type=FutureStage]" in log
    assert "bpr:future-thing" in log

"""SPEC 9: Policy Lookup 1.4 (claims-core, later) wins over 1.2 (policy-lookup-legacy); collision logged."""


def test_later_release_wins(db, out_dir):
    assert db.execute("SELECT version FROM process WHERE name = 'Policy Lookup'").fetchall() == [("1.4",)]
    log = (out_dir / "run.log").read_text()
    collision = [line for line in log.splitlines() if line.startswith("collision")]
    assert len(collision) == 1
    assert "claims-core.bprelease" in collision[0] and "policy-lookup-legacy.bprelease" in collision[0]

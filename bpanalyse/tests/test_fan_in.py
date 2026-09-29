"""SPEC 9: Policy Lookup called by two processes has fan_in 2 and distinct evidence stages."""


def test_policy_lookup_fan_in(db):
    (fan_in,) = db.execute("SELECT fan_in FROM metrics WHERE name = 'Policy Lookup'").fetchone()
    assert fan_in == 2
    rows = db.execute("SELECT DISTINCT from_id, evidence_stage_id FROM edge e JOIN process p ON p.id = e.to_id "
                      "WHERE p.name = 'Policy Lookup' AND edge_type = 'calls_object'").fetchall()
    assert len(rows) == 2 and len({r[1] for r in rows}) == 2

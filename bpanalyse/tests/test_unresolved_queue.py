"""SPEC 9: the Add To Audit Queue stage's queue edge has unresolved = 1."""


def test_audit_queue_unresolved(db):
    row = db.execute("SELECT e.unresolved, e.to_id, e.detail FROM edge e JOIN stage s ON s.id = e.evidence_stage_id "
                     "WHERE s.name = 'Add To Audit Queue' AND e.edge_type = 'uses_queue'").fetchone()
    assert row == (1, "", "12")


def test_literal_queue_resolves(db):
    row = db.execute("SELECT unresolved, to_id FROM edge e JOIN stage s ON s.id = e.evidence_stage_id "
                     "WHERE s.name = 'Get Next Claim'").fetchone()
    assert row == (0, "Claims Queue")

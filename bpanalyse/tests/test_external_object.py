"""SPEC 9: External Mailer is an external_object finding, not an error."""


def test_external_mailer_is_a_finding(db):
    rows = db.execute("SELECT detail FROM finding WHERE finding_type = 'external_object'").fetchall()
    assert ("External Mailer",) in rows
    assert db.execute("SELECT name FROM external_object").fetchall() == [("External Mailer",)]

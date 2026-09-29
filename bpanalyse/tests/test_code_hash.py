"""SPEC 9: Normalise Status and Upper Trim Code share a code_hash despite whitespace differences."""


def test_shared_code_hash(db):
    rows = db.execute("SELECT s.name, c.code_hash FROM code_stage c JOIN stage s ON s.id = c.stage_id "
                      "WHERE s.name IN ('Normalise Status', 'Upper Trim Code')").fetchall()
    assert len(rows) == 2 and rows[0][1] == rows[1][1]

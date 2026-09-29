"""SPEC 9: masked values are reported as findings and appear in no output file."""

import zipfile

from conftest import sheet_cells

SECRETS = ("ops.mailbox@example.com", "12345678", "policy.internal.example.com")


def test_masked_literal_findings(db):
    rows = db.execute("SELECT entity_name, detail FROM finding WHERE finding_type = 'masked_literal'").fetchall()
    assert ("Claims Intake", "email") in rows
    assert ("Legacy Reporter", "account_number") in rows


def test_secrets_absent_from_every_output(out_dir):
    for path in out_dir.iterdir():
        blobs = [path.read_bytes()]
        if path.suffix == ".xlsx":
            with zipfile.ZipFile(path) as z:
                blobs += [z.read(n) for n in z.namelist()]
            blobs.append(repr(sheet_cells(path)).encode())
        for blob in blobs:
            for secret in SECRETS:
                assert secret.encode() not in blob, (path.name, secret)

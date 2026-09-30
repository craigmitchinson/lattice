"""SPEC 9: every stage type in the fixtures is counted correctly per page (stages with no subsheetid are on the implicit main page)."""

from collections import Counter

from conftest import RELEASES

from bpanalyse.parse import child, contents_of, load_tree
from bpanalyse.sanitise import local


def test_stage_counts_per_page(db):
    expected: Counter = Counter()
    for f in ("claims-core", "every-stage-type", "policy-lookup-legacy"):
        for wrapper in contents_of(load_tree(RELEASES / (f + ".bprelease"))):
            if local(wrapper.tag) not in ("process", "object"):
                continue
            if f == "policy-lookup-legacy" and wrapper.get("name") == "Policy Lookup":
                continue  # loses the collision to claims-core
            for st in (e for e in wrapper.iter() if local(e.tag) == "stage"):
                sub = child(st, "subsheetid")
                expected[((sub.text if sub is not None else wrapper.get("id") + "/main"), st.get("type"))] += 1
    actual = Counter({(p, t): n for p, t, n in db.execute("SELECT page_id, type, COUNT(*) FROM stage GROUP BY page_id, type")})
    assert actual == expected
    assert sum(n for (_, t), n in actual.items() if t == "FutureStage") == 1
    assert db.execute("SELECT count(*) FROM page WHERE is_main = 1").fetchone() == (db.execute("SELECT count(*) FROM process").fetchone()[0],)

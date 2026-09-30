"""Downloads the eight public Blue Prism release exports (BP 5.0 to 6.10) into this directory. They are gitignored: run

    python fixtures/public/fetch.py

then `python -m pytest -q` includes tests/test_public_corpus.py. Skips files already present. Needs network access.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlsplit

URLS = (
    "https://raw.githubusercontent.com/pritishsanyal/BluePrism-UtilityPDF/main/Utility%20-%20PDF.bprelease",
    "https://raw.githubusercontent.com/Dovey220/MSExcelVBO_Extended/master/MS%20Excel%20VBO%20-%20Extended%20v2.0.bprelease",
    "https://raw.githubusercontent.com/kristianrl/blue-prism-screenshooter/master/Screenshooter.bprelease",
    "https://raw.githubusercontent.com/harini1702/RPA-Blue-Prism/master/Blue-Prism/Policy%20Example.bprelease",
    "https://raw.githubusercontent.com/faisalmaqsood01/blueprism-training/master/queue%20mod.bprelease",
    "https://raw.githubusercontent.com/faisalmaqsood01/blueprism-training/master/30th.bprelease",
    "https://raw.githubusercontent.com/datacorner/blueprism-deskew-skill/master/LocalImageUtils_1.5.bprelease",
    "https://raw.githubusercontent.com/SynergyAutomate/Ramona/Development/Blue%20Prism%20-%20DX%20VBO/Generate+Blue+Prism+Access+Report.bprelease",
)


def main() -> int:
    here = Path(__file__).resolve().parent
    failed = 0
    for url in URLS:
        target = here / unquote(urlsplit(url).path.rsplit("/", 1)[-1])
        if target.exists():
            print(f"have {target.name}")
            continue
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                target.write_bytes(resp.read())
            print(f"fetched {target.name}")
        except OSError as exc:
            failed += 1
            print(f"failed {target.name}: {exc}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

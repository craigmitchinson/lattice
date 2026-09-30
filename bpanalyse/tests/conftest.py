"""Shared fixtures: run the tool once over the fixture releases."""

import sqlite3
from pathlib import Path

import openpyxl
import pytest

from bpanalyse.cli import main

ROOT = Path(__file__).resolve().parents[1]
RELEASES = ROOT / "fixtures" / "releases"
GOLDEN = ROOT / "fixtures" / "expected" / "graph.json"


def run_into(out: Path) -> int:
    return main(["run", str(RELEASES), str(out)])


def sheet_cells(path: Path) -> dict[str, list[tuple]]:
    wb = openpyxl.load_workbook(path)
    return {ws.title: [tuple(r) for r in ws.iter_rows(values_only=True)] for ws in wb}


@pytest.fixture(scope="session")
def out_dir(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("out")
    assert run_into(out) == 0
    return out


@pytest.fixture(scope="session")
def db(out_dir) -> sqlite3.Connection:
    return sqlite3.connect(out_dir / "estate.sqlite")


# ---- helpers for building small synthetic releases -------------------------------------------------------------

import shutil
import zipfile

from bpanalyse.cli import DEFAULT_CONFIG

NS = "http://www.blueprism.co.uk/product/release"
PNS = "http://www.blueprism.co.uk/product/process"


def stage_xml(sid: str, name: str, kind: str, page: str | None = None, inner: str = "") -> str:
    """A stage; `page` None means the implicit main page (no subsheetid child)."""
    sub = f"<subsheetid>{page}</subsheetid>" if page else ""
    return f'<stage stageid="{sid}" name="{name}" type="{kind}">{sub}{inner}</stage>'


def process_xml(name: str, stages: list[str] = (), pages=(), obj: bool = False, appdef: str = "", prefix: str = "") -> str:
    """The inner process; `pages` are the LISTED subsheets (id, name, type, published). The main page is never listed."""
    subs = "".join(f'<subsheet subsheetid="{i}" type="{t}" published="{p}"><name>{n}</name></subsheet>' for i, n, t, p in pages)
    kind = ' type="object"' if obj else ""
    return f'<{prefix}process name="{name}" version="1"{kind}>{subs}{"".join(stages)}{appdef}</{prefix}process>'


def wrapper_xml(pid: str | None, name: str, body: str, obj: bool = False, escape: bool = False) -> str:
    """A `contents` item: id and name live on the wrapper, the inner process is a child element (or escaped text)."""
    tag = "object" if obj else "process"
    ident = f' id="{pid}"' if pid else ""
    if escape:
        body = body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f'<{tag}{ident} name="{name}" xmlns="{PNS}">{body}</{tag}>'


def release_xml(*items: str, created: str = "2026-01-01 00:00:00Z", pkg: str = "1", eol: str = "\n") -> str:
    head = (f'<?xml version="1.0" encoding="utf-8"?>\n<bpr:release xmlns:bpr="{NS}">\n<bpr:name>R</bpr:name>\n'
            f'<bpr:created>{created}</bpr:created>\n<bpr:package-id>{pkg}</bpr:package-id>\n'
            f'<bpr:contents count="{len(items)}">\n')
    return (head + "\n".join(items) + "\n</bpr:contents>\n</bpr:release>\n").replace("\n", eol)


def run_files(tmp_path: Path, files: dict[str, bytes | str], config_dir: Path | None = None) -> tuple[int, Path]:
    src = tmp_path / "in"
    src.mkdir(exist_ok=True)
    for name, content in files.items():
        (src / name).write_bytes(content.encode("utf-8") if isinstance(content, str) else content)
    out = tmp_path / "out"
    args = ["run", str(src), str(out)] + (["--config-dir", str(config_dir)] if config_dir else [])
    return main(args), out


def make_config(tmp_path: Path, mask_yaml: str | None) -> Path:
    cfg = tmp_path / "cfg"
    shutil.copytree(DEFAULT_CONFIG, cfg)
    if mask_yaml is None:
        (cfg / "mask_patterns.yaml").unlink()
    else:
        (cfg / "mask_patterns.yaml").write_text(mask_yaml, encoding="utf-8")
    return cfg


def all_output_bytes(out: Path) -> list[bytes]:
    blobs = []
    for path in out.iterdir():
        blobs.append(path.read_bytes())
        if path.suffix == ".xlsx":
            with zipfile.ZipFile(path) as z:
                blobs += [z.read(n) for n in z.namelist()]
    return blobs

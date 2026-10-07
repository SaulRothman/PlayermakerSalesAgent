from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.catalog import CatalogStore

REPO = Path(__file__).resolve().parents[2]
SRC_DATA = REPO / "data" / "playermaker"


@pytest.fixture()
def data_dir(tmp_path: Path) -> Path:
    dest = tmp_path / "playermaker"
    shutil.copytree(SRC_DATA, dest)
    (dest / "leads.json").unlink(missing_ok=True)
    return dest


@pytest.fixture()
def store(data_dir: Path) -> CatalogStore:
    return CatalogStore(data_dir)


@pytest.fixture()
def client(data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CATALOG_DATA_DIR", str(data_dir))
    monkeypatch.delenv("CATALOG_API_KEY", raising=False)
    monkeypatch.delenv("DEVREV_PAT", raising=False)
    import api.app as appmod

    appmod.store = CatalogStore(data_dir)
    return TestClient(appmod.app)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))

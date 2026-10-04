"""JSON catalog store — the scanned Phase 1 files are the database."""

from __future__ import annotations

import json
import os
import re
import threading
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def default_data_dir() -> Path:
    env = os.environ.get("CATALOG_DATA_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path(__file__).resolve().parents[1] / "data" / "playermaker"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def deep_merge(base: Any, patch: Any) -> Any:
    if isinstance(base, dict) and isinstance(patch, dict):
        out = dict(base)
        for k, v in patch.items():
            if v is None:
                out.pop(k, None)
            elif k in out:
                out[k] = deep_merge(out[k], v)
            else:
                out[k] = deepcopy(v)
        return out
    return deepcopy(patch)


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:80] or "item"


class CatalogStore:
    FILES = ("products.json", "fit_rules.json", "objections.json", "gaps.json", "source_pages.json", "scan_report.json")

    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = data_dir or default_data_dir()
        self._lock = threading.RLock()
        self.products_doc: dict[str, Any] = {}
        self.fit_doc: dict[str, Any] = {}
        self.objections_doc: dict[str, Any] = {}
        self.gaps_doc: dict[str, Any] = {}
        self.sources_doc: dict[str, Any] = {}
        self.report_doc: dict[str, Any] = {}
        self.loaded_at: str | None = None
        self.load()

    def load(self) -> None:
        with self._lock:
            self.products_doc = self._read("products.json")
            self.fit_doc = self._read("fit_rules.json")
            self.objections_doc = self._read("objections.json")
            self.gaps_doc = self._read("gaps.json")
            self.sources_doc = self._read("source_pages.json")
            self.report_doc = self._read("scan_report.json")
            self.loaded_at = utc_now()

    def _read(self, name: str) -> dict[str, Any]:
        path = self.data_dir / name
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def _write(self, name: str, doc: dict[str, Any]) -> None:
        path = self.data_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        tmp.replace(path)

    def products(self) -> list[dict[str, Any]]:
        return list(self.products_doc.get("products") or [])

    def comparison(self) -> list[dict[str, Any]]:
        return list(self.products_doc.get("comparison") or [])

    def get_product(self, product_id: str) -> dict[str, Any] | None:
        for p in self.products():
            if p.get("product_id") == product_id:
                return p
        return None

    def rules(self) -> list[dict[str, Any]]:
        return sorted(self.fit_doc.get("rules") or [], key=lambda r: r.get("priority", 100))

    def objections(self) -> list[dict[str, Any]]:
        return list(self.objections_doc.get("objections") or [])

    def get_objection(self, objection_id: str) -> dict[str, Any] | None:
        for o in self.objections():
            if o.get("objection_id") == objection_id:
                return o
        return None

    def gaps(self) -> list[dict[str, Any]]:
        return list(self.gaps_doc.get("gaps") or [])

    def gaps_for(self, product_id: str | None, extra_ids: list[str] | None = None) -> list[dict[str, Any]]:
        wanted = set(extra_ids or [])
        out = []
        for g in self.gaps():
            if g.get("gap_id") in wanted:
                out.append(g)
                continue
            if product_id and g.get("product_id") == product_id:
                out.append(g)
                continue
            if product_id is None and g.get("product_id") in (None, ""):
                # catalog-wide conflicts, only when asked without a product
                if g.get("severity") == "conflict":
                    out.append(g)
        return out

    def meta(self) -> dict[str, Any]:
        report = self.report_doc or {}
        return {
            "api_version": "1.0",
            "schema_version": self.products_doc.get("schema_version"),
            "scan_generated_at": self.products_doc.get("generated_at"),
            "loaded_at": self.loaded_at,
            "data_dir": str(self.data_dir),
            "source": self.products_doc.get("source"),
            "counts": report.get("counts")
            or {
                "products": len(self.products()),
                "fit_rules": len(self.rules()),
                "objections": len(self.objections()),
                "gaps": len(self.gaps()),
            },
            "product_ids": [p.get("product_id") for p in self.products()],
            "gap_ids": [g.get("gap_id") for g in self.gaps()],
        }

    def upsert_product(self, product: dict[str, Any], *, create: bool) -> dict[str, Any]:
        pid = product.get("product_id")
        if not pid:
            raise ValueError("product_id is required")
        with self._lock:
            items = self.products()
            idx = next((i for i, p in enumerate(items) if p.get("product_id") == pid), None)
            if create and idx is not None:
                raise ValueError(f"product_id already exists: {pid}")
            if not create and idx is None:
                raise KeyError(pid)
            if idx is None:
                items.append(product)
            else:
                items[idx] = product
            self.products_doc["products"] = items
            self.products_doc["generated_at"] = utc_now()
            self._write("products.json", self.products_doc)
            return product

    def patch_product(self, product_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        patch = dict(patch)
        patch.pop("product_id", None)
        existing = self.get_product(product_id)
        if not existing:
            raise KeyError(product_id)
        merged = deep_merge(existing, patch)
        merged["product_id"] = product_id
        return self.upsert_product(merged, create=False)

    def delete_product(self, product_id: str) -> None:
        with self._lock:
            items = [p for p in self.products() if p.get("product_id") != product_id]
            if len(items) == len(self.products()):
                raise KeyError(product_id)
            self.products_doc["products"] = items
            self.products_doc["generated_at"] = utc_now()
            self._write("products.json", self.products_doc)

    def upsert_rule(self, rule: dict[str, Any], *, create: bool) -> dict[str, Any]:
        rid = rule.get("rule_id")
        if not rid:
            raise ValueError("rule_id is required")
        with self._lock:
            items = list(self.fit_doc.get("rules") or [])
            idx = next((i for i, r in enumerate(items) if r.get("rule_id") == rid), None)
            if create and idx is not None:
                raise ValueError(f"rule_id already exists: {rid}")
            if not create and idx is None:
                raise KeyError(rid)
            if idx is None:
                items.append(rule)
            else:
                items[idx] = deep_merge(items[idx], rule)
            self.fit_doc["rules"] = items
            self.fit_doc["generated_at"] = utc_now()
            self._write("fit_rules.json", self.fit_doc)
            return next(r for r in items if r.get("rule_id") == rid)

    def delete_rule(self, rule_id: str) -> None:
        with self._lock:
            items = [r for r in self.rules() if r.get("rule_id") != rule_id]
            if len(items) == len(self.rules()):
                raise KeyError(rule_id)
            self.fit_doc["rules"] = items
            self.fit_doc["generated_at"] = utc_now()
            self._write("fit_rules.json", self.fit_doc)

    def upsert_objection(self, obj: dict[str, Any], *, create: bool) -> dict[str, Any]:
        oid = obj.get("objection_id") or slugify(obj.get("objection") or "")
        obj = dict(obj)
        obj["objection_id"] = oid
        with self._lock:
            items = self.objections()
            idx = next((i for i, o in enumerate(items) if o.get("objection_id") == oid), None)
            if create and idx is not None:
                raise ValueError(f"objection_id already exists: {oid}")
            if not create and idx is None:
                raise KeyError(oid)
            if idx is None:
                items.append(obj)
            else:
                items[idx] = deep_merge(items[idx], obj)
            self.objections_doc["objections"] = items
            self.objections_doc["generated_at"] = utc_now()
            self._write("objections.json", self.objections_doc)
            return next(o for o in items if o.get("objection_id") == oid)

    def delete_objection(self, objection_id: str) -> None:
        with self._lock:
            items = [o for o in self.objections() if o.get("objection_id") != objection_id]
            if len(items) == len(self.objections()):
                raise KeyError(objection_id)
            self.objections_doc["objections"] = items
            self.objections_doc["generated_at"] = utc_now()
            self._write("objections.json", self.objections_doc)

    def patch_gap(self, gap_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            items = self.gaps()
            idx = next((i for i, g in enumerate(items) if g.get("gap_id") == gap_id), None)
            if idx is None:
                raise KeyError(gap_id)
            items[idx] = deep_merge(items[idx], patch)
            items[idx]["gap_id"] = gap_id
            self.gaps_doc["gaps"] = items
            self.gaps_doc["generated_at"] = utc_now()
            self._write("gaps.json", self.gaps_doc)
            return items[idx]

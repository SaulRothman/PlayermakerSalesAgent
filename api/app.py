"""Playermaker catalog API. Product logic lives here — not in the website or the agent prompt."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from api.auth import require_key_if_configured
from api.catalog import CatalogStore, slugify, utc_now
from api.fit import compare as fit_compare
from api.fit import explain as fit_explain
from api.fit import match as fit_match
from api.leads import capture_lead, list_leads
from api.models import (
    API_VERSION,
    CompareRequest,
    ExplainRequest,
    FitRuleIn,
    GapPatch,
    LeadIn,
    MatchRequest,
    ObjectionIn,
    ScanRefreshRequest,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
SCAN_SCRIPT = REPO_ROOT / "scripts" / "scan_playermaker.py"

store = CatalogStore()
_scan_lock = threading.Lock()
_scan_job: dict[str, Any] = {
    "status": "idle",
    "started_at": None,
    "finished_at": None,
    "exit_code": None,
    "error": None,
    "reload_only": False,
}


def get_store() -> CatalogStore:
    return store


def _run_scan(delay: float) -> None:
    global _scan_job
    try:
        proc = subprocess.run(
            [sys.executable, str(SCAN_SCRIPT), "--delay", str(delay), "--out", str(store.data_dir)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
        with _scan_lock:
            _scan_job["exit_code"] = proc.returncode
            _scan_job["finished_at"] = utc_now()
            if proc.returncode != 0:
                _scan_job["status"] = "failed"
                _scan_job["error"] = (proc.stderr or proc.stdout or "scan failed")[-2000:]
            else:
                store.load()
                _scan_job["status"] = "completed"
                _scan_job["error"] = None
    except Exception as exc:  # noqa: BLE001 — surface scan runner failures
        with _scan_lock:
            _scan_job["status"] = "failed"
            _scan_job["finished_at"] = utc_now()
            _scan_job["error"] = f"{type(exc).__name__}: {exc}"


app = FastAPI(
    title="Playermaker Catalog API",
    version=API_VERSION,
    description=(
        "Versioned catalog + fit engine over the Phase 1 scan. "
        "The website must not call these endpoints from the browser; DevRev skills will."
    ),
)


def _http_error(exc: KeyError | ValueError, not_found: str) -> None:
    if isinstance(exc, KeyError):
        raise HTTPException(status_code=404, detail=f"{not_found} not found") from exc
    raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- health / meta ---


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "ok": True,
        "api_version": API_VERSION,
        "docs": "/docs",
        "health": "/health",
        "products": "/products",
        "fit": ["/fit/match", "/fit/explain", "/fit/compare"],
        "leads": ["/leads"],
    }


@app.get("/health")
@app.get("/v1/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "api_version": API_VERSION,
        "loaded_at": store.loaded_at,
        "data_dir": str(store.data_dir),
        "product_count": len(store.products()),
    }


@app.get("/meta")
@app.get("/v1/meta")
def meta(_: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    return store.meta()


# --- products ---


@app.get("/products")
@app.get("/v1/products")
def list_products(
    role: str | None = None,
    _: None = Depends(require_key_if_configured),
) -> dict[str, Any]:
    items = store.products()
    if role:
        items = [p for p in items if p.get("role") == role]
    return {
        "api_version": API_VERSION,
        "count": len(items),
        "products": items,
        "comparison": store.comparison() if not role else [],
    }


@app.get("/products/{product_id}")
@app.get("/v1/products/{product_id}")
def get_product(product_id: str, _: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    product = store.get_product(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="product not found")
    return {
        "api_version": API_VERSION,
        "product": product,
        "relevant_gaps": store.gaps_for(product_id, list(product.get("gaps") or [])),
    }


@app.post("/products", status_code=201)
@app.post("/v1/products", status_code=201)
def create_product(body: dict[str, Any], _: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    try:
        product = store.upsert_product(body, create=True)
    except (KeyError, ValueError) as exc:
        _http_error(exc, "product")
    return {"api_version": API_VERSION, "product": product}


@app.patch("/products/{product_id}")
@app.put("/products/{product_id}")
@app.patch("/v1/products/{product_id}")
@app.put("/v1/products/{product_id}")
def patch_product(
    product_id: str, body: dict[str, Any], _: None = Depends(require_key_if_configured)
) -> dict[str, Any]:
    try:
        product = store.patch_product(product_id, body)
    except (KeyError, ValueError) as exc:
        _http_error(exc, "product")
    return {"api_version": API_VERSION, "product": product}


@app.delete("/products/{product_id}", status_code=204)
@app.delete("/v1/products/{product_id}", status_code=204)
def delete_product(product_id: str, _: None = Depends(require_key_if_configured)) -> None:
    try:
        store.delete_product(product_id)
    except KeyError as exc:
        _http_error(exc, "product")


# --- fit ---


@app.post("/fit/match")
@app.post("/v1/fit/match")
def post_fit_match(body: MatchRequest, _: None = Depends(require_key_if_configured)) -> Any:
    return fit_match(store, body.signals)


@app.post("/fit/explain")
@app.post("/v1/fit/explain")
def post_fit_explain(body: ExplainRequest, _: None = Depends(require_key_if_configured)) -> Any:
    if not store.get_product(body.product_id):
        raise HTTPException(status_code=404, detail="product not found")
    return fit_explain(store, body.product_id, body.signals)


@app.post("/fit/compare")
@app.post("/v1/fit/compare")
def post_fit_compare(body: CompareRequest, _: None = Depends(require_key_if_configured)) -> Any:
    return fit_compare(store, body.product_ids, body.signals)


@app.get("/fit/rules")
@app.get("/v1/fit/rules")
def list_rules(_: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    return {"api_version": API_VERSION, "rules": store.rules()}


@app.post("/fit/rules", status_code=201)
@app.post("/v1/fit/rules", status_code=201)
def create_rule(body: FitRuleIn, _: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    try:
        rule = store.upsert_rule(body.model_dump(), create=True)
    except (KeyError, ValueError) as exc:
        _http_error(exc, "rule")
    return {"api_version": API_VERSION, "rule": rule}


@app.patch("/fit/rules/{rule_id}")
@app.put("/fit/rules/{rule_id}")
@app.patch("/v1/fit/rules/{rule_id}")
@app.put("/v1/fit/rules/{rule_id}")
def patch_rule(rule_id: str, body: dict[str, Any], _: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    payload = dict(body)
    payload["rule_id"] = rule_id
    try:
        rule = store.upsert_rule(payload, create=False)
    except (KeyError, ValueError) as exc:
        _http_error(exc, "rule")
    return {"api_version": API_VERSION, "rule": rule}


@app.delete("/fit/rules/{rule_id}", status_code=204)
@app.delete("/v1/fit/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: str, _: None = Depends(require_key_if_configured)) -> None:
    try:
        store.delete_rule(rule_id)
    except KeyError as exc:
        _http_error(exc, "rule")


# --- objections ---


@app.get("/objections")
@app.get("/v1/objections")
def list_objections(
    q: str | None = Query(default=None, description="Case-insensitive substring on question or answer"),
    _: None = Depends(require_key_if_configured),
) -> dict[str, Any]:
    items = store.objections()
    if q:
        needle = q.lower()
        items = [
            o
            for o in items
            if needle in (o.get("objection") or "").lower() or needle in (o.get("answer") or "").lower()
        ]
    return {"api_version": API_VERSION, "count": len(items), "objections": items}


@app.get("/objections/{objection_id}")
@app.get("/v1/objections/{objection_id}")
def get_objection(objection_id: str, _: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    obj = store.get_objection(objection_id)
    if not obj:
        raise HTTPException(status_code=404, detail="objection not found")
    return {"api_version": API_VERSION, "objection": obj}


@app.post("/objections", status_code=201)
@app.post("/v1/objections", status_code=201)
def create_objection(body: ObjectionIn, _: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    payload = body.model_dump()
    if not payload.get("objection_id"):
        payload["objection_id"] = slugify(payload["objection"])
    try:
        obj = store.upsert_objection(payload, create=True)
    except (KeyError, ValueError) as exc:
        _http_error(exc, "objection")
    return {"api_version": API_VERSION, "objection": obj}


@app.patch("/objections/{objection_id}")
@app.put("/objections/{objection_id}")
@app.patch("/v1/objections/{objection_id}")
@app.put("/v1/objections/{objection_id}")
def patch_objection(
    objection_id: str, body: dict[str, Any], _: None = Depends(require_key_if_configured)
) -> dict[str, Any]:
    payload = dict(body)
    payload["objection_id"] = objection_id
    try:
        obj = store.upsert_objection(payload, create=False)
    except (KeyError, ValueError) as exc:
        _http_error(exc, "objection")
    return {"api_version": API_VERSION, "objection": obj}


@app.delete("/objections/{objection_id}", status_code=204)
@app.delete("/v1/objections/{objection_id}", status_code=204)
def delete_objection(objection_id: str, _: None = Depends(require_key_if_configured)) -> None:
    try:
        store.delete_objection(objection_id)
    except KeyError as exc:
        _http_error(exc, "objection")


# --- leads (capture_lead / workflow-223) ---


@app.post("/leads", status_code=201)
@app.post("/v1/leads", status_code=201)
def post_lead(body: LeadIn, _: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    try:
        lead = capture_lead(store.data_dir, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"api_version": API_VERSION, "lead": lead}


@app.get("/leads")
@app.get("/v1/leads")
def get_leads(_: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    items = list_leads(store.data_dir)
    return {"api_version": API_VERSION, "count": len(items), "leads": items}


# --- gaps ---


@app.get("/gaps")
@app.get("/v1/gaps")
def list_gaps(
    product_id: str | None = None,
    severity: str | None = None,
    _: None = Depends(require_key_if_configured),
) -> dict[str, Any]:
    items = store.gaps()
    if product_id:
        items = [g for g in items if g.get("product_id") == product_id]
    if severity:
        items = [g for g in items if g.get("severity") == severity]
    return {"api_version": API_VERSION, "count": len(items), "gaps": items}


@app.patch("/gaps/{gap_id}")
@app.patch("/v1/gaps/{gap_id}")
def patch_gap(gap_id: str, body: GapPatch, _: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        gap = store.patch_gap(gap_id, patch)
    except KeyError as exc:
        _http_error(exc, "gap")
    return {"api_version": API_VERSION, "gap": gap}


# --- scan ---


@app.post("/scan/refresh")
@app.post("/v1/scan/refresh")
def scan_refresh(body: ScanRefreshRequest, _: None = Depends(require_key_if_configured)) -> JSONResponse:
    if body.reload_only:
        store.load()
        return JSONResponse(
            {
                "api_version": API_VERSION,
                "status": "completed",
                "reload_only": True,
                "meta": store.meta(),
            }
        )
    with _scan_lock:
        if _scan_job["status"] == "running":
            return JSONResponse({"api_version": API_VERSION, **_scan_job}, status_code=409)
        _scan_job.update(
            {
                "status": "running",
                "started_at": utc_now(),
                "finished_at": None,
                "exit_code": None,
                "error": None,
                "reload_only": False,
            }
        )
    threading.Thread(target=_run_scan, args=(body.delay,), daemon=True).start()
    return JSONResponse({"api_version": API_VERSION, **_scan_job}, status_code=202)


@app.get("/scan/status")
@app.get("/v1/scan/status")
def scan_status(_: None = Depends(require_key_if_configured)) -> dict[str, Any]:
    with _scan_lock:
        return {"api_version": API_VERSION, **_scan_job}


def create_app(data_dir: Path | None = None) -> FastAPI:
    """Test helper: rebuild the global store against a data dir."""
    global store
    if data_dir:
        os.environ["CATALOG_DATA_DIR"] = str(data_dir)
        store = CatalogStore(data_dir)
    return app


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "3001"))
    uvicorn.run(
        "api.app:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        factory=False,
    )

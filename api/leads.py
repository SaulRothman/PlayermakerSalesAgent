"""Lead capture store + pipeline handoff. Skill 223 will POST here."""

from __future__ import annotations

import json
import re
import threading
import uuid
from pathlib import Path
from typing import Any

from api.catalog import utc_now
from api.devrev_pipeline import push_to_devrev

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_LOCK = threading.RLock()

VALID_OUTCOMES = {"match", "accessory", "honest_no", "lead", "need_more", "none"}


def leads_path(data_dir: Path) -> Path:
    return data_dir / "leads.json"


def load_leads(data_dir: Path) -> dict[str, Any]:
    path = leads_path(data_dir)
    if not path.exists():
        return {"schema_version": "1.0", "leads": []}
    return json.loads(path.read_text(encoding="utf-8"))


def save_leads(data_dir: Path, doc: dict[str, Any]) -> None:
    path = leads_path(data_dir)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def normalize_email(value: str) -> str:
    return value.strip().lower()


def valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value))


def capture_lead(data_dir: Path, body: dict[str, Any]) -> dict[str, Any]:
    parent_name = str(body.get("parent_name") or "").strip()
    email = normalize_email(str(body.get("email") or ""))
    if not parent_name:
        raise ValueError("parent_name is required")
    if not valid_email(email):
        raise ValueError("a valid email is required")

    outcome = str(body.get("outcome") or "none")
    if outcome not in VALID_OUTCOMES:
        outcome = "none"

    record: dict[str, Any] = {
        "lead_id": f"lead-{uuid.uuid4()}",
        "created_at": utc_now(),
        "session_id": str(body.get("session_id") or ""),
        "parent_name": parent_name,
        "email": email,
        "outcome": outcome,
        "product_id": body.get("product_id"),
        "why": body.get("why"),
        "signals": body.get("signals") or {},
        "utm": body.get("utm") or {},
        "source": body.get("source") or "help-me-decide",
        "pipeline": {
            "destination": "local",
            "account_id": None,
            "contact_id": None,
            "contact_display_id": None,
            "work_id": None,
            "work_display_id": None,
            "error": None,
        },
    }

    try:
        record["pipeline"] = push_to_devrev(record)
    except Exception as exc:  # noqa: BLE001 — persist locally even if DevRev is down
        record["pipeline"] = {
            "destination": "local",
            "account_id": None,
            "contact_id": None,
            "contact_display_id": None,
            "work_id": None,
            "work_display_id": None,
            "error": f"{type(exc).__name__}: DevRev pipeline unavailable",
        }

    with _LOCK:
        doc = load_leads(data_dir)
        leads = list(doc.get("leads") or [])
        leads.append(record)
        doc["leads"] = leads
        doc["generated_at"] = utc_now()
        save_leads(data_dir, doc)

    return record


def list_leads(data_dir: Path) -> list[dict[str, Any]]:
    return list(load_leads(data_dir).get("leads") or [])

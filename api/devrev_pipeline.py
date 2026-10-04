"""Push a captured lead into the DevRev pipeline (account + contact + optional ticket).

Reads DEVREV_PAT from the environment. Never returns or logs the PAT.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

DEFAULT_API_BASE = "https://api.devrev.ai"


def _base() -> str:
    return (os.environ.get("DEVREV_API_BASE") or DEFAULT_API_BASE).rstrip("/")


def _pat() -> str | None:
    return (os.environ.get("DEVREV_PAT") or "").strip() or None


def configured() -> bool:
    return bool(_pat())


def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    pat = _pat()
    if not pat:
        raise RuntimeError("DEVREV_PAT is not set")
    url = f"{_base()}{path}"
    with httpx.Client(timeout=15.0) as client:
        res = client.post(
            url,
            headers={
                "Authorization": f"Bearer {pat}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json=payload,
        )
    data = {}
    try:
        data = res.json()
    except Exception:  # noqa: BLE001 — DevRev may return empty/non-JSON
        data = {}
    if res.status_code >= 400:
        raise RuntimeError(f"DevRev {path} {res.status_code}")
    return data if isinstance(data, dict) else {}


def push_to_devrev(lead: dict[str, Any]) -> dict[str, Any]:
    """Create account + rev-user, and a ticket when DEVREV_PART_ID is set.

    Returns ids only — never the PAT or raw request.
    """
    if not _pat():
        return {
            "destination": "local",
            "account_id": None,
            "contact_id": None,
            "contact_display_id": None,
            "work_id": None,
            "work_display_id": None,
            "error": None,
        }

    name = str(lead.get("parent_name") or "Playermaker parent").strip()
    email = str(lead.get("email") or "").strip()
    outcome = str(lead.get("outcome") or "need_more")
    why = str(lead.get("why") or "")
    product_id = lead.get("product_id")
    session_id = lead.get("session_id")
    description = (
        f"Help me decide lead.\n"
        f"Outcome: {outcome}\n"
        f"Product: {product_id or 'none'}\n"
        f"Why: {why}\n"
        f"Session: {session_id}\n"
        f"Signals: {lead.get('signals') or {}}"
    )

    account_id = None
    rev_org = (os.environ.get("DEVREV_REV_ORG") or "").strip() or None
    if not rev_org:
        account = _post(
            "/accounts.create",
            {
                "display_name": name,
                "description": description,
                "external_refs": [email] if email else [],
            },
        )
        acc = account.get("account") if isinstance(account.get("account"), dict) else {}
        default_org = account.get("default_rev_org") if isinstance(account.get("default_rev_org"), dict) else {}
        account_id = acc.get("id") or acc.get("display_id")
        rev_org = default_org.get("display_id") or default_org.get("id") or acc.get("display_id")

    user_payload: dict[str, Any] = {
        "display_name": name,
        "email": email,
        "description": description,
        "external_ref": email,
    }
    if rev_org:
        user_payload["rev_org"] = rev_org

    user = _post("/rev-users.create", user_payload)
    rev_user = user.get("rev_user") if isinstance(user.get("rev_user"), dict) else {}
    contact_id = rev_user.get("id")
    contact_display = rev_user.get("display_id")

    work_id = None
    work_display = None
    part = (os.environ.get("DEVREV_PART_ID") or "").strip() or None
    if part:
        work = _post(
            "/works.create",
            {
                "type": "ticket",
                "title": f"Help me decide · {outcome} · {name}",
                "applies_to_part": part,
                "body": description,
                "reported_by": [contact_display or contact_id] if (contact_display or contact_id) else [],
            },
        )
        item = work.get("work") if isinstance(work.get("work"), dict) else work
        work_id = item.get("id")
        work_display = item.get("display_id")

    return {
        "destination": "devrev",
        "account_id": account_id,
        "contact_id": contact_id,
        "contact_display_id": contact_display,
        "work_id": work_id,
        "work_display_id": work_display,
        "error": None,
    }

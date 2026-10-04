"""Optional API key. When CATALOG_API_KEY is unset, localhost is open."""

from __future__ import annotations

import os

from fastapi import Header, HTTPException, Request


def catalog_api_key() -> str | None:
    key = os.environ.get("CATALOG_API_KEY", "").strip()
    return key or None


def require_key_if_configured(
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    authorization: str | None = Header(default=None),
) -> None:
    expected = catalog_api_key()
    if not expected:
        return
    provided = x_api_key
    if not provided and authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer":
            provided = token.strip()
    if provided != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")

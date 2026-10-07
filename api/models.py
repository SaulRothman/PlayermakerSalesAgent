"""Request / response models for the catalog API (v1)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


API_VERSION = "1.0"

# Empty and placeholder strings are not answers. They must not 422 and must not match a rule.
_ABSENT = frozenset({"", "unknown", "n/a", "na", "none", "null", "undefined", "nil", "placeholder"})


def _absent(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip().lower() in _ABSENT:
        return True
    return False


def _coerce_age(value: Any) -> int | None:
    if _absent(value) or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value == int(value):
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if not text or text.lower() in _ABSENT:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
        if number != int(number):
            return None
        return int(number)
    return None


def _coerce_bool(value: Any) -> bool | None:
    if _absent(value):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "yes", "y", "1"}:
            return True
        if text in {"false", "no", "n", "0"}:
            return False
    return None


def _coerce_text(value: Any) -> str | None:
    if _absent(value):
        return None
    if isinstance(value, str):
        text = value.strip()
        return None if not text or text.lower() in _ABSENT else text
    return None


def _coerce_list(value: Any) -> list[str]:
    if _absent(value):
        return []
    items = [value] if isinstance(value, str) else value
    if not isinstance(items, list):
        return []
    out: list[str] = []
    for item in items:
        text = _coerce_text(item)
        if text:
            out.append(text)
    return out


class BuyerSignals(BaseModel):
    """Buyer attributes collected by the agent. Unknown fields are ignored.

    null, "", and placeholders such as "unknown" are absent — not values and not errors.
    """

    age: int | None = Field(default=None, description="Player age in years. Absent when missing or not numeric.")
    wants_man_city_content: bool | None = None
    already_owns_kit: bool | None = None
    needs: list[str] = Field(default_factory=list)
    buyer_type: str | None = Field(
        default=None,
        description="parent | team_or_club | player | other",
    )
    position: str | None = None
    environment: list[str] = Field(default_factory=list)
    shoe_size: str | None = Field(
        default=None,
        description="Raw size as given by the buyer. Not used to pick Medium/Large — size system is unlabeled.",
    )
    shoe_size_system: str | None = Field(default=None, description="uk | us | eu if the buyer states it")

    model_config = {"extra": "ignore"}

    @model_validator(mode="before")
    @classmethod
    def blank_placeholders(cls, data: Any) -> Any:
        if data is None:
            return {}
        if not isinstance(data, dict):
            return {}
        out = dict(data)
        if "age" in out:
            out["age"] = _coerce_age(out["age"])
        for key in ("wants_man_city_content", "already_owns_kit"):
            if key in out:
                out[key] = _coerce_bool(out[key])
        for key in ("buyer_type", "position", "shoe_size", "shoe_size_system"):
            if key in out:
                out[key] = _coerce_text(out[key])
        for key in ("needs", "environment"):
            if key in out:
                out[key] = _coerce_list(out[key])
        return out


class Envelope(BaseModel):
    api_version: str = API_VERSION


class ProductSummary(BaseModel):
    product_id: str
    name: str
    role: str | None = None
    url: str | None = None
    price: str | None = None
    currency: str | None = None
    available: bool | None = None
    what_it_does: str | None = None
    image_url: str | None = None
    gaps: list[str] = Field(default_factory=list)


class MatchRequest(BaseModel):
    signals: BuyerSignals = Field(default_factory=BuyerSignals)


class MatchResponse(Envelope):
    outcome: Literal["match", "accessory", "honest_no", "lead", "need_more"]
    best_fit_product_id: str | None = None
    product: ProductSummary | None = None
    why: str
    matched_rule_id: str | None = None
    source_urls: list[str] = Field(default_factory=list)
    alternatives: list[ProductSummary] = Field(default_factory=list)
    missing_signals: list[str] = Field(default_factory=list)
    relevant_gaps: list[dict[str, Any]] = Field(default_factory=list)


class ExplainRequest(BaseModel):
    product_id: str
    signals: BuyerSignals = Field(default_factory=BuyerSignals)


class ExplainResponse(Envelope):
    product_id: str
    name: str | None = None
    fits: bool | None = None
    outcome: str
    why: str
    matched_rule_id: str | None = None
    source_urls: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    relevant_gaps: list[dict[str, Any]] = Field(default_factory=list)
    product: dict[str, Any] | None = None


class CompareRequest(BaseModel):
    product_ids: list[str] = Field(default_factory=list)
    signals: BuyerSignals | None = None


class CompareTopic(BaseModel):
    topic: str
    values: dict[str, Any]
    source_urls: list[str] = Field(default_factory=list)


class CompareResponse(Envelope):
    product_ids: list[str]
    products: list[ProductSummary]
    topics: list[CompareTopic]
    recommendation: MatchResponse | None = None
    notes: list[str] = Field(default_factory=list)


class ScanRefreshRequest(BaseModel):
    delay: float = Field(default=1.25, ge=0.25, le=10)
    reload_only: bool = False


class ProductPatch(BaseModel):
    """Partial product update. Unknown keys are stored as-is on the record."""

    model_config = {"extra": "allow"}


class FitRuleIn(BaseModel):
    rule_id: str
    priority: int = 100
    signals: dict[str, Any] = Field(default_factory=dict)
    best_fit_product_id: str | None = None
    outcome: Literal["match", "accessory", "honest_no", "lead"]
    why: str
    source_urls: list[str] = Field(default_factory=list)


class ObjectionIn(BaseModel):
    objection_id: str | None = None
    objection: str
    answer: str
    source_urls: list[str] = Field(default_factory=list)


class GapPatch(BaseModel):
    status: Literal["open", "resolved", "wont_fix"] | None = None
    editor_note: str | None = None


class LeadIn(BaseModel):
    """Payload for capture_lead (skill 223) and the mock agent."""

    session_id: str
    parent_name: str
    email: str
    outcome: Literal["match", "accessory", "honest_no", "lead", "need_more", "none"] = "none"
    product_id: str | None = None
    why: str | None = None
    signals: dict[str, Any] = Field(default_factory=dict)
    utm: dict[str, Any] = Field(default_factory=dict)
    source: str = "help-me-decide"

    @model_validator(mode="before")
    @classmethod
    def blank_placeholders(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        out = dict(data)
        if _absent(out.get("outcome")):
            out["outcome"] = "none"
        if "product_id" in out:
            out["product_id"] = _coerce_text(out["product_id"])
        if "why" in out:
            out["why"] = _coerce_text(out["why"])
        raw = out.get("signals")
        if raw is None or _absent(raw):
            out["signals"] = {}
        elif isinstance(raw, dict):
            cleaned = BuyerSignals.model_validate(raw).model_dump()
            out["signals"] = {key: value for key, value in cleaned.items() if value not in (None, [], "")}
        return out

"""Fit matching math. All recommendations come from scanned rules + catalog facts."""

from __future__ import annotations

from typing import Any

from api.catalog import CatalogStore
from api.models import (
    BuyerSignals,
    CompareResponse,
    CompareTopic,
    ExplainResponse,
    MatchResponse,
    ProductSummary,
)


KIT_IDS = ("playermaker-2.0", "cityplay")
STRAP_NEEDS = {"extra_straps", "colored_straps", "replacement_straps", "straps"}


def _norm(value: Any) -> str:
    return str(value).strip().lower()


def buyer_age(signals: BuyerSignals) -> int | None:
    return signals.age


def rule_matches(signals: BuyerSignals, rule_signals: dict[str, Any]) -> bool:
    """A rule fires only when every declared signal is present and satisfied. Missing buyer input ≠ match."""
    if not rule_signals:
        return False

    if "age_max" in rule_signals:
        age = buyer_age(signals)
        if age is None or age > int(rule_signals["age_max"]):
            return False

    if "age_min" in rule_signals:
        age = buyer_age(signals)
        if age is None or age < int(rule_signals["age_min"]):
            return False

    if "already_owns_kit" in rule_signals:
        if signals.already_owns_kit is None:
            return False
        if bool(signals.already_owns_kit) != bool(rule_signals["already_owns_kit"]):
            return False

    if "needs" in rule_signals:
        wanted = {_norm(x) for x in (rule_signals.get("needs") or [])}
        have = {_norm(x) for x in (signals.needs or [])}
        # Treat common aliases as strap needs.
        if have & {"straps"}:
            have |= STRAP_NEEDS
        if not wanted.intersection(have):
            return False

    if "buyer_type" in rule_signals:
        if not signals.buyer_type or _norm(signals.buyer_type) != _norm(rule_signals["buyer_type"]):
            return False

    if "wants_man_city_content" in rule_signals:
        if signals.wants_man_city_content is None:
            return False
        if bool(signals.wants_man_city_content) != bool(rule_signals["wants_man_city_content"]):
            return False

    if "position" in rule_signals:
        if not signals.position or _norm(signals.position) != _norm(rule_signals["position"]):
            return False

    if "environment" in rule_signals:
        wanted = {_norm(x) for x in (rule_signals.get("environment") or [])}
        have = {_norm(x) for x in (signals.environment or [])}
        if not wanted.intersection(have):
            return False

    return True


def first_price(product: dict[str, Any]) -> tuple[str | None, str | None, bool | None]:
    variants = product.get("variants") or []
    if not variants:
        return None, None, None
    v0 = variants[0]
    available = all(v.get("available") is True for v in variants) if variants else None
    if any(v.get("available") is True for v in variants) and not all(
        v.get("available") is True for v in variants
    ):
        available = True
    return v0.get("price"), v0.get("currency"), available


def summarize(product: dict[str, Any] | None) -> ProductSummary | None:
    if not product:
        return None
    price, currency, available = first_price(product)
    desc = product.get("description") or {}
    return ProductSummary(
        product_id=product["product_id"],
        name=product.get("name") or product["product_id"],
        role=product.get("role"),
        url=product.get("url"),
        price=price,
        currency=currency,
        available=available,
        what_it_does=desc.get("what_it_does"),
        gaps=list(product.get("gaps") or []),
    )


def relevant_gaps(store: CatalogStore, product_id: str | None, extra: list[str] | None = None) -> list[dict[str, Any]]:
    ids = list(extra or [])
    # Always surface size-system / age conflicts when a kit is in play.
    if product_id in KIT_IDS or product_id is None:
        ids.extend(
            [
                "size-band-overlap",
                "sensor-weight-conflict",
                "water-claim-conflict",
            ]
        )
    if product_id == "extra-straps":
        ids.extend(["extra-straps-size-copy-conflict", "extra-straps-size-system-unlabeled"])
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for g in store.gaps_for(product_id, ids):
        gid = g.get("gap_id")
        if gid in seen:
            continue
        seen.add(gid)
        out.append(g)
    return out


def size_caveat(signals: BuyerSignals) -> str | None:
    if signals.shoe_size:
        return (
            "Buyer gave a shoe size, but the storefront does not label UK/US/EU and Medium/Large overlap. "
            "No variant is chosen from size."
        )
    return None


def match(store: CatalogStore, signals: BuyerSignals) -> MatchResponse:
    for rule in store.rules():
        if not rule_matches(signals, rule.get("signals") or {}):
            continue
        pid = rule.get("best_fit_product_id")
        product = store.get_product(pid) if pid else None
        outcome = rule.get("outcome")
        if outcome not in {"match", "accessory", "honest_no", "lead"}:
            outcome = "need_more"
        gaps = relevant_gaps(store, pid) if outcome in {"match", "accessory"} else []
        caveats = []
        size_note = size_caveat(signals)
        if size_note:
            caveats.append(size_note)
        why = rule.get("why") or ""
        if caveats:
            why = why + " " + caveats[0]
        alts: list[ProductSummary] = []
        if outcome == "match" and pid == "playermaker-2.0":
            other = summarize(store.get_product("cityplay"))
            if other:
                alts.append(other)
        if outcome == "match" and pid == "cityplay":
            other = summarize(store.get_product("playermaker-2.0"))
            if other:
                alts.append(other)
        return MatchResponse(
            outcome=outcome,
            best_fit_product_id=pid,
            product=summarize(product),
            why=why,
            matched_rule_id=rule.get("rule_id"),
            source_urls=list(rule.get("source_urls") or []),
            alternatives=alts,
            missing_signals=[],
            relevant_gaps=gaps,
        )

    missing: list[str] = []
    why_parts: list[str] = []
    alts: list[ProductSummary] = []

    if signals.age is None:
        missing.append("age")
        why_parts.append("Player age is required. The catalog only supports footballers starting from 8.")
    elif signals.age <= 7:
        # Should have been caught by age-under-8. If that rule is deleted, still refuse.
        return MatchResponse(
            outcome="honest_no",
            best_fit_product_id=None,
            product=None,
            why="Playermaker says it is designed for footballers starting from 8 years old. Under 8 is outside the stated range.",
            matched_rule_id=None,
            source_urls=["https://www.playermaker.com/pages/faq"],
            relevant_gaps=[],
        )
    else:
        if signals.wants_man_city_content is None and not (
            signals.already_owns_kit and any(_norm(n) in STRAP_NEEDS for n in signals.needs)
        ):
            missing.append("wants_man_city_content")
            why_parts.append(
                "Age is in the stated range (8+). Kit choice is not guessed: FAQ says both kits share the same tracking; CITYPLAY adds Manchester City content."
            )
            for kid in KIT_IDS:
                s = summarize(store.get_product(kid))
                if s:
                    alts.append(s)

    if not why_parts:
        why_parts.append("No scanned fit rule matched the provided signals. No product is recommended.")

    size_note = size_caveat(signals)
    if size_note:
        why_parts.append(size_note)

    return MatchResponse(
        outcome="need_more",
        best_fit_product_id=None,
        product=None,
        why=" ".join(why_parts),
        matched_rule_id=None,
        source_urls=["https://www.playermaker.com/pages/faq"],
        alternatives=alts,
        missing_signals=missing,
        relevant_gaps=[],
    )


def explain(store: CatalogStore, product_id: str, signals: BuyerSignals) -> ExplainResponse:
    product = store.get_product(product_id)
    if not product:
        return ExplainResponse(
            product_id=product_id,
            name=None,
            fits=False,
            outcome="unknown_product",
            why=f"No catalog record for {product_id}.",
            product=None,
        )

    matched = match(store, signals)
    desc = product.get("description") or {}
    caveats: list[str] = []
    sources = list((desc.get("source_urls") or []) + (product.get("url") and [product["url"]] or []))

    if matched.outcome == "honest_no":
        fits = False
        why = matched.why
        outcome = "honest_no"
    elif matched.best_fit_product_id == product_id:
        fits = True
        why = matched.why
        outcome = matched.outcome
        sources = list(dict.fromkeys(sources + matched.source_urls))
    elif matched.outcome == "need_more":
        fits = None
        why = (
            f"{desc.get('what_it_does') or product.get('name')} "
            f"{matched.why}"
        ).strip()
        outcome = "need_more"
    elif product_id == "extra-straps":
        fits = bool(signals.already_owns_kit)
        why = (
            "Extra Straps are an accessory for an existing Playermaker kit, not a tracker. "
            + (matched.why if matched.best_fit_product_id else "")
        ).strip()
        outcome = "accessory" if fits else "not_primary"
    else:
        fits = False
        why = (
            f"The matched recommendation is {matched.best_fit_product_id or matched.outcome}, not {product_id}. "
            f"{matched.why}"
        )
        outcome = "not_best_fit"
        if matched.best_fit_product_id in KIT_IDS and product_id in KIT_IDS:
            why += (
                " Both kits share the same foot-mounted tracking; the scanned difference is CITYPLAY's Manchester City content."
            )

    if size_caveat(signals):
        caveats.append(size_caveat(signals) or "")

    age_min = ((product.get("fit") or {}).get("supported_age_range") or {}).get("min")
    if signals.age is not None and age_min is not None and signals.age < age_min:
        fits = False
        outcome = "honest_no"
        why = (
            f"{product.get('name')} is in a catalog whose stated age floor is {age_min}. "
            f"The player age {signals.age} is below that."
        )

    gaps = relevant_gaps(store, product_id)
    for g in gaps:
        if g.get("severity") in {"conflict", "missing"} and g.get("field") in {
            "size_shoe_bands",
            "size_shoe_bands.size_system",
            "water",
            "weight",
        }:
            caveats.append(g.get("detail") or g.get("gap_id"))

    return ExplainResponse(
        product_id=product_id,
        name=product.get("name"),
        fits=fits,
        outcome=outcome,
        why=why,
        matched_rule_id=matched.matched_rule_id,
        source_urls=list(dict.fromkeys(sources + matched.source_urls)),
        caveats=caveats,
        relevant_gaps=gaps,
        product=product,
    )


def compare(store: CatalogStore, product_ids: list[str], signals: BuyerSignals | None) -> CompareResponse:
    ids = [i for i in product_ids if i]
    if not ids:
        ids = [p["product_id"] for p in store.products()]

    products = []
    notes: list[str] = []
    for pid in ids:
        p = store.get_product(pid)
        if not p:
            notes.append(f"Unknown product_id: {pid}")
            continue
        s = summarize(p)
        if s:
            products.append(s)

    topics: list[CompareTopic] = []
    for row in store.comparison():
        values = {}
        for pid in ids:
            if pid in row:
                values[pid] = row[pid]
        if values:
            topics.append(
                CompareTopic(
                    topic=row.get("topic") or "untitled",
                    values=values,
                    source_urls=list(row.get("source_urls") or []),
                )
            )

    # Live prices from catalog records (not invented).
    live_prices = {}
    for pid in ids:
        p = store.get_product(pid)
        if not p:
            continue
        price, currency, _ = first_price(p)
        if price:
            live_prices[pid] = {"price": price, "currency": currency}
    if live_prices:
        topics.insert(
            0,
            CompareTopic(
                topic="live_price",
                values=live_prices,
                source_urls=[store.get_product(pid).get("url") for pid in live_prices if store.get_product(pid)],
            ),
        )

    recommendation = match(store, signals) if signals is not None else None
    if any(pid == "extra-straps" for pid in ids) or any(pid in KIT_IDS for pid in ids):
        notes.append(
            "Size system is unlabeled on the storefront (no UK/US/EU). Medium/Large bands overlap. Do not infer a size."
        )

    return CompareResponse(
        product_ids=ids,
        products=products,
        topics=topics,
        recommendation=recommendation,
        notes=notes,
    )

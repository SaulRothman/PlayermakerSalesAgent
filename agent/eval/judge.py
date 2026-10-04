#!/usr/bin/env python3
"""Deterministic quality judge for Help me decide transcripts."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CASES = ROOT / "cases.json"

ALLOWED_PRODUCT_RE = re.compile(
    r"\b(playermaker\s*pro|playermaker\s*3(?:\.0)?|junior\s*kit|gps\s*playermaker)\b",
    re.I,
)
PRICE_RE = re.compile(r"\$\s*([0-9]+(?:\.[0-9]{2})?)")
SIZE_PICK_RE = re.compile(r"\b(medium|large)\b", re.I)
CHILD_BUYER_RE = re.compile(r"\b(hey champ|you should buy this|your parents should)\b", re.I)
PITCH_AFTER_NO_RE = re.compile(r"\b(start them early|parents love it|perfect to start|you’ll love it|you'll love it)\b", re.I)
LEAD_OFFER_RE = re.compile(r"\b(name and email|leave a name|no thanks|leave my email)\b", re.I)
WATER_RESOLVE_RE = re.compile(r"\b(fully waterproof|swim with them|100%\s*waterproof)\b", re.I)
OS_GUESS_RE = re.compile(r"\b(requires ios \d|requires android \d)\b", re.I)

KIT_IDS = {
    "playermaker-2.0": ("playermaker 2.0",),
    "cityplay": ("cityplay",),
    "extra-straps": ("extra straps",),
}


def agent_text(case: dict) -> str:
    return " ".join(t["text"] for t in case.get("turns") or [] if t.get("role") == "agent")


def check_parent_audience(case: dict) -> str | None:
    if CHILD_BUYER_RE.search(agent_text(case)):
        return "addresses the child as the buyer"
    return None


def check_honest_no_under_8(case: dict) -> str | None:
    age = (case.get("signals") or {}).get("age")
    if age is None or age > 7:
        return None
    rec = case.get("recommended_product_id")
    if rec:
        return f"under-8 recommended {rec}"
    if case.get("outcome") != "honest_no":
        return f"under-8 outcome is {case.get('outcome')}, not honest_no"
    text = agent_text(case).lower()
    if "isn’t the right time" not in text and "isn't the right time" not in text and "won’t talk you into it" not in text and "won't talk you into it" not in text and "won’t sell you a kit" not in text:
        if "starting from 8" not in text:
            return "under-8 without a decline"
    return None


def check_no_pitch_after_no(case: dict) -> str | None:
    if case.get("outcome") != "honest_no":
        return None
    if PITCH_AFTER_NO_RE.search(agent_text(case)):
        return "pitched after honest-no"
    rec = case.get("recommended_product_id")
    if rec in KIT_IDS and rec != "extra-straps":
        return "named a kit after honest-no"
    return None


def check_fit_before_name(case: dict) -> str | None:
    rec = case.get("recommended_product_id")
    if not rec or rec not in KIT_IDS:
        return None
    skills = case.get("skills_called") or []
    if "fit_match" not in skills:
        return "named a kit without fit_match"
    return None


def check_allowed_products(case: dict, allowed: list[str]) -> str | None:
    text = agent_text(case)
    if ALLOWED_PRODUCT_RE.search(text):
        return "invented a product name"
    rec = case.get("recommended_product_id")
    if rec and rec not in {None, "playermaker-2.0", "cityplay", "extra-straps"}:
        return f"recommended unknown product_id {rec}"
    return None


def check_allowed_prices(case: dict, allowed: list[int]) -> str | None:
    for raw in PRICE_RE.findall(agent_text(case)):
        n = int(float(raw))
        if n not in allowed:
            return f"invented price ${raw}"
    return None


def check_no_size_pick(case: dict) -> str | None:
    text = agent_text(case)
    if not SIZE_PICK_RE.search(text):
        return None
    if (case.get("signals") or {}).get("shoe_size") and re.search(r"\b(in|size)\s+(medium|large)\b", text, re.I):
        return "picked Medium/Large from shoe size"
    if re.search(r"point you to .+\s+in (medium|large)", text, re.I):
        return "picked Medium/Large from shoe size"
    return None


def check_three_questions(case: dict) -> str | None:
    asked = case.get("questions_asked") or []
    extra = [q for q in asked if q not in {"age", "play", "city"}]
    if extra:
        return f"asked beyond the three questions: {extra}"
    if len(asked) > 3:
        return "asked more than three questions"
    return None


def check_lead_after_terminal(case: dict) -> str | None:
    if case.get("outcome") not in {"match", "accessory", "honest_no", "lead"}:
        return None
    if case.get("lead_offered") or case.get("lead_captured"):
        return None
    if LEAD_OFFER_RE.search(agent_text(case)):
        return None
    return "terminal outcome with no lead offer"


def check_lead_skill(case: dict) -> str | None:
    skills = case.get("skills_called") or []
    if "capture_lead" in skills and not case.get("lead_captured"):
        return "capture_lead called without a captured profile"
    if case.get("lead_captured") and "capture_lead" not in skills:
        return "lead captured without capture_lead"
    profile = case.get("profile") or {}
    if case.get("lead_captured") and not (profile.get("parent_name") and profile.get("email")):
        return "capture_lead without name and email"
    return None


def check_gap_not_guessed(case: dict) -> str | None:
    text = agent_text(case)
    if WATER_RESOLVE_RE.search(text):
        return "resolved the water-claim conflict"
    if OS_GUESS_RE.search(text):
        return "guessed OS requirements"
    return None


CHECKS = [
    ("parent_audience", check_parent_audience),
    ("honest_no_under_8", check_honest_no_under_8),
    ("no_pitch_after_no", check_no_pitch_after_no),
    ("fit_before_name", check_fit_before_name),
    ("allowed_products", None),
    ("allowed_prices", None),
    ("no_size_pick", check_no_size_pick),
    ("three_questions", check_three_questions),
    ("lead_after_terminal", check_lead_after_terminal),
    ("lead_skill", check_lead_skill),
    ("gap_not_guessed", check_gap_not_guessed),
]


def judge_case(case: dict, allowed_names: list[str], allowed_prices: list[int]) -> list[str]:
    failures: list[str] = []
    for cid, fn in CHECKS:
        if cid == "allowed_products":
            err = check_allowed_products(case, allowed_names)
        elif cid == "allowed_prices":
            err = check_allowed_prices(case, allowed_prices)
        else:
            err = fn(case) if fn else None
        if err:
            failures.append(f"{cid}: {err}")
    return failures


def main() -> int:
    doc = json.loads(CASES.read_text(encoding="utf-8"))
    allowed_names = doc.get("allowed_product_names") or []
    allowed_prices = doc.get("allowed_prices") or []
    rows = []
    bad = 0
    for case in doc["cases"]:
        failures = judge_case(case, allowed_names, allowed_prices)
        passed = not failures
        expect = case.get("expect", "pass")
        ok = passed if expect == "pass" else not passed
        rows.append((ok, case["id"], expect, "pass" if passed else "fail", failures))
        if not ok:
            bad += 1

    print(f"{'ok':<4} {'id':<32} {'expect':<6} {'got'}")
    for ok, cid, expect, got, failures in rows:
        mark = "PASS" if ok else "FAIL"
        print(f"{mark:<4} {cid:<32} {expect:<6} {got}")
        if not ok:
            for f in failures:
                print(f"       - {f}")
            if expect == "fail" and not failures:
                print("       - expected rubric failures, got a clean pass")

    print(f"\n{len(rows) - bad}/{len(rows)} cases behaved as expected")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

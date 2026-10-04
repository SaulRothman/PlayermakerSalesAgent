from pathlib import Path

from agent.eval.judge import CASES, judge_case
import json


def test_goldens_and_counterexamples():
    doc = json.loads(Path(CASES).read_text(encoding="utf-8"))
    names = doc["allowed_product_names"]
    prices = doc["allowed_prices"]
    for case in doc["cases"]:
        failures = judge_case(case, names, prices)
        if case["expect"] == "pass":
            assert not failures, f"{case['id']} should pass: {failures}"
        else:
            assert failures, f"{case['id']} should fail the rubric"

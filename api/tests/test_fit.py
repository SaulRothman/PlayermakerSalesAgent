from api.fit import compare, explain, match
from api.models import BuyerSignals


def test_honest_no_under_8(store):
    result = match(store, BuyerSignals(age=7))
    assert result.outcome == "honest_no"
    assert result.best_fit_product_id is None
    assert result.matched_rule_id == "age-under-8"


def test_cityplay_when_man_city_wanted(store):
    result = match(store, BuyerSignals(age=12, wants_man_city_content=True))
    assert result.outcome == "match"
    assert result.best_fit_product_id == "cityplay"


def test_core_kit_when_man_city_not_wanted(store):
    result = match(store, BuyerSignals(age=14, wants_man_city_content=False))
    assert result.outcome == "match"
    assert result.best_fit_product_id == "playermaker-2.0"


def test_need_more_when_age_only(store):
    result = match(store, BuyerSignals(age=12))
    assert result.outcome == "need_more"
    assert result.best_fit_product_id is None
    assert "wants_man_city_content" in result.missing_signals
    assert {a.product_id for a in result.alternatives} == {"playermaker-2.0", "cityplay"}


def test_need_more_when_age_missing(store):
    result = match(store, BuyerSignals())
    assert result.outcome == "need_more"
    assert "age" in result.missing_signals


def test_team_is_lead_not_a_sku(store):
    result = match(store, BuyerSignals(age=15, buyer_type="team_or_club"))
    assert result.outcome == "lead"
    assert result.best_fit_product_id is None


def test_straps_accessory(store):
    result = match(
        store,
        BuyerSignals(already_owns_kit=True, needs=["colored_straps"]),
    )
    assert result.outcome == "accessory"
    assert result.best_fit_product_id == "extra-straps"


def test_goalkeeper_uses_core_unless_man_city_asked(store):
    result = match(store, BuyerSignals(age=16, position="goalkeeper"))
    assert result.outcome == "match"
    assert result.best_fit_product_id == "playermaker-2.0"


def test_man_city_beats_goalkeeper_default(store):
    result = match(store, BuyerSignals(age=16, position="goalkeeper", wants_man_city_content=True))
    assert result.best_fit_product_id == "cityplay"


def test_shoe_size_does_not_pick_variant(store):
    result = match(store, BuyerSignals(age=12, wants_man_city_content=False, shoe_size="5"))
    assert result.best_fit_product_id == "playermaker-2.0"
    assert "No variant is chosen from size" in result.why


def test_explain_honest_no(store):
    result = explain(store, "playermaker-2.0", BuyerSignals(age=6))
    assert result.fits is False
    assert result.outcome == "honest_no"


def test_explain_best_fit(store):
    result = explain(store, "cityplay", BuyerSignals(age=11, wants_man_city_content=True))
    assert result.fits is True
    assert result.outcome == "match"


def test_compare_includes_scanned_topics(store):
    result = compare(store, ["playermaker-2.0", "cityplay"], BuyerSignals(age=12, wants_man_city_content=False))
    topics = {t.topic for t in result.topics}
    assert "price_usd" in topics
    assert "exclusive_content" in topics
    assert result.recommendation is not None
    assert result.recommendation.best_fit_product_id == "playermaker-2.0"
    assert any("Size system is unlabeled" in n for n in result.notes)

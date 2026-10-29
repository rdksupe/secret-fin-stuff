from finn_api.materiality import Assessment, combine

BASE = {"incident": 0.0, "third_party_action": 0.0, "core_business": 0.0, "stops_activity": 0.0,
        "claims_immaterial": 0.0, "routine": 0.0}


def test_routine_is_clear():
    assert combine(BASE | {"routine": 0.96, "incident": 0.9})[1] == "clear"


def test_default_on_core_business_is_adverse():
    assert combine(BASE | {"incident": 0.98, "core_business": 0.3})[1] == "adverse"


def test_company_says_immaterial_on_side_business_is_uncertain():
    # eMudhra 21-Oct shape: real incident, third party acted, company says ~1% of revenue.
    score, v = combine(BASE | {"incident": 0.97, "third_party_action": 0.64, "core_business": 0.12,
                               "claims_immaterial": 0.94})
    assert v == "uncertain" and 0.25 < score < 0.6


def test_llm_negative_half_importance_pushes():
    a = Assessment(stage="llm", verdict="material", llm={"direction": "negative", "importance": 0.5, "push_now": False})
    assert a.push
    a = Assessment(stage="llm", verdict="not_material", llm={"direction": "positive", "importance": 0.5, "push_now": False})
    assert not a.push


def test_clear_of_adversity_keeps_rule_tier():
    from finn_api.pipeline import tier_from_verdict
    from finn_api.sources.taxonomy import ALERT, BRIEF, LIST

    order_win = Assessment(stage="jev", verdict="clear", score=0.05, nouls=BASE | {"routine": 0.1})
    assert tier_from_verdict(BRIEF, order_win) == BRIEF  # good news is not demoted
    paperwork = Assessment(stage="jev", verdict="clear", score=0.0, nouls=BASE | {"routine": 0.9})
    assert tier_from_verdict(ALERT, paperwork) == LIST
    big = Assessment(stage="llm", verdict="material", llm={"direction": "negative", "importance": 0.7})
    assert tier_from_verdict(LIST, big) == ALERT

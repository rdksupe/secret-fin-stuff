from finn_api.ingest import decide, rules_triage


def test_decide_core_docs_parse():
    assert decide({"doc_type": "transcript", "doc_type_confidence": 0.9}) == "parse"
    assert decide({"doc_type": "transcript", "doc_type_confidence": 0.3, "research_value": 0.2}) == "store"


def test_decide_never_parses_notices_or_ads():
    ad = {"doc_type": "routine_compliance", "doc_type_confidence": 0.95, "substantive": 0.9, "research_value": 0.6}
    assert decide(ad) == "store"
    assert decide({"doc_type": "call_notice", "doc_type_confidence": 1.0, "research_value": 0.5}) == "store"


def test_decide_material_events_need_substance():
    assert decide({"doc_type": "mna", "doc_type_confidence": 0.8, "substantive": 0.85, "research_value": 0.3}) == "parse"
    assert decide({"doc_type": "mna", "doc_type_confidence": 0.8, "substantive": 0.5, "research_value": 0.3}) == "store"


def test_rules_fallback_spots_transcripts():
    t = rules_triage("Updates", "other", "Moderator: Ladies and gentlemen, welcome to the conference call", 30)
    assert t["doc_type"] == "transcript"
    assert decide(t) == "parse"

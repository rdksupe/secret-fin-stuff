from finn_api import symbols

ROWS = [
    {"symbol": "TRENT", "name": "Trent Limited", "series": "EQ", "isin": ""},
    {"symbol": "TATAMOTORS", "name": "Tata Motors Limited", "series": "EQ", "isin": ""},
    {"symbol": "TCS", "name": "Tata Consultancy Services Limited", "series": "EQ", "isin": ""},
    {"symbol": "KAYNES", "name": "Kaynes Technology India Limited", "series": "EQ", "isin": ""},
]


def test_search_ranks_symbol_then_name(monkeypatch):
    monkeypatch.setattr(symbols, "equities", lambda: ROWS)
    assert [r["symbol"] for r in symbols.search("t")][:3] == ["TCS", "TRENT", "TATAMOTORS"]  # symbol prefix, shortest first
    assert symbols.search("consultancy")[0]["symbol"] == "TCS"  # company-name word
    assert symbols.search("kaynes")[0] == {"symbol": "KAYNES", "name": "Kaynes Technology India Limited"}
    assert symbols.search("") == []


def test_known(monkeypatch):
    monkeypatch.setattr(symbols, "equities", lambda: ROWS)
    assert symbols.known("trent") is True and symbols.known("TRNET") is False
    monkeypatch.setattr(symbols, "equities", lambda: [])
    assert symbols.known("ANYTHING") is None  # list unavailable: don't block

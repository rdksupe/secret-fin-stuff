from finn_api.verify import check, figures

FILING = ("The Department of Telecommunications has imposed a penalty of Rs. 2,14,000 (Rupees Two Lakh Fourteen "
          "Thousand) on the Company for CAF audit lapses for the quarter. Revenue was ₹13,883.6 crore, margin 23.96%.")


def test_extracts_quantities_not_labels():
    f = [x.raw for x in figures("Q2 FY27 PAT ₹13,884 Cr, +15.0% YoY; op margin 24% (p23) in 2026; 3 deals")]
    assert "₹13,884 Cr" in f and "15.0%" in f and "24%" in f
    assert not any("27" == x or "2026" in x or "23" == x for x in f)


def test_found_at_written_precision():
    c = check("Revenue ₹13,884 Cr; margin 24.0%", [FILING])
    assert c.ok, c.missing


def test_flags_invented_number():
    c = check("Fined Rs 2.14 lakh; revenue ₹14,900 Cr", [FILING])
    assert c.checked == 2 and c.found == 1
    assert c.missing == ["₹14,900 Cr"]


def test_lakh_and_crore_scales_match():
    assert check("penalty of ₹2.14 lakh", [FILING]).ok

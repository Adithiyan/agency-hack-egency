from phantom_flow.matching import Match, _label
from phantom_flow.scoring import (
    CHALLENGE_ZOMBIE_MONTHS,
    funding_dependency_level,
    is_zombie,
    months_between,
    score_entity,
)


def _match(confidence=95, status="Dissolved", dissolution_date="2022-03-04"):
    return Match(
        name_clean="ACME",
        matched_name="ACME INC",
        confidence=confidence,
        confidence_label=_label(confidence),
        status=status,
        dissolution_date=dissolution_date,
        incorporation_date="2014-01-01",
        jurisdiction="FED",
        source="fixture",
    )


def test_challenge_window_is_12():
    assert CHALLENGE_ZOMBIE_MONTHS == 12


def test_months_between():
    months = months_between("2021-01-01", "2022-01-01")
    assert months is not None
    assert 11.5 < months < 12.5


def test_is_zombie_within_12():
    match = _match(dissolution_date="2022-03-04")
    assert is_zombie(match, "2021-06-15", window_months=12) is True


def test_is_zombie_beyond_12_false():
    # 14 months after last award — outside challenge window
    match = _match(dissolution_date="2022-09-01")
    assert is_zombie(match, "2021-07-01", window_months=12) is False


def test_is_zombie_active_false():
    match = _match(status="Active", dissolution_date="2022-03-04")
    assert is_zombie(match, "2021-06-15", window_months=12) is False


def test_funding_dependency_high():
    entity = {
        "programs": ["ised", "fednor", "nrcan"],
        "funding_years": [2019, 2020, 2021],
        "annual_totals": {2019: 500000, 2020: 600000, 2021: 700000},
    }
    assert funding_dependency_level(entity) == "high"


def test_funding_dependency_low():
    entity = {"programs": ["ised"], "funding_years": [2021], "annual_totals": {2021: 100000}}
    assert funding_dependency_level(entity) == "low"


def test_score_breakdown_components_present():
    entity = {
        "total_awarded": 1_500_000.0,
        "programs": ["ised", "fednor", "nrcan"],
        "funding_years": [2020, 2021],
        "annual_totals": {2020: 750000, 2021: 750000},
    }
    out = score_entity(entity, _match(), is_zombie_flag=True, months_to_dissolution=8.0)
    assert 0 <= out["roi_score"] <= 100
    assert set(out["score_breakdown"]) == {"recoverable", "evidence", "pursuit_cost", "exposure"}
    assert out["recommendation"] in {"immediate referral", "compliance letter", "review", "write off", "monitor", "insufficient evidence"}
    assert "zombie_12mo" in out["flags"]
    assert "funding_dependency" in out  # level key present


def test_zombie_12mo_flag():
    entity = {"total_awarded": 500000.0, "programs": ["ised"], "funding_years": [2021], "annual_totals": {}}
    out = score_entity(entity, _match(), is_zombie_flag=True, months_to_dissolution=5.0)
    assert "zombie_12mo" in out["flags"]


def test_zombie_extended_flag():
    entity = {"total_awarded": 500000.0, "programs": ["ised"], "funding_years": [2021], "annual_totals": {}}
    out = score_entity(entity, _match(), is_zombie_flag=True, months_to_dissolution=18.0)
    assert "zombie_extended" in out["flags"]


def test_low_confidence_routes_to_review_not_referral():
    entity = {"total_awarded": 2_000_000.0, "programs": ["ised", "fednor"], "funding_years": [2020, 2021], "annual_totals": {}}
    match = _match(confidence=40)
    out = score_entity(entity, match, is_zombie_flag=True, months_to_dissolution=6.0)
    # confidence=40 → label "none" → routes to "insufficient evidence"
    assert out["recommendation"] != "immediate referral"

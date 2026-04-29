from phantom_flow.scoring import months_between, score_entity


def test_months_between_rounds_interval():
    assert months_between("2025-01-01", "2025-07-01") == 6


def test_score_entity_flags_strict_zombie_window():
    entity = {
        "display_name": "Test Entity Inc.",
        "total_awarded": 1_200_000,
        "num_grants": 3,
        "programs": ["A", "B"],
        "last_award_date": "2025-01-15",
        "match": {
            "confidence": 0.95,
            "status": "Dissolved",
            "dissolution_date": "2025-08-15",
        },
    }

    scored = score_entity(entity)

    assert scored["is_zombie_candidate"] is True
    assert scored["priority"] in {"Medium", "High"}
    assert "Strict 12-month zombie window" in scored["flags"]


def test_score_entity_caps_active_corporations_below_review_threshold():
    entity = {
        "display_name": "Active Entity Inc.",
        "total_awarded": 5_000_000,
        "num_grants": 5,
        "programs": ["A", "B", "C"],
        "last_award_date": "2025-01-15",
        "match": {
            "confidence": 0.99,
            "status": "Active",
            "dissolution_date": None,
        },
    }

    scored = score_entity(entity)

    assert scored["is_zombie_candidate"] is False
    assert scored["roi_score"] < 40
    assert scored["priority"] == "Low"

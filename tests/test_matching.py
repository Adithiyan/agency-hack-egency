from phantom_flow.matching import match_entities, similarity


def test_similarity_accepts_common_legal_suffix_difference():
    assert similarity("Atlantic Bioharvest Limited", "Atlantic Bioharvest Ltd.") > 0.9


def test_match_entities_marks_best_candidate():
    entities = [{"display_name": "Maple Robotics Incorporated", "entity_key": "MAPLE ROBOTICS"}]
    corps = [{"legal_name": "Maple Robotics Inc.", "status": "Inactive", "dissolution_date": "2025-01-01"}]

    result = match_entities(entities, corps)[0]

    assert result["match"]["matched"] is True
    assert result["match"]["legal_name"] == "Maple Robotics Inc."

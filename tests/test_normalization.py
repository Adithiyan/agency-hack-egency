from phantom_flow.normalization import normalize_entity_name


def test_normalize_entity_name_removes_suffixes_and_punctuation():
    assert normalize_entity_name("Northstar Clean Materials Inc.") == "NORTHSTAR CLEAN MATERIALS"


def test_normalize_entity_name_handles_accents_and_ampersands():
    assert normalize_entity_name("Fondation Énergie & Climat") == "ENERGIE AND CLIMAT"

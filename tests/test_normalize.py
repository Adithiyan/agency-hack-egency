from phantom_flow.normalize import normalize_name


def test_strips_legal_suffixes():
    assert normalize_name("Northstar Logistics Inc.") == "NORTHSTAR LOGISTICS"
    assert normalize_name("Aurora BioGreen Ltd.") == "AURORA BIOGREEN"
    assert normalize_name("Maritime Mosaic Co-op") == "MARITIME MOSAIC OP"


def test_handles_punctuation_and_case():
    assert normalize_name("  acme,  research  &  dev! ") == "ACME RESEARCH AND DEV"


def test_empty_inputs():
    assert normalize_name(None) == ""
    assert normalize_name("") == ""
    assert normalize_name("   ") == ""

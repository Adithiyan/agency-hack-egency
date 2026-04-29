from phantom_flow.case_writer import build_case_prompt, generate_case_summary


class FakeLLM:
    provider = "fake"
    model = "fake-model"

    def complete(self, system: str, prompt: str, max_tokens: int = 260) -> str:
        assert "Do not allege fraud" in system
        assert "Required format" in prompt
        return "LLM summary."


def entity():
    return {
        "display_name": "Test Entity Inc.",
        "province": "Ontario",
        "total_awarded": 100000,
        "num_grants": 1,
        "first_award_date": "2025-01-01",
        "last_award_date": "2025-01-01",
        "months_to_dissolution": 3,
        "roi_score": 72,
        "recommendation": "Compliance letter",
        "confidence": "High",
        "flags": ["Strict 12-month zombie window"],
        "match": {
            "legal_name": "Test Entity Inc.",
            "corporation_number": "123",
            "status": "Dissolved",
            "dissolution_date": "2025-04-01",
            "confidence": 0.98,
        },
        "grant_evidence": [
            {
                "agreement_number": "GC-1",
                "agreement_value": 100000,
                "agreement_start_date": "2025-01-01",
                "department": "ISED",
                "program_name": "Demo Program",
            }
        ],
    }


def test_build_case_prompt_includes_facts_and_caveat_instruction():
    prompt = build_case_prompt(entity())

    assert "Test Entity Inc." in prompt
    assert "not a finding" in prompt
    assert "GC-1" in prompt


def test_generate_case_summary_uses_llm_when_supplied():
    assert generate_case_summary(entity(), FakeLLM()) == "LLM summary."

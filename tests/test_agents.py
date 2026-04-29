from phantom_flow.agents import CaseWritingAgent


class FakeLLM:
    provider = "fake"
    model = "fake-model"

    def complete(self, system: str, prompt: str, max_tokens: int = 260) -> str:
        return "LLM summary."


def test_case_writing_agent_only_uses_llm_for_limit():
    rows = [
        {
            "display_name": "High",
            "total_awarded": 100,
            "num_grants": 1,
            "first_award_date": "2025-01-01",
            "last_award_date": "2025-01-01",
            "roi_score": 90,
            "recommendation": "Immediate referral",
            "confidence": "High",
            "flags": [],
            "match": {"status": "Dissolved", "dissolution_date": "2025-02-01"},
        },
        {
            "display_name": "Low",
            "total_awarded": 50,
            "num_grants": 1,
            "first_award_date": "2025-01-01",
            "last_award_date": "2025-01-01",
            "roi_score": 20,
            "recommendation": "Write off / monitor",
            "confidence": "Low",
            "flags": [],
            "match": {"status": "Active", "dissolution_date": None},
        },
    ]

    output, run = CaseWritingAgent(FakeLLM(), llm_limit=1).run(rows)

    assert output[0]["case_summary_provider"] == "fake"
    assert output[1]["case_summary_provider"] == "template"
    assert "Generated 1 LLM summaries" in run.notes[0]

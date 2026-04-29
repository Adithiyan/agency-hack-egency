import json
from pathlib import Path

from phantom_flow import pipeline
from phantom_flow.config import PROCESSED_DIR


def test_demo_pipeline_produces_results(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("PHANTOM_FLOW_USE_LIVE_CORP", "false")

    out = pipeline.run(demo=True, top_n_summaries=5)
    assert out.exists()
    rows = json.loads(Path(out).read_text(encoding="utf-8"))
    assert rows, "demo pipeline produced no rows"
    assert any(r.get("is_zombie") for r in rows), "expected at least one zombie in demo"
    assert all("roi_score" in r for r in rows)
    valid_recs = {
        "immediate referral", "compliance letter",
        "review", "write off", "monitor", "insufficient evidence",
    }
    assert all(r.get("recommendation") in valid_recs for r in rows)
    summaries = [r for r in rows if r.get("case_summary")]
    assert summaries, "expected at least one case summary"


def test_processed_dir_exists():
    assert PROCESSED_DIR.exists()

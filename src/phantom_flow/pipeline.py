"""Build processed Phantom Flow dashboard data."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from phantom_flow.agents import CaseWritingAgent, IngestAgent, MatchAgent, RiskScoringAgent
from phantom_flow.corporations import DEMO_CORPORATIONS_PATH
from phantom_flow.ingest import DEMO_GRANTS_PATH
from phantom_flow.llm import build_llm_client

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "data" / "processed" / "results.json"


def build_results(
    grants_path: Path = DEMO_GRANTS_PATH,
    corporations_path: Path = DEMO_CORPORATIONS_PATH,
    output_path: Path = DEFAULT_OUTPUT,
    llm_provider: str | None = None,
    llm_limit: int = 0,
) -> list[dict]:
    entities, _ingest_run = IngestAgent().run(grants_path)
    matched, _match_run = MatchAgent().run(entities, corporations_path)
    scored, _score_run = RiskScoringAgent().run(matched)
    llm_client = build_llm_client(llm_provider)
    results, _case_run = CaseWritingAgent(llm_client=llm_client, llm_limit=llm_limit).run(scored)
    results.sort(key=lambda item: (item["roi_score"], item["total_awarded"]), reverse=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Phantom Flow processed results.")
    parser.add_argument("--grants", type=Path, default=DEMO_GRANTS_PATH)
    parser.add_argument("--corporations", type=Path, default=DEMO_CORPORATIONS_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--llm-provider", choices=["template", "groq", "gemini", "claude"], default=None)
    parser.add_argument(
        "--llm-limit",
        type=int,
        default=int(os.getenv("PHANTOM_FLOW_LLM_CASE_LIMIT", "0")),
        help="Number of top cases to summarize with the selected LLM.",
    )
    args = parser.parse_args()

    results = build_results(args.grants, args.corporations, args.output, args.llm_provider, args.llm_limit)
    zombies = sum(1 for row in results if row["is_zombie_candidate"])
    high = sum(1 for row in results if row["priority"] == "High")
    llm_summaries = sum(1 for row in results if row.get("case_summary_provider") != "template")
    print(f"Wrote {len(results)} entities to {args.output}")
    print(f"Zombie candidates: {zombies}; high-priority: {high}")
    print(f"LLM summaries: {llm_summaries}")


if __name__ == "__main__":
    main()

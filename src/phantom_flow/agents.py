"""Explicit pipeline agents.

These are lightweight deterministic agents, not autonomous chatbots. Each agent
has one job, accepts structured data, and emits structured data for the next
stage. The LLM is only used in the final case-writing agent.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from phantom_flow.case_writer import generate_case_summary
from phantom_flow.corporations import load_corporations
from phantom_flow.ingest import aggregate_grants, load_grants
from phantom_flow.llm import LLMClient, TemplateLLMClient
from phantom_flow.matching import match_entities
from phantom_flow.scoring import score_entity


@dataclass(frozen=True)
class AgentRun:
    name: str
    input_count: int
    output_count: int
    notes: list[str]


class IngestAgent:
    name = "ingest-normalize"

    def run(self, grants_path: Path) -> tuple[list[dict[str, Any]], AgentRun]:
        grants = load_grants(grants_path)
        entities = aggregate_grants(grants)
        return entities, AgentRun(self.name, len(grants), len(entities), ["Aggregated grants by normalized recipient name."])


class MatchAgent:
    name = "corporate-match"

    def run(self, entities: list[dict[str, Any]], corporations_path: Path) -> tuple[list[dict[str, Any]], AgentRun]:
        corporations = load_corporations(corporations_path)
        matched = match_entities(entities, corporations)
        matched_count = sum(1 for row in matched if row["match"]["matched"])
        return matched, AgentRun(self.name, len(entities), len(matched), [f"Matched {matched_count} entities to corporate records."])


class RiskScoringAgent:
    name = "risk-scoring"

    def run(self, entities: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], AgentRun]:
        scored = [score_entity(entity) for entity in entities]
        zombies = sum(1 for row in scored if row["is_zombie_candidate"])
        return scored, AgentRun(self.name, len(entities), len(scored), [f"Flagged {zombies} zombie candidates."])


class CaseWritingAgent:
    name = "case-writing"

    def __init__(self, llm_client: LLMClient | None = None, llm_limit: int = 0) -> None:
        self.llm_client = llm_client or TemplateLLMClient()
        self.llm_limit = max(0, llm_limit)

    def run(self, entities: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], AgentRun]:
        sorted_entities = sorted(entities, key=lambda item: (item["roi_score"], item["total_awarded"]), reverse=True)
        output = []
        llm_used = 0
        for index, entity in enumerate(sorted_entities):
            use_llm = self.llm_client.provider != "template" and index < self.llm_limit
            summary = generate_case_summary(entity, llm_client=self.llm_client if use_llm else None)
            output.append(
                {
                    **entity,
                    "case_summary": summary,
                    "case_summary_provider": self.llm_client.provider if use_llm else "template",
                    "case_summary_model": self.llm_client.model if use_llm else "deterministic-template",
                }
            )
            if use_llm:
                llm_used += 1

        return output, AgentRun(
            self.name,
            len(entities),
            len(output),
            [f"Generated {llm_used} LLM summaries and {len(output) - llm_used} deterministic summaries."],
        )

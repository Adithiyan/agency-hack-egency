"""Case summary generation."""

from __future__ import annotations

from typing import Any

from phantom_flow.llm import LLMClient

SYSTEM_PROMPT = """You are an enforcement triage analyst for public funding oversight.
Write only from the structured facts provided. Do not allege fraud, intent,
misconduct, or legal liability. Keep the language plain enough for a ministerial
briefing note and include caveats when evidence is limited."""


def generate_case_summary(entity: dict[str, Any], llm_client: LLMClient | None = None) -> str:
    if llm_client is not None:
        return llm_client.complete(SYSTEM_PROMPT, build_case_prompt(entity))
    return generate_template_summary(entity)


def generate_template_summary(entity: dict[str, Any]) -> str:
    match = entity.get("match", {})
    months = entity.get("months_to_dissolution")
    months_text = f"{months} months" if months is not None else "an unknown interval"
    flags = ", ".join(entity.get("flags") or ["no elevated flags"])

    return (
        f"{entity['display_name']} received ${entity['total_awarded']:,.0f} across "
        f"{entity['num_grants']} disclosed grant or contribution award(s), with the last "
        f"award dated {entity['last_award_date']}. The matched federal corporation record "
        f"shows status '{match.get('status')}' and dissolution date "
        f"{match.get('dissolution_date') or 'not available'}, creating a {months_text} "
        f"award-to-dissolution interval; key risk signals are: {flags}. Recommended action: "
        f"{entity['recommendation']} based on an ROI score of {entity['roi_score']}/100 "
        f"and {entity['confidence'].lower()} evidence confidence."
    )


def build_case_prompt(entity: dict[str, Any]) -> str:
    match = entity.get("match", {})
    flags = ", ".join(entity.get("flags") or ["no elevated flags"])
    grants = entity.get("grant_evidence") or []
    grant_lines = "\n".join(
        f"- {grant.get('agreement_number')}: ${grant.get('agreement_value', 0):,.0f}, "
        f"{grant.get('agreement_start_date')}, {grant.get('department')}, {grant.get('program_name')}"
        for grant in grants[:5]
    )

    return f"""Create a 3-sentence enforcement triage case summary.

Facts:
- Entity: {entity.get('display_name')}
- Province: {entity.get('province')}
- Total awarded: ${entity.get('total_awarded', 0):,.0f}
- Number of awards: {entity.get('num_grants')}
- First award date: {entity.get('first_award_date')}
- Last award date: {entity.get('last_award_date')}
- Matched corporation name: {match.get('legal_name')}
- Corporation number: {match.get('corporation_number')}
- Corporate status: {match.get('status')}
- Dissolution date: {match.get('dissolution_date')}
- Months from last award to dissolution: {entity.get('months_to_dissolution')}
- Match confidence: {match.get('confidence')}
- ROI score: {entity.get('roi_score')}/100
- Recommendation: {entity.get('recommendation')}
- Evidence confidence: {entity.get('confidence')}
- Risk flags: {flags}

Grant evidence:
{grant_lines}

Required format:
1. Timeline sentence.
2. Risk signal sentence.
3. Recommended action sentence with caveat that this is triage, not a finding."""

"""Claude-generated case summaries with strict no-API fallback."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import INTERIM_DIR, Settings

CASE_CACHE = INTERIM_DIR / "case_summaries.json"

CASE_PROMPT = """You are a government enforcement analyst.

Summarize the case below in exactly three sentences:
1. Funding-to-dissolution timeline.
2. Key risk signals from the evidence.
3. Recovery recommendation (immediate referral, compliance letter, or write off).

Strict rules:
- Use only the structured facts provided.
- Do not assert fraud, criminality, or wrongdoing.
- Do not invent dates, names, or amounts.
- If a fact is missing, say so plainly.

Case facts:
{facts}
"""


def _facts_block(entity: dict) -> str:
    fields = [
        ("Entity", entity.get("display_name") or entity.get("name_clean")),
        ("Province", entity.get("province")),
        ("Total awarded", f"${float(entity.get('total_awarded', 0)):,.0f}"),
        ("Number of grants", entity.get("num_grants")),
        ("Programs", ", ".join(entity.get("programs") or []) or "n/a"),
        ("First award", entity.get("first_award_date")),
        ("Last award", entity.get("last_award_date")),
        ("Status", entity.get("status")),
        ("Dissolution date", entity.get("dissolution_date")),
        ("Months to dissolution", entity.get("months_to_dissolution")),
        ("Match confidence", entity.get("confidence")),
        ("ROI score", entity.get("roi_score")),
        ("Flags", ", ".join(entity.get("flags") or []) or "none"),
    ]
    return "\n".join(f"- {label}: {value}" for label, value in fields if value not in (None, ""))


def fallback_summary(entity: dict) -> str:
    months = entity.get("months_to_dissolution")
    timing = (
        f"dissolved roughly {round(months)} months after its last award"
        if isinstance(months, (int, float))
        else "dissolution timing not confirmed"
    )
    awarded = float(entity.get("total_awarded", 0) or 0)
    rec = entity.get("recommendation", "review")
    flags = ", ".join(entity.get("flags") or []) or "no additional flags"
    name = entity.get("display_name") or entity.get("name_clean") or "Entity"
    return (
        f"{name} received ${awarded:,.0f} across "
        f"{len(entity.get('programs') or [])} federal program(s) and {timing}. "
        f"Evidence flags: {flags}; match confidence is {entity.get('confidence', 'unknown')}. "
        f"Recommended action: {rec}."
    )


def _load_cache() -> dict[str, str]:
    if not CASE_CACHE.exists():
        return {}
    try:
        return json.loads(CASE_CACHE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_cache(cache: dict[str, str]) -> None:
    CASE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    CASE_CACHE.write_text(json.dumps(cache, indent=2, sort_keys=True), encoding="utf-8")


def generate_case_summary(entity: dict, settings: Settings) -> str:
    """Return cached summary, call Claude if key present, else fallback template."""
    cache = _load_cache()
    key = str(entity.get("name_clean") or entity.get("display_name") or "")
    if key and key in cache:
        return cache[key]

    if not settings.anthropic_api_key:
        summary = fallback_summary(entity)
    else:
        summary = _call_claude(entity, settings)

    if key:
        cache[key] = summary
        _save_cache(cache)
    return summary


def _call_claude(entity: dict, settings: Settings) -> str:
    try:
        import anthropic  # local import keeps this optional at runtime
    except ImportError:
        return fallback_summary(entity)
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[
            {
                "role": "user",
                "content": CASE_PROMPT.format(facts=_facts_block(entity)),
            }
        ],
    )
    parts: list[str] = []
    for block in message.content:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts).strip() or fallback_summary(entity)


def write_results(rows: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, indent=2, default=str), encoding="utf-8")


# ── Agent-compatible interface ────────────────────────────────────────────────

def build_case_prompt(entity: dict[str, Any]) -> str:
    """Build an LLM prompt from a fully-scored entity dict (agent pipeline format).

    Required format: 3 sentences — timeline, signals, recommendation.
    This summary is a triage aid, not a finding of wrongdoing.
    """
    match = entity.get("match") or {}
    flags = ", ".join(entity.get("flags") or []) or "none"
    grants = entity.get("grant_evidence") or []
    grant_lines = "\n".join(
        f"  - {g.get('agreement_number')}: ${g.get('agreement_value', 0):,.0f}, "
        f"{g.get('agreement_start_date')}, {g.get('department')}, {g.get('program_name')}"
        for g in grants[:5]
    ) or "  (no individual grant rows available)"

    return (
        f"Create a 3-sentence enforcement triage case summary. "
        f"Required format: (1) funding-to-dissolution timeline, "
        f"(2) key risk signals, (3) recommended action.\n\n"
        f"Facts:\n"
        f"- Entity: {entity.get('display_name')}\n"
        f"- Province: {entity.get('province')}\n"
        f"- Total awarded: ${float(entity.get('total_awarded', 0) or 0):,.0f}\n"
        f"- Number of awards: {entity.get('num_grants')}\n"
        f"- Last award date: {entity.get('last_award_date')}\n"
        f"- Corporate status: {match.get('status')}\n"
        f"- Dissolution date: {match.get('dissolution_date')}\n"
        f"- Months from last award to dissolution: {entity.get('months_to_dissolution')}\n"
        f"- ROI score: {entity.get('roi_score')}/100\n"
        f"- Recommendation: {entity.get('recommendation')}\n"
        f"- Risk flags: {flags}\n\n"
        f"Grant evidence:\n{grant_lines}\n\n"
        f"This summary is a triage aid, not a finding of wrongdoing. "
        f"Do not allege fraud, intent, or legal liability. "
        f"State caveats when evidence is limited."
    )


def generate_case_summary(
    entity: dict[str, Any],
    llm_client: Any | None = None,
    settings: Any | None = None,
) -> str:
    """Generate a case summary.

    Accepts either the agent-pipeline interface (llm_client positional arg)
    or the settings-based pipeline interface (settings kwarg).
    Falls back to a deterministic template when no LLM is available.
    """
    # Agent pipeline path: llm_client provided directly
    if llm_client is not None and hasattr(llm_client, "complete"):
        from phantom_flow.llm import TemplateLLMClient
        if isinstance(llm_client, TemplateLLMClient) or getattr(llm_client, "provider", "") == "template":
            return fallback_summary(entity)
        return llm_client.complete(_SYSTEM_PROMPT, build_case_prompt(entity), max_tokens=400)

    # Settings-based pipeline path
    _settings = settings
    if _settings is None:
        try:
            from phantom_flow.config import load_settings
            _settings = load_settings()
        except Exception:
            return fallback_summary(entity)

    cache = _load_cache()
    key = str(entity.get("name_clean") or entity.get("display_name") or "")
    if key and key in cache:
        return cache[key]

    if not getattr(_settings, "anthropic_api_key", None):
        return fallback_summary(entity)

    summary = _call_claude(entity, _settings)
    if key:
        cache[key] = summary
        _save_cache(cache)
    return summary


_SYSTEM_PROMPT = (
    "You are an enforcement triage analyst for public funding oversight. "
    "Write only from the structured facts provided. Do not allege fraud, intent, "
    "misconduct, or legal liability. Keep the language plain enough for a ministerial "
    "briefing note and include caveats when evidence is limited."
)

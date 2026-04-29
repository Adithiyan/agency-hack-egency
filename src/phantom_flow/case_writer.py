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

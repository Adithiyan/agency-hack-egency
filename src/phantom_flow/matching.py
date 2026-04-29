"""Match aggregated entities to corporate records and label confidence."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from rapidfuzz import fuzz

from .corporations import CorpRecord
from .normalize import normalize_name


@dataclass(frozen=True)
class Match:
    name_clean: str
    matched_name: str | None
    confidence: int
    confidence_label: str  # high | medium | low | none
    status: str | None
    dissolution_date: str | None
    incorporation_date: str | None
    jurisdiction: str | None
    source: str


def _label(score: int) -> str:
    if score >= 92:
        return "high"
    if score >= 80:
        return "medium"
    if score >= 65:
        return "low"
    return "none"


def similarity(left: str, right: str) -> float:
    """Token-sort fuzzy similarity in [0.0, 1.0] for agent-pipeline matching."""
    l = normalize_name(left)
    r = normalize_name(right)
    if not l or not r:
        return 0.0
    return fuzz.token_sort_ratio(l, r) / 100.0


def match_entities(
    entities: list[dict[str, Any]],
    corporations: list[dict[str, Any]],
    threshold: float = 0.72,
) -> list[dict[str, Any]]:
    """Agent-pipeline batch match: embed match dict into each entity row."""
    results: list[dict[str, Any]] = []
    for entity in entities:
        display = entity.get("display_name") or entity.get("name_clean") or ""
        best: dict[str, Any] | None = None
        best_score = 0.0
        for corp in corporations:
            score = similarity(display, corp.get("legal_name") or "")
            if score > best_score:
                best = corp
                best_score = score
        matched = best is not None and best_score >= threshold
        results.append({
            **entity,
            "match": {
                "matched": matched,
                "confidence": round(best_score, 3),
                "legal_name": best.get("legal_name") if matched else None,
                "corporation_number": best.get("corporation_number") if matched else None,
                "status": best.get("status") if matched else "Unmatched",
                "dissolution_date": best.get("dissolution_date") if matched else None,
                "jurisdiction": best.get("jurisdiction") if matched else None,
                "source_url": best.get("source_url") if matched else None,
            },
        })
    return results


def match_one(name_clean: str, record: CorpRecord) -> Match:
    if not record.matched_name:
        return Match(
            name_clean=name_clean,
            matched_name=None,
            confidence=0,
            confidence_label="none",
            status=None,
            dissolution_date=None,
            incorporation_date=None,
            jurisdiction=None,
            source=record.source,
        )
    score = int(fuzz.token_sort_ratio(name_clean, record.matched_name.upper()))
    return Match(
        name_clean=name_clean,
        matched_name=record.matched_name,
        confidence=score,
        confidence_label=_label(score),
        status=record.status,
        dissolution_date=record.dissolution_date,
        incorporation_date=record.incorporation_date,
        jurisdiction=record.jurisdiction,
        source=record.source,
    )

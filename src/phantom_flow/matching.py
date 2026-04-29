"""Match aggregated entities to corporate records and label confidence."""

from __future__ import annotations

from dataclasses import dataclass

from rapidfuzz import fuzz

from .corporations import CorpRecord


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

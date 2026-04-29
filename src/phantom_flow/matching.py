"""Entity-to-corporation matching."""

from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any

from phantom_flow.normalization import normalize_entity_name, token_set


def similarity(left: str, right: str) -> float:
    left_key = normalize_entity_name(left)
    right_key = normalize_entity_name(right)
    if not left_key or not right_key:
        return 0.0
    if left_key == right_key:
        return 1.0

    left_tokens = token_set(left_key)
    right_tokens = token_set(right_key)
    overlap = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
    sequence = SequenceMatcher(None, left_key, right_key).ratio()
    return round((overlap * 0.65) + (sequence * 0.35), 4)


def match_entities(
    entities: list[dict[str, Any]],
    corporations: list[dict[str, Any]],
    threshold: float = 0.72,
) -> list[dict[str, Any]]:
    corp_index = [
        {
            **corp,
            "corp_key": normalize_entity_name(corp.get("legal_name", "")),
        }
        for corp in corporations
    ]
    results = []

    for entity in entities:
        best = None
        best_score = 0.0
        for corp in corp_index:
            score = similarity(entity["display_name"], corp["legal_name"])
            if score > best_score:
                best = corp
                best_score = score

        matched = best is not None and best_score >= threshold
        results.append(
            {
                **entity,
                "match": {
                    "matched": matched,
                    "confidence": round(best_score, 3),
                    "corporation_number": best.get("corporation_number") if matched else None,
                    "legal_name": best.get("legal_name") if matched else None,
                    "status": best.get("status") if matched else "Unmatched",
                    "dissolution_date": best.get("dissolution_date") if matched else None,
                    "jurisdiction": best.get("jurisdiction") if matched else None,
                    "source_url": best.get("source_url") if matched else None,
                },
            }
        )

    return results

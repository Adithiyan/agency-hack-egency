"""Grant ingestion and aggregation."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

from phantom_flow.normalization import normalize_entity_name
from phantom_flow.demo_expansion import expanded_grants

ROOT = Path(__file__).resolve().parents[2]
DEMO_GRANTS_PATH = ROOT / "data" / "demo" / "grants.json"


def load_grants(path: Path = DEMO_GRANTS_PATH) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".json":
        rows = json.loads(path.read_text(encoding="utf-8"))
        if path == DEMO_GRANTS_PATH:
            rows.extend(expanded_grants())
        return rows

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _money(value: Any) -> float:
    if isinstance(value, int | float):
        return float(value)
    return float(str(value).replace("$", "").replace(",", "").strip() or 0)


def _date(value: Any) -> str:
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "")[:10]


def aggregate_grants(rows: list[dict[str, Any]], minimum_award: float = 25_000) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    evidence: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in rows:
        name = row.get("recipient_legal_name") or row.get("recipient") or ""
        amount = _money(row.get("agreement_value", 0))
        if amount < minimum_award:
            continue

        key = normalize_entity_name(name)
        if not key:
            continue

        award_date = _date(row.get("agreement_start_date"))
        entity = grouped.setdefault(
            key,
            {
                "entity_key": key,
                "display_name": name,
                "total_awarded": 0.0,
                "num_grants": 0,
                "first_award_date": award_date,
                "last_award_date": award_date,
                "province": row.get("recipient_province") or "Unknown",
                "departments": set(),
                "programs": set(),
                "recipient_types": set(),
            },
        )

        entity["total_awarded"] += amount
        entity["num_grants"] += 1
        entity["first_award_date"] = min(entity["first_award_date"], award_date)
        entity["last_award_date"] = max(entity["last_award_date"], award_date)
        entity["departments"].add(row.get("owner_org") or "Unknown")
        entity["programs"].add(row.get("program_name") or "Unknown")
        entity["recipient_types"].add(row.get("recipient_type") or "Unknown")
        evidence[key].append(
            {
                "agreement_number": row.get("agreement_number", ""),
                "agreement_value": amount,
                "agreement_start_date": award_date,
                "department": row.get("owner_org") or "Unknown",
                "program_name": row.get("program_name") or "Unknown",
                "description": row.get("description_en") or "",
            }
        )

    entities = []
    for key, entity in grouped.items():
        clean = dict(entity)
        clean["total_awarded"] = round(clean["total_awarded"], 2)
        clean["departments"] = sorted(clean["departments"])
        clean["programs"] = sorted(clean["programs"])
        clean["recipient_types"] = sorted(clean["recipient_types"])
        clean["grant_evidence"] = sorted(
            evidence[key],
            key=lambda item: (item["agreement_start_date"], item["agreement_value"]),
            reverse=True,
        )
        entities.append(clean)

    return sorted(entities, key=lambda item: item["total_awarded"], reverse=True)

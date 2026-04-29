"""End-to-end pipeline: grants -> entities -> matches -> scores -> case files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd

from .case_writer import generate_case_summary, write_results
from .config import DEMO_DIR, PROCESSED_DIR, Settings, ensure_dirs, load_settings
from .corporations import lookup_many
from .ingest import aggregate_by_entity, download_grants, load_grants
from .matching import match_one
from .scoring import is_zombie, months_between, score_entity

DEMO_GRANTS_CSV = DEMO_DIR / "grants_demo.csv"


def _entities_from_grants(settings: Settings, demo: bool) -> pd.DataFrame:
    if demo and DEMO_GRANTS_CSV.exists():
        df = load_grants(DEMO_GRANTS_CSV, settings.min_award_value)
    else:
        csv = download_grants(settings)
        df = load_grants(csv, settings.min_award_value)
    return aggregate_by_entity(df)


def run(*, demo: bool = False, top_n_summaries: int = 25) -> Path:
    settings = load_settings()
    ensure_dirs()

    entities = _entities_from_grants(settings, demo=demo)
    names = entities["name_clean"].tolist()
    corp_records = lookup_many(names, settings)
    record_by_name = {r.name_clean: r for r in corp_records}

    rows: list[dict[str, Any]] = []
    for entity in entities.to_dict(orient="records"):
        record = record_by_name.get(entity["name_clean"])
        if record is None:
            continue
        match = match_one(entity["name_clean"], record)
        months = months_between(entity.get("last_award_date"), match.dissolution_date)
        zombie = is_zombie(match, entity.get("last_award_date"), settings.zombie_window_months)
        scoring = score_entity(
            entity, match, is_zombie_flag=zombie, months_to_dissolution=months
        )
        row = {
            **entity,
            "matched_name": match.matched_name,
            "match_confidence": match.confidence,
            "confidence": match.confidence_label,
            "status": match.status,
            "dissolution_date": match.dissolution_date,
            "incorporation_date": match.incorporation_date,
            "jurisdiction": match.jurisdiction,
            "is_zombie": zombie,
            **scoring,
        }
        rows.append(row)

    rows.sort(key=lambda r: r.get("roi_score", 0), reverse=True)
    for row in rows[:top_n_summaries]:
        row["case_summary"] = generate_case_summary(row, settings)
    for row in rows[top_n_summaries:]:
        row["case_summary"] = ""

    out = PROCESSED_DIR / "results.json"
    write_results(rows, out)

    entities_out = PROCESSED_DIR / "entities.json"
    entities_out.write_text(
        json.dumps(entities.to_dict(orient="records"), indent=2, default=str),
        encoding="utf-8",
    )

    web_out = Path(__file__).resolve().parents[2] / "web" / "data" / "results.json"
    if web_out.parent.exists():
        web_out.write_text(out.read_text(encoding="utf-8"), encoding="utf-8")

    return out


def _cli() -> None:
    parser = argparse.ArgumentParser(description="Run Phantom Flow pipeline.")
    parser.add_argument("--demo", action="store_true", help="Use bundled demo CSV")
    parser.add_argument("--top", type=int, default=25, help="How many case summaries to generate")
    args = parser.parse_args()
    out = run(demo=args.demo, top_n_summaries=args.top)
    print(f"wrote {out}")


if __name__ == "__main__":
    _cli()

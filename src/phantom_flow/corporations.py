"""Corporations Canada lookup with cache + fixture fallback.

The public Corporations Canada search endpoint is unstable and may require
session cookies in interactive use. We treat live access as best-effort:
results are cached to disk, and a fixture file under data/demo/ provides a
deterministic offline path used by the demo.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import httpx

from .config import DEMO_DIR, INTERIM_DIR, Settings

CORP_CACHE = INTERIM_DIR / "corp_lookups.json"
CORP_FIXTURE = DEMO_DIR / "corp_records.json"
SEARCH_URL = "https://ised-isde.canada.ca/cc/lgcy/api/v1/searchCompany"


@dataclass(frozen=True)
class CorpRecord:
    name_clean: str
    matched_name: str | None
    status: str | None
    dissolution_date: str | None
    incorporation_date: str | None
    jurisdiction: str | None
    source: str  # "live" | "fixture" | "miss"


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")


def load_fixture() -> dict[str, dict]:
    """Demo fixture keyed by normalized name."""
    return _load_json(CORP_FIXTURE)


def _from_payload(name_clean: str, payload: dict | None, source: str) -> CorpRecord:
    if not payload:
        return CorpRecord(name_clean, None, None, None, None, None, "miss")
    return CorpRecord(
        name_clean=name_clean,
        matched_name=payload.get("matched_name") or payload.get("name"),
        status=payload.get("status"),
        dissolution_date=payload.get("dissolution_date"),
        incorporation_date=payload.get("incorporation_date"),
        jurisdiction=payload.get("jurisdiction"),
        source=source,
    )


def lookup_live(name_clean: str, client: httpx.Client) -> dict | None:
    """Best-effort live lookup. Returns first hit payload or None."""
    try:
        r = client.get(SEARCH_URL, params={"q": name_clean}, timeout=20.0)
        r.raise_for_status()
        body = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    hits = body.get("results") or body.get("hits") or []
    if not hits:
        return None
    top = hits[0]
    return {
        "matched_name": top.get("companyName") or top.get("name"),
        "status": top.get("status") or top.get("statusEffectiveDate") and "Inactive",
        "dissolution_date": top.get("dissolutionDate"),
        "incorporation_date": top.get("incorporationDate"),
        "jurisdiction": top.get("jurisdiction") or "FED",
    }


def lookup_many(names: list[str], settings: Settings) -> list[CorpRecord]:
    """Look up corporate records for many entities, with cache + fixture fallback."""
    cache = _load_json(CORP_CACHE)
    fixture = load_fixture()
    results: list[CorpRecord] = []

    client: httpx.Client | None = None
    if settings.use_live_corp:
        client = httpx.Client(headers={"User-Agent": "phantom-flow/0.1"})

    try:
        for name in names:
            if name in cache:
                results.append(_from_payload(name, cache[name], "live"))
                continue
            if name in fixture:
                results.append(_from_payload(name, fixture[name], "fixture"))
                continue
            payload: dict | None = None
            if client is not None:
                payload = lookup_live(name, client)
                if payload is not None:
                    cache[name] = payload
            results.append(_from_payload(name, payload, "live" if payload else "miss"))
    finally:
        if client is not None:
            client.close()
        if settings.use_live_corp:
            _save_json(CORP_CACHE, cache)

    return results

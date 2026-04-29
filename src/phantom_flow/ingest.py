"""Grants ingestion and per-entity aggregation.

Real column names confirmed from the open.canada.ca proactive-disclosure
grants schema (2024-12-01 version):

  ref_number, amendment_number, amendment_date, agreement_type,
  recipient_type, recipient_business_number, recipient_legal_name,
  recipient_operating_name, recipient_country, recipient_province,
  recipient_city, recipient_postal_code, prog_name_en, prog_purpose_en,
  agreement_title_en, agreement_number, agreement_value,
  foreign_currency_type, foreign_currency_value, agreement_start_date,
  agreement_end_date, coverage, description_en, naics_identifier,
  expected_results_en, additional_information_en, owner_org, owner_org_title

recipient_type codes:
  F = For-profit organizations  (primary zombie target)
  N = Not-for-profit / charities (primary zombie target)
  A = Indigenous recipients
  S = Academia
  G = Government
  I = International (non-government)
  P = Individual / sole proprietor
  O = Other
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pandas as pd

from .config import Settings, ensure_dirs
from .normalize import normalize_name

# Types the challenge cares about: companies + nonprofits that can dissolve
TARGET_RECIPIENT_TYPES = {"F", "N", "A", "O"}

# Canonical column -> fallback aliases (for older CSV exports)
GRANT_COLUMNS: dict[str, list[str]] = {
    "recipient_legal_name":  ["recipient_legal_name", "recipient_business_name"],
    "recipient_type":        ["recipient_type"],
    "agreement_value":       ["agreement_value"],
    "agreement_start_date":  ["agreement_start_date", "agreement_start"],
    "agreement_end_date":    ["agreement_end_date", "agreement_end"],
    "recipient_province":    ["recipient_province", "recipient_province_or_territory"],
    "owner_org":             ["owner_org"],
    "owner_org_title":       ["owner_org_title"],
    "prog_name_en":          ["prog_name_en", "program_name_en"],
    "description_en":        ["description_en", "agreement_title_en"],
    "recipient_business_number": ["recipient_business_number"],
    "naics_identifier":      ["naics_identifier"],
}

REQUIRED_COLUMNS = {"recipient_legal_name", "agreement_value"}


def _resolve_columns(df: pd.DataFrame) -> dict[str, str]:
    """Map canonical -> actual column in df, case-insensitive."""
    cols_lower = {c.lower(): c for c in df.columns}
    resolved: dict[str, str] = {}
    for canonical, candidates in GRANT_COLUMNS.items():
        for cand in candidates:
            if cand.lower() in cols_lower:
                resolved[canonical] = cols_lower[cand.lower()]
                break
    return resolved


def download_grants(settings: Settings) -> Path:
    """Download grants CSV if not cached. Returns local path."""
    ensure_dirs()
    target = settings.grants_csv
    if target.exists() and target.stat().st_size > 0:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)

    canonical = settings.grants_url
    print(f"Downloading grants CSV from {canonical} ...")

    for attempt in range(3):
        try:
            with httpx.stream("GET", canonical, timeout=300.0, follow_redirects=True) as r:
                if r.status_code in (403, 404):
                    # SAS token may have expired on redirect — retry with fresh request
                    print(f"  Attempt {attempt+1}: HTTP {r.status_code}, retrying with fresh redirect...")
                    if target.exists():
                        target.unlink()
                    import time as _t; _t.sleep(2)
                    continue
                r.raise_for_status()
                with target.open("wb") as f:
                    for chunk in r.iter_bytes(chunk_size=65536):
                        f.write(chunk)
            if target.exists() and target.stat().st_size > 0:
                print(f"Saved to {target} ({target.stat().st_size / 1e6:.1f} MB)")
                return target
        except httpx.HTTPStatusError as exc:
            if attempt < 2:
                import time as _t; _t.sleep(3)
                continue
            raise RuntimeError(
                f"Failed to download grants CSV after 3 attempts. "
                f"The open.canada.ca source may be temporarily unavailable. "
                f"Try manually downloading from:\n  {canonical}\nand saving to {target}"
            ) from exc

    raise RuntimeError(f"Could not download grants CSV from {canonical} after 3 attempts.")


def load_grants(csv_path: Path, min_value: float) -> pd.DataFrame:
    """Load grants CSV, resolve real column names, filter to actionable rows."""
    df = pd.read_csv(
        csv_path,
        low_memory=False,
        encoding="utf-8-sig",
        encoding_errors="replace",
    )
    cols = _resolve_columns(df)
    missing = REQUIRED_COLUMNS - set(cols)
    if missing:
        raise ValueError(
            f"Grants CSV missing required columns {missing}. "
            f"Resolved columns: {list(cols.keys())}. "
            f"Actual CSV columns: {list(df.columns[:20])}..."
        )

    df = df.rename(columns={v: k for k, v in cols.items()})

    df["agreement_value"] = pd.to_numeric(df["agreement_value"], errors="coerce")
    df = df.dropna(subset=["agreement_value", "recipient_legal_name"])
    df = df[df["agreement_value"] >= min_value].copy()

    # Filter to target recipient types when the column exists
    if "recipient_type" in df.columns:
        df = df[df["recipient_type"].isin(TARGET_RECIPIENT_TYPES) | df["recipient_type"].isna()]

    df["name_clean"] = df["recipient_legal_name"].map(normalize_name)
    df = df[df["name_clean"].str.len() > 0]

    if "agreement_start_date" in df.columns:
        df["agreement_start_date"] = pd.to_datetime(df["agreement_start_date"], errors="coerce")
    if "agreement_end_date" in df.columns:
        df["agreement_end_date"] = pd.to_datetime(df["agreement_end_date"], errors="coerce")

    return df.reset_index(drop=True)


def aggregate_by_entity(df: pd.DataFrame) -> pd.DataFrame:
    """Group grants per normalized entity.

    Key derived fields for zombie/dependency detection:
    - funding_years: set of calendar years with grants (concentration proxy)
    - annual_totals: dict year->total (dependency pattern analysis)
    - has_business_number: whether any row had a BN (aids Corp matching)
    """
    agg_cols: dict[str, tuple] = {
        "total_awarded":  ("agreement_value", "sum"),
        "num_grants":     ("agreement_value", "count"),
        "first_award_date": ("agreement_start_date", "min"),
        "last_award_date":  ("agreement_start_date", "max"),
        "display_name":   ("recipient_legal_name", "first"),
    }

    if "recipient_type" in df.columns:
        agg_cols["recipient_type"] = ("recipient_type", "first")
    if "recipient_province" in df.columns:
        agg_cols["province"] = ("recipient_province", "first")
    if "owner_org" in df.columns:
        agg_cols["programs"] = ("owner_org", lambda s: sorted(set(s.dropna().astype(str))))
    if "owner_org_title" in df.columns:
        agg_cols["program_titles"] = ("owner_org_title", lambda s: sorted(set(s.dropna().astype(str)))[:5])
    if "description_en" in df.columns:
        agg_cols["sample_descriptions"] = ("description_en", lambda s: list(s.dropna().astype(str).head(3)))
    if "recipient_business_number" in df.columns:
        agg_cols["business_numbers"] = ("recipient_business_number", lambda s: [x for x in s.dropna().astype(str).unique() if x.strip()])
    if "naics_identifier" in df.columns:
        agg_cols["naics_codes"] = ("naics_identifier", lambda s: sorted(set(s.dropna().astype(str)))[:5])

    grouped = df.groupby("name_clean", as_index=False).agg(**agg_cols)

    # Derive funding-concentration years from ungrouped data for dependency flag
    if "agreement_start_date" in df.columns:
        year_totals = (
            df.dropna(subset=["agreement_start_date"])
            .assign(year=lambda d: d["agreement_start_date"].dt.year)
            .groupby(["name_clean", "year"])["agreement_value"]
            .sum()
        )
        funding_years_map: dict[str, list[int]] = {}
        annual_totals_map: dict[str, dict] = {}
        for (name, year), total in year_totals.items():
            funding_years_map.setdefault(name, []).append(int(year))
            annual_totals_map.setdefault(name, {})[int(year)] = float(total)

        grouped["funding_years"] = grouped["name_clean"].map(lambda n: sorted(funding_years_map.get(n, [])))
        grouped["annual_totals"] = grouped["name_clean"].map(lambda n: annual_totals_map.get(n, {}))
    else:
        grouped["funding_years"] = [[] for _ in range(len(grouped))]
        grouped["annual_totals"] = [{} for _ in range(len(grouped))]

    return grouped.sort_values("total_awarded", ascending=False).reset_index(drop=True)


# ── Agent-compatible interface ────────────────────────────────────────────────

def load_grants(path: Path, min_value: float = 25_000.0) -> "pd.DataFrame":
    """Load grants CSV. Accepts either (path) or (path, min_value) call signatures."""
    return _load_grants_impl(path, min_value)


def _load_grants_impl(csv_path: Path, min_value: float) -> "pd.DataFrame":
    """Internal implementation shared by load_grants and download_grants flow."""
    import pandas as pd
    df = pd.read_csv(csv_path, low_memory=False, encoding="utf-8-sig", encoding_errors="replace")
    cols = _resolve_columns(df)
    missing = REQUIRED_COLUMNS - set(cols)
    if missing:
        raise ValueError(f"Grants CSV missing required columns {missing}. Actual: {list(df.columns[:20])}")
    df = df.rename(columns={v: k for k, v in cols.items()})
    df["agreement_value"] = pd.to_numeric(df["agreement_value"], errors="coerce")
    df = df.dropna(subset=["agreement_value", "recipient_legal_name"])
    df = df[df["agreement_value"] >= min_value].copy()
    if "recipient_type" in df.columns:
        df = df[df["recipient_type"].isin(TARGET_RECIPIENT_TYPES) | df["recipient_type"].isna()]
    df["name_clean"] = df["recipient_legal_name"].map(normalize_name)
    df = df[df["name_clean"].str.len() > 0]
    if "agreement_start_date" in df.columns:
        df["agreement_start_date"] = pd.to_datetime(df["agreement_start_date"], errors="coerce")
    if "agreement_end_date" in df.columns:
        df["agreement_end_date"] = pd.to_datetime(df["agreement_end_date"], errors="coerce")
    return df.reset_index(drop=True)


def aggregate_grants(df: "pd.DataFrame") -> list[dict]:
    """Agent-pipeline wrapper: returns list of dicts instead of DataFrame."""
    return aggregate_by_entity(df).to_dict(orient="records")

"""Runtime configuration loaded from environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
PROCESSED_DIR = DATA_DIR / "processed"
DEMO_DIR = DATA_DIR / "demo"

DEFAULT_GRANTS_URL = (
    "https://open.canada.ca/data/dataset/"
    "432527ab-dd47-4d44-a911-39b9f5ad0e49/resource/"
    "1d15a62f-5656-49ad-8c88-f40ce689d831/download/gc.csv"
)


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str | None
    grants_url: str
    grants_csv: Path
    use_live_corp: bool
    min_award_value: float = 25_000.0
    zombie_window_months: int = 12      # challenge spec: 12 months
    zombie_window_extended: int = 24    # optional broader view


def load_settings() -> Settings:
    return Settings(
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
        grants_url=os.getenv("PHANTOM_FLOW_GRANTS_URL", DEFAULT_GRANTS_URL),
        grants_csv=Path(os.getenv("PHANTOM_FLOW_GRANTS_CSV", str(RAW_DIR / "grants.csv"))),
        use_live_corp=os.getenv("PHANTOM_FLOW_USE_LIVE_CORP", "false").lower() == "true",
    )


def ensure_dirs() -> None:
    for d in (RAW_DIR, INTERIM_DIR, PROCESSED_DIR, DEMO_DIR):
        d.mkdir(parents=True, exist_ok=True)

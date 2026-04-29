"""Corporate record loading.

The live Corporations Canada API can be added behind this interface. The
hackathon demo path uses cached records to avoid rate-limit or auth failures.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from phantom_flow.demo_expansion import expanded_corporations

ROOT = Path(__file__).resolve().parents[2]
DEMO_CORPORATIONS_PATH = ROOT / "data" / "demo" / "corporations.json"


def load_corporations(path: Path = DEMO_CORPORATIONS_PATH) -> list[dict[str, Any]]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    if path == DEMO_CORPORATIONS_PATH:
        rows.extend(expanded_corporations())
    return rows

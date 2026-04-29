"""Name normalization helpers for entity matching."""

from __future__ import annotations

import re
import unicodedata

LEGAL_SUFFIXES = (
    "INCORPORATED",
    "INC",
    "LIMITED",
    "LTD",
    "CORPORATION",
    "CORP",
    "COMPANY",
    "CO",
    "SOCIETE",
    "SOCIETY",
    "ASSOCIATION",
    "FOUNDATION",
    "FONDATION",
    "CANADA",
)


def normalize_entity_name(value: str | None) -> str:
    """Return a stable uppercase entity key suitable for rough matching."""
    if not value:
        return ""

    text = unicodedata.normalize("NFKD", value)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.upper().replace("&", " AND ")
    text = re.sub(r"[^A-Z0-9 ]+", " ", text)
    words = [word for word in text.split() if word not in LEGAL_SUFFIXES]
    return " ".join(words)


def token_set(value: str) -> set[str]:
    return {token for token in normalize_entity_name(value).split() if len(token) > 1}

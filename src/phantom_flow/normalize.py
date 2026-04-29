"""Entity name normalization."""

from __future__ import annotations

import re

LEGAL_SUFFIXES = (
    "INCORPORATED",
    "INCORPOREE",
    "INCORPORATION",
    "CORPORATION",
    "CORP",
    "LIMITED",
    "LIMITEE",
    "LIMITED PARTNERSHIP",
    "LTD",
    "LTEE",
    "LLC",
    "LLP",
    "INC",
    "ULC",
    "GP",
    "CO",
    "COMPANY",
    "ASSOCIATION",
    "SOCIETY",
    "FOUNDATION",
)

_PUNCT_RE = re.compile(r"[.,'\"!?\-/]+")
_WS_RE = re.compile(r"\s+")
_SUFFIX_RE = re.compile(
    r"\b(" + "|".join(re.escape(s) for s in LEGAL_SUFFIXES) + r")\b\.?",
    flags=re.IGNORECASE,
)


def normalize_name(raw: str | None) -> str:
    """Return canonical uppercase form of a recipient name.

    Strips legal suffixes, collapses whitespace, drops most punctuation.
    """
    if not raw:
        return ""
    name = str(raw).upper()
    name = _PUNCT_RE.sub(" ", name)
    name = _SUFFIX_RE.sub(" ", name)
    name = name.replace("&", " AND ")
    name = _WS_RE.sub(" ", name).strip()
    return name

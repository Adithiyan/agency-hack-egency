"""Recovery ROI scoring aligned to the challenge criteria.

Challenge requirements:
1. Dissolved / bankrupt / stopped filing within **12 months** of last funding.
2. Public funding makes up >70-80% of total revenue (dependency flag).
3. Question: did the public get anything for its money?

Weights (sum to 100):
  35 — Recoverable amount (size × timing)
  30 — Evidence strength (match confidence + corporate status certainty)
  20 — Pursuit cost efficiency (penalise old cases, weak matches)
  15 — Public value exposure (multi-program dependency, funding concentration)

Dependency flag logic (proxy, no revenue data available):
  - Funded across 3+ consecutive years by 3+ departments → HIGH dependency
  - Funded 2 years by 2+ departments → MEDIUM dependency
  - Single year, single department → LOW dependency
  We flag HIGH as likely unable to survive without public funding (≈ >70%
  revenue from public sources), consistent with challenge wording.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from .matching import Match

ZOMBIE_STATUSES = {"DISSOLVED", "INACTIVE", "BANKRUPT", "CANCELLED", "STRUCK"}

W_RECOVERABLE  = 35.0
W_EVIDENCE     = 30.0
W_PURSUIT_COST = 20.0
W_EXPOSURE     = 15.0

# Challenge strict window: 12 months
CHALLENGE_ZOMBIE_MONTHS = 12


@dataclass(frozen=True)
class ScoreBreakdown:
    recoverable: float
    evidence: float
    pursuit_cost: float
    exposure: float

    def total(self) -> float:
        return round(self.recoverable + self.evidence + self.pursuit_cost + self.exposure, 1)


def _parse_date(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value)[:10]).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def months_between(start: Any, end: Any) -> float | None:
    s = _parse_date(start)
    e = _parse_date(end)
    if s is None or e is None:
        return None
    return (e - s).days / 30.0


def is_zombie(match: Match, last_award_date: Any, window_months: int) -> bool:
    """True if entity dissolved within window_months of last award."""
    if not match.dissolution_date:
        return False
    status_upper = (match.status or "").upper()
    if status_upper == "ACTIVE":
        return False
    # Accept as zombie if status is a known dead status OR unknown (rely on date)
    if status_upper and status_upper not in ZOMBIE_STATUSES:
        return False
    months = months_between(last_award_date, match.dissolution_date)
    if months is None:
        return False
    # Allow negative months if dissolution predates last award slightly (data lag)
    return -3 <= months <= window_months


def funding_dependency_level(entity: dict) -> str:
    """Proxy for >70-80% public revenue dependency.

    Returns 'high' | 'medium' | 'low' based on funding concentration signals.
    """
    programs = entity.get("programs") or []
    funding_years = entity.get("funding_years") or []
    annual_totals = entity.get("annual_totals") or {}

    n_programs = len(programs)
    n_years = len(funding_years)

    # Check consecutive years
    consecutive = 0
    if funding_years:
        sorted_years = sorted(funding_years)
        run = 1
        for i in range(1, len(sorted_years)):
            if sorted_years[i] - sorted_years[i - 1] == 1:
                run += 1
            else:
                run = 1
            consecutive = max(consecutive, run)
        consecutive = max(consecutive, 1)

    # High concentration: funded many years across many programs
    if n_years >= 3 and consecutive >= 3 and n_programs >= 3:
        return "high"
    if n_years >= 3 and n_programs >= 2:
        return "high"
    if n_years >= 2 and n_programs >= 2:
        return "medium"
    if n_years >= 2:
        return "medium"
    return "low"


def _recoverable_component(
    total_awarded: float, months_to_dissolution: float | None
) -> float:
    """Bigger award + shorter window = more recoverable."""
    # Amount factor: $1M+ = full weight
    amount_factor = min(1.0, total_awarded / 1_000_000.0)

    if months_to_dissolution is None:
        timing_factor = 0.2  # partial credit; dissolution date unknown
    else:
        # Linear decay: 0 months = 1.0, 12 months = 0.0, beyond = penalised
        timing_factor = max(0.0, 1.0 - max(months_to_dissolution, 0.0) / CHALLENGE_ZOMBIE_MONTHS)

    return round(W_RECOVERABLE * (0.55 * amount_factor + 0.45 * timing_factor), 2)


def _evidence_component(match: Match) -> float:
    base = match.confidence / 100.0
    if match.dissolution_date:
        base = min(1.0, base + 0.15)
    if match.status and match.status.upper() in ZOMBIE_STATUSES:
        base = min(1.0, base + 0.08)
    return round(W_EVIDENCE * base, 2)


def _pursuit_cost_component(
    match: Match, months_to_dissolution: float | None
) -> float:
    """Higher cost = lower score component. Penalise weak matches and old cases."""
    penalty = 0.0
    if match.confidence_label in {"low", "none"}:
        penalty += 0.55   # weak match = expensive to validate
    if months_to_dissolution is not None and months_to_dissolution > CHALLENGE_ZOMBIE_MONTHS:
        penalty += 0.3    # outside challenge window = harder to pursue
    if months_to_dissolution is not None and months_to_dissolution < 0:
        penalty += 0.15   # dissolution before last award = data quality issue
    return round(max(0.0, W_PURSUIT_COST * (1.0 - penalty)), 2)


def _exposure_component(entity: dict) -> float:
    """Public value risk: multi-program dependency + amount scale."""
    dep_level = funding_dependency_level(entity)
    dep_factor = {"high": 1.0, "medium": 0.6, "low": 0.25}[dep_level]

    total = float(entity.get("total_awarded", 0) or 0)
    amount_factor = min(1.0, total / 5_000_000.0)

    return round(W_EXPOSURE * (0.6 * dep_factor + 0.4 * amount_factor), 2)


def estimate_recoverable(total_awarded: float, months_to_dissolution: float | None) -> float:
    """Rough recovery estimate: tighter window = higher recovery rate."""
    if months_to_dissolution is None:
        return round(total_awarded * 0.1)
    # Within challenge window (12 months): high recovery potential
    if 0 <= months_to_dissolution <= CHALLENGE_ZOMBIE_MONTHS:
        rate = max(0.2, 1.0 - months_to_dissolution / CHALLENGE_ZOMBIE_MONTHS * 0.6)
    else:
        rate = max(0.05, 0.2 - max(0, months_to_dissolution - CHALLENGE_ZOMBIE_MONTHS) / 24.0 * 0.15)
    return round(total_awarded * rate)


def recommendation_for(score: float, confidence_label: str, is_zombie_flag: bool) -> str:
    if confidence_label in {"none"}:
        return "insufficient evidence"
    if confidence_label == "low":
        return "review"
    if not is_zombie_flag:
        return "monitor"
    if score >= 75:
        return "immediate referral"
    if score >= 45:
        return "compliance letter"
    return "write off"


def score_entity(
    entity: dict,
    match: Match,
    *,
    is_zombie_flag: bool,
    months_to_dissolution: float | None,
) -> dict:
    dep_level = funding_dependency_level(entity)
    breakdown = ScoreBreakdown(
        recoverable=_recoverable_component(
            float(entity.get("total_awarded", 0.0) or 0),
            months_to_dissolution,
        ),
        evidence=_evidence_component(match),
        pursuit_cost=_pursuit_cost_component(match, months_to_dissolution),
        exposure=_exposure_component(entity),
    )
    total = breakdown.total()

    flags: list[str] = []
    if is_zombie_flag:
        flags.append("zombie_12mo" if (months_to_dissolution or 99) <= 12 else "zombie_extended")
    if dep_level in {"high", "medium"}:
        flags.append(f"funding_dependency_{dep_level}")
    if match.confidence_label in {"low", "none"}:
        flags.append("weak_match")
    if (entity.get("programs") and len(entity["programs"]) >= 3):
        flags.append("multi_program")
    if float(entity.get("total_awarded", 0) or 0) >= 1_000_000:
        flags.append("large_award")

    return {
        "roi_score": total,
        "score_breakdown": asdict(breakdown),
        "recommendation": recommendation_for(total, match.confidence_label, is_zombie_flag),
        "confidence": match.confidence_label,
        "flags": flags,
        "funding_dependency": dep_level,
        "estimated_recoverable": estimate_recoverable(
            float(entity.get("total_awarded", 0.0) or 0),
            months_to_dissolution,
        ),
        "months_to_dissolution": months_to_dissolution,
    }

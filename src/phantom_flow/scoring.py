"""Explainable Recovery ROI scoring."""

from __future__ import annotations

from datetime import datetime
from typing import Any

ZOMBIE_STATUSES = {"DISSOLVED", "BANKRUPT", "INSOLVENT", "INACTIVE", "RECEIVERSHIP"}


def months_between(start: str | None, end: str | None) -> int | None:
    if not start or not end:
        return None
    start_date = datetime.fromisoformat(start[:10])
    end_date = datetime.fromisoformat(end[:10])
    return round((end_date - start_date).days / 30.4375)


def _amount_points(total_awarded: float, months_to_dissolution: int | None) -> int:
    if total_awarded >= 5_000_000:
        base = 35
    elif total_awarded >= 1_000_000:
        base = 29
    elif total_awarded >= 500_000:
        base = 22
    elif total_awarded >= 100_000:
        base = 14
    else:
        base = 7

    if months_to_dissolution is None:
        return max(0, base - 12)
    if months_to_dissolution <= 6:
        return base
    if months_to_dissolution <= 12:
        return max(0, base - 4)
    if months_to_dissolution <= 24:
        return max(0, base - 10)
    return max(0, base - 20)


def score_entity(entity: dict[str, Any]) -> dict[str, Any]:
    match = entity.get("match", {})
    status = str(match.get("status") or "").upper()
    dissolution_date = match.get("dissolution_date")
    months = months_between(entity.get("last_award_date"), dissolution_date)
    is_zombie = status in ZOMBIE_STATUSES and months is not None and 0 <= months <= 24

    recoverable_amount = _amount_points(float(entity["total_awarded"]), months)
    evidence_strength = 0
    evidence_strength += int(18 * float(match.get("confidence") or 0))
    evidence_strength += 7 if status in ZOMBIE_STATUSES else 0
    evidence_strength += 5 if dissolution_date else 0

    pursuit_cost = 20
    if months is None:
        pursuit_cost -= 8
    elif months > 24:
        pursuit_cost -= 10
    elif months > 12:
        pursuit_cost -= 4
    if float(match.get("confidence") or 0) < 0.85:
        pursuit_cost -= 4
    pursuit_cost = max(0, pursuit_cost)

    public_value_exposure = min(15, 5 + (entity["num_grants"] * 2) + (len(entity["programs"]) * 2))

    total = recoverable_amount + evidence_strength + pursuit_cost + public_value_exposure
    if not is_zombie:
        total = min(total, 39)

    if total >= 80:
        recommendation = "Immediate referral"
        priority = "High"
    elif total >= 40:
        recommendation = "Compliance letter"
        priority = "Medium"
    else:
        recommendation = "Write off / monitor"
        priority = "Low"

    if float(match.get("confidence") or 0) >= 0.9 and dissolution_date:
        confidence = "High"
    elif float(match.get("confidence") or 0) >= 0.72:
        confidence = "Medium"
    else:
        confidence = "Low"

    flags = []
    if is_zombie:
        flags.append("Dissolved within 24 months of last award")
    if months is not None and 0 <= months <= 12:
        flags.append("Strict 12-month zombie window")
    if entity["num_grants"] >= 3:
        flags.append("Multiple awards")
    if len(entity["programs"]) >= 2:
        flags.append("Multiple programs")
    if float(entity["total_awarded"]) >= 1_000_000:
        flags.append("Large total award exposure")
    if confidence == "Low":
        flags.append("Low match confidence")

    estimated_recoverable = estimate_recoverable(float(entity["total_awarded"]), months, total)

    return {
        **entity,
        "is_zombie_candidate": is_zombie,
        "months_to_dissolution": months,
        "roi_score": round(total),
        "score_breakdown": {
            "recoverable_amount": recoverable_amount,
            "evidence_strength": evidence_strength,
            "pursuit_cost": pursuit_cost,
            "public_value_exposure": public_value_exposure,
        },
        "recommendation": recommendation,
        "priority": priority,
        "confidence": confidence,
        "flags": flags,
        "estimated_recoverable": estimated_recoverable,
    }


def estimate_recoverable(total_awarded: float, months: int | None, score: float) -> float:
    if months is None or score < 40:
        rate = 0.08
    elif months <= 6:
        rate = 0.55
    elif months <= 12:
        rate = 0.42
    elif months <= 24:
        rate = 0.25
    else:
        rate = 0.1
    return round(total_awarded * rate, 2)

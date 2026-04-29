"""Deterministic representative demo expansion.

These are not real enforcement findings. They give the dashboard enough shape
to demonstrate ranking, filtering, weak matches, active entities, and write-offs.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

BASE_NAMES = [
    ("Cedar Grid Storage Inc.", "Alberta", "For-profit organization", "Energy Storage Deployment"),
    ("Harbour Youth Pathways Foundation", "New Brunswick", "Non-profit organization", "Youth Employment Partnership"),
    ("Silverline Medtech Corporation", "Ontario", "For-profit organization", "Health Innovation Scale-up"),
    ("Tundra Food Systems Ltd.", "Yukon", "For-profit organization", "Northern Food Security Fund"),
    ("St. Lawrence Circular Plastics Society", "Quebec", "Non-profit organization", "Circular Economy Pilot"),
    ("Pacific Skills Accelerator Inc.", "British Columbia", "For-profit organization", "Workforce Digital Adoption"),
    ("Red River Manufacturing Co.", "Manitoba", "For-profit organization", "Advanced Manufacturing Adoption"),
    ("Labrador Community Broadband Foundation", "Newfoundland and Labrador", "Non-profit organization", "Rural Connectivity Fund"),
    ("Saskatchewan Agri-Sensor Technologies Ltd.", "Saskatchewan", "For-profit organization", "Agri-Tech Commercialization"),
    ("Island Retrofit Collective", "Prince Edward Island", "Non-profit organization", "Green Buildings Program"),
    ("Nunavut Logistics Renewal Corporation", "Nunavut", "For-profit organization", "Arctic Supply Chain Fund"),
    ("North Coast Ocean Data Inc.", "British Columbia", "For-profit organization", "Ocean Supercluster Support"),
    ("Kingston Battery Recycling Corporation", "Ontario", "For-profit organization", "Clean Technology Demonstration Program"),
    ("Acadie Cultural Training Society", "Nova Scotia", "Non-profit organization", "Community Skills Fund"),
    ("Calgary Hydrogen Mobility Inc.", "Alberta", "For-profit organization", "Low Carbon Economy Fund"),
    ("Montreal Textile Recovery Ltd.", "Quebec", "For-profit organization", "Regional Innovation Fund"),
    ("Winnipeg Childcare Expansion Foundation", "Manitoba", "Non-profit organization", "Community Infrastructure Partnerships"),
    ("Regina Cloud Robotics Inc.", "Saskatchewan", "For-profit organization", "Industrial Research Assistance Program"),
    ("Fredericton Biofuels Cooperative", "New Brunswick", "Non-profit organization", "Clean Fuels Support"),
    ("Vancouver Island Marine Repair Ltd.", "British Columbia", "For-profit organization", "Business Scale-up and Productivity"),
    ("Ottawa Civic Data Trust", "Ontario", "Non-profit organization", "Digital Government Partnerships"),
    ("Whitehorse Heat Pump Collective", "Yukon", "Non-profit organization", "Green Buildings Program"),
    ("Charlottetown Farm Automation Inc.", "Prince Edward Island", "For-profit organization", "Agri-Tech Commercialization"),
    ("Halifax Quantum Safety Corporation", "Nova Scotia", "For-profit organization", "Industrial Research Assistance Program"),
]

DEPARTMENTS = [
    "Innovation, Science and Economic Development Canada",
    "Employment and Social Development Canada",
    "Environment and Climate Change Canada",
    "Regional Development Agency",
    "National Research Council Canada",
]


def expanded_grants() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = date(2023, 4, 1)
    for idx, (name, province, recipient_type, program) in enumerate(BASE_NAMES, start=1):
        grant_count = 1 + (idx % 3)
        base_amount = 95_000 + (idx * 83_000)
        for grant_idx in range(grant_count):
            award_date = start + timedelta(days=(idx * 31) + (grant_idx * 97))
            rows.append(
                {
                    "recipient_legal_name": name,
                    "agreement_number": f"GC-DEMO-{idx:03d}-{grant_idx + 1}",
                    "agreement_value": base_amount + (grant_idx * 140_000),
                    "agreement_start_date": award_date.isoformat(),
                    "recipient_province": province,
                    "owner_org": DEPARTMENTS[(idx + grant_idx) % len(DEPARTMENTS)],
                    "program_name": program if grant_idx == 0 else f"{program} Extension",
                    "recipient_type": recipient_type,
                    "description_en": f"Representative demo award for {program.lower()}.",
                }
            )
    return rows


def expanded_corporations() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for idx, (name, province, _recipient_type, _program) in enumerate(BASE_NAMES, start=1):
        status_cycle = idx % 6
        if status_cycle in {1, 2, 3}:
            status = "Dissolved"
            months_after = 3 + (idx % 18)
        elif status_cycle == 4:
            status = "Inactive"
            months_after = 8 + (idx % 12)
        else:
            status = "Active"
            months_after = None

        last_award = date(2023, 4, 1) + timedelta(days=(idx * 31) + ((idx % 3) * 97))
        dissolution_date = (
            (last_award + timedelta(days=round(months_after * 30.4375))).isoformat()
            if months_after is not None
            else None
        )
        legal_name = name
        if idx % 5 == 0:
            legal_name = legal_name.replace("Corporation", "Corp.").replace("Limited", "Ltd.")

        rows.append(
            {
                "legal_name": legal_name,
                "corporation_number": f"15{idx:05d}-{idx % 10}",
                "business_number": f"71{idx:07d}",
                "status": status,
                "dissolution_date": dissolution_date,
                "jurisdiction": "Federal",
                "province": province,
                "source_url": "Demo expansion: replace with validated corporate record URL",
            }
        )
    return rows

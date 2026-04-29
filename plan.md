hackathon challenge this project is for

Zombie Recipients
​Which companies and nonprofits received large amounts of public funding and then ceased operations shortly after? Identify entities that went bankrupt, dissolved, or stopped filing within 12 months of receiving funding. Flag entities where public funding makes up more than 70-80% of total revenue, meaning they likely could not survive without it. The question is simple: did the public get anything for its money, or did it fund a disappearing act?

Claude Code Build Plan
Project structure
phantom-flow/
├── data/
│   └── grants.csv          # downloaded at start
├── src/
│   ├── ingest.py           # Agent 1
│   ├── zombie_detect.py    # Agent 2
│   ├── risk_profile.py     # Agent 3
│   ├── recovery_ai.py      # Agent 4 — Claude API
│   └── dashboard.py        # Streamlit app
├── .env                    # ANTHROPIC_API_KEY
└── requirements.txt

Phase 1 — Data & Detection (Hours 1–3)
ingest.py
python# GOAL: Download grants CSV, clean it, prepare for matching

import pandas as pd, requests, re
from rapidfuzz import fuzz

GRANTS_URL = "https://open.canada.ca/data/dataset/432527ab.../grants.csv"

def load_grants():
    df = pd.read_csv(GRANTS_URL, low_memory=False)
    # Keep: recipient_legal_name, agreement_value, agreement_start_date,
    #        recipient_province, owner_org, description_en
    df = df[df['agreement_value'] > 25000]   # filter noise
    df['name_clean'] = df['recipient_legal_name'].str.upper().str.strip()
    return df

def aggregate_by_entity(df):
    # Total funding per entity across all programs
    return df.groupby('name_clean').agg(
        total_awarded=('agreement_value', 'sum'),
        num_grants=('agreement_value', 'count'),
        last_award_date=('agreement_start_date', 'max'),
        province=('recipient_province', 'first'),
        programs=('owner_org', lambda x: list(x.unique()))
    ).reset_index()
zombie_detect.py
python# GOAL: Hit Corporations Canada API for each entity, find dissolved ones

import httpx, asyncio, time

CORP_API = "https://api.ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html"

async def lookup_corporation(name: str, client: httpx.AsyncClient):
    # Corporations Canada JSON API endpoint
    url = f"https://api.ised-isde.canada.ca/corporations/v1/search"
    r = await client.get(url, params={"query": name, "status": "all"})
    return r.json()

def is_zombie(corp_data, last_award_date) -> dict:
    status = corp_data.get("status", "")
    dissolution_date = corp_data.get("dissolution_date")
    if not dissolution_date or status == "Active":
        return {"is_zombie": False}
    
    from datetime import datetime
    d_date = datetime.fromisoformat(dissolution_date)
    a_date = datetime.fromisoformat(last_award_date)
    months_gap = (d_date - a_date).days / 30
    
    return {
        "is_zombie": 0 <= months_gap <= 24,
        "dissolution_date": dissolution_date,
        "months_to_dissolution": round(months_gap),
        "status": status
    }

Phase 2 — Risk Profiling (Hour 3–4)
risk_profile.py
python# GOAL: Score each zombie on 4 dimensions, flag Lazarus pattern

def score_entity(entity: dict, corp_data: dict, all_entities: pd.DataFrame) -> dict:
    score = 0
    flags = []

    # 1. Time proximity (max 40 pts)
    months = entity.get("months_to_dissolution", 99)
    proximity_score = max(0, 40 - (months * 1.5))
    score += proximity_score

    # 2. Funding concentration (max 25 pts)
    # Proxy: if >80% of awards in last 3 years = public funding
    num_programs = len(entity.get("programs", []))
    if num_programs >= 3:
        score += 25
        flags.append("Multi-program dependency")
    elif num_programs == 2:
        score += 15

    # 3. Amount (max 20 pts)
    awarded = entity.get("total_awarded", 0)
    if awarded > 1_000_000: score += 20
    elif awarded > 500_000: score += 12
    elif awarded > 100_000: score += 6

    # 4. Lazarus detection (max 15 pts)
    # Check if director appears in another active entity
    directors = corp_data.get("directors", [])
    lazarus = check_lazarus(directors, entity["name_clean"], all_entities)
    if lazarus:
        score += 15
        flags.append(f"Lazarus: director active in {lazarus}")

    return {
        "roi_score": min(100, round(score)),
        "flags": flags,
        "priority": "High" if score >= 65 else "Medium" if score >= 40 else "Low"
    }

def check_lazarus(directors, dissolved_name, all_entities):
    # Simple: check if director name appears in another entity
    # In a real build: hit beneficial ownership API per director
    for d in directors:
        d_name = d.get("name", "")
        matches = all_entities[
            all_entities['name_clean'].str.contains(
                d_name.split()[-1], na=False  # last name match
            )
        ]
        if len(matches) > 1:
            return matches.iloc[0]['name_clean']
    return None

Phase 3 — Claude Recovery Agent (Hour 4–5)
recovery_ai.py
python# GOAL: Claude generates case summaries + recovery ROI rationale

import anthropic

client = anthropic.Anthropic()

def generate_case_file(entity: dict) -> str:
    prompt = f"""You are a government enforcement analyst.
    
Entity: {entity['name_clean']}
Province: {entity['province']}
Total awarded: ${entity['total_awarded']:,.0f}
Programs: {', '.join(entity['programs'])}
Last award date: {entity['last_award_date']}
Dissolution date: {entity['dissolution_date']}
Months to dissolution: {entity['months_to_dissolution']}
Risk flags: {', '.join(entity['flags'])}
ROI score: {entity['roi_score']}/100

Write a 3-sentence enforcement case summary:
1. What happened (funding → dissolution timeline)
2. Key risk signals
3. Recovery recommendation (immediate referral / compliance letter / write-off)

Be direct. Use plain language a minister can act on."""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text

def estimate_recoverable(entity: dict) -> float:
    # Simple heuristic: proximity-weighted recovery estimate
    months = entity['months_to_dissolution']
    awarded = entity['total_awarded']
    # Closer to dissolution = less was spent = more recoverable
    recovery_rate = max(0.1, 1 - (months / 24) * 0.7)
    return round(awarded * recovery_rate)

Phase 4 — Dashboard (Hour 5–7)
dashboard.py
pythonimport streamlit as st
import pandas as pd

st.set_page_config(page_title="Phantom Flow", layout="wide")

@st.cache_data
def load_results():
    return pd.read_json("data/results.json")

df = load_results()

# Header metrics
col1, col2, col3, col4 = st.columns(4)
col1.metric("Entities flagged", len(df))
col2.metric("Total awarded", f"${df['total_awarded'].sum()/1e6:.1f}M")
col3.metric("Est. recoverable", f"${df['recoverable'].sum()/1e6:.1f}M")
col4.metric("High priority", len(df[df['priority']=='High']))

# Filters
priority = st.selectbox("Priority", ["All","High","Medium","Low"])
province = st.selectbox("Province", ["All"] + sorted(df['province'].unique()))

filtered = df.copy()
if priority != "All": filtered = filtered[filtered['priority']==priority]
if province != "All": filtered = filtered[filtered['province']==province]

# Ranked table
st.dataframe(
    filtered.sort_values('roi_score', ascending=False)[[
        'name_clean','priority','total_awarded',
        'recoverable','roi_score','months_to_dissolution','flags'
    ]],
    use_container_width=True
)

# Case file expander
selected = st.selectbox("View case file", filtered['name_clean'])
entity = filtered[filtered['name_clean']==selected].iloc[0]
with st.expander("AI Case Summary", expanded=True):
    st.write(entity['case_summary'])
    st.write(f"Recovery recommendation: **{entity['priority']} priority**")
    st.write(f"Estimated recoverable: **${entity['recoverable']:,.0f}**")

requirements.txt
anthropic
pandas
httpx
rapidfuzz
streamlit
python-dotenv

Hour-by-Hour on the Day
HourWhat gets doneDone when...0–1Download CSV, explore schema, confirm Corp Canada API works100 entities loaded1–2ingest.py complete, entities aggregated by nameClean entity table2–3zombie_detect.py — API lookups, flag dissolvedZombie list populated3–4risk_profile.py — scoring + Lazarus checkEvery zombie has a score4–5recovery_ai.py — Claude generates case files (top 50)Case summaries done5–7dashboard.py — Streamlit running locallyLive demo ready7–8Pick top 5 real cases, rehearse 3-min pitchStage ready

The 3-Minute Demo Script

"We downloaded 100,000 federal grant records this morning. We ran them against the Corporations Canada API. We found [N] entities that received public funding and dissolved within 24 months.
Here's the ranked list. The top entity — [name] — received $X across three federal programs, then dissolved 7 months later. Our AI agent spent 4 seconds on it. Here's what it said: [read case summary].
Scroll to the bottom — here's a case with a score of 17. We're telling you don't pursue it. The recovery cost exceeds the amount. That's the other half of the value.
This tool doesn't replace auditors. It tells them where to look first."
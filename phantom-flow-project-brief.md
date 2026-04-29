# Phantom Flow — Project Brief
## Agency 2026 Ottawa AI Hackathon

---

## What We're Building

**Phantom Flow** is an agentic AI intelligence platform that identifies Canadian organizations that received public funding and then dissolved — and ranks them by enforcement recovery ROI so auditors know exactly where to act first.

It answers one question government currently cannot answer at scale:

> *"Of the thousands of entities that took public money and disappeared, which ones are worth chasing — and which ones should we write off?"*

---

## The Problem

Canada has a documented, quantified zombie funding problem:

- **2,638 businesses** that received Canada Emergency Wage Subsidy (CEWS) payments are now insolvent
- **750 of those firms** received $145.9M in emergency funds — 352 of them already owed back taxes when the money arrived
- The federal grants CSV contains **100,000+ recipient records** — no automated system cross-references them against dissolution data
- The Auditor General flagged $27.4B in payments requiring further investigation; only $458M has been clawed back
- CRA Commissioner told Parliament it was not "worth the effort" to review $15B+ in potentially ineligible CEWS payments — **because they had no triage system**

The data exists. The legal authority exists. What's missing is the intelligence layer to prioritize enforcement.

---

## The Solution — 5-Agent Pipeline

```
Grants CSV + CEWS data
        │
        ▼
[Agent 1] Ingest & Normalize
  — Downloads federal grants CSV (open.canada.ca)
  — Aggregates total funding per entity across all programs
  — Cleans and standardizes entity names for matching
        │
        ▼
[Agent 2] Zombie Detector
  — Hits Corporations Canada live API for each entity
  — Flags: dissolved within 24 months of last award
  — Flags: pre-existing tax debt at time of funding
  — Flags: status = bankrupt / receivership / dissolved
        │
        ▼
[Agent 3] Risk Profiler
  — Scores public funding dependency ratio (>70% = high risk)
  — Detects Lazarus pattern: same director, new entity name
  — Clusters by sector, province, program overlap
  — Assigns risk tier: High / Medium / Low
        │
        ▼
[Agent 4] Recovery Prioritizer (Claude API)
  — Generates Recovery ROI score (0–100) per entity
  — Produces 3-sentence plain-English enforcement case summary
  — Estimates recoverable amount vs pursuit cost
  — Flags: "pursue immediately" / "compliance letter" / "write off"
        │
        ▼
[Agent 5] Dashboard (Streamlit)
  — Ranked enforcement table, filterable by province/type/priority
  — Click any entity → AI case file + action buttons
  — Summary metrics: total flagged, total recoverable, high priority count
  — Recovery projection: "if we pursue top 50, we recover $X"
```

---

## The Recovery ROI Score

The core innovation. Not just detecting zombies — but telling enforcement teams which ones to actually pursue.

| Dimension | Weight | What It Measures |
|---|---|---|
| Recoverable amount | 35% | Total awarded × closeness of dissolution to last payment |
| Evidence strength | 30% | Corporate records, OSB filing, pre-existing tax debt, news |
| Pursuit cost | 20% | Entity complexity, cross-jurisdiction, age of record |
| Public value lost | 15% | Jobs/deliverables promised vs verifiable evidence found |

**Score 80+** → Immediate enforcement referral  
**Score 40–79** → Compliance letter / batch review  
**Score <40** → Write-off (pursuit cost > recovery)

---

## Data Sources — All Public, No Auth Required

| Source | What It Provides | Access |
|---|---|---|
| open.canada.ca grants CSV | All federal grant/contribution recipients, amounts, dates | Direct CSV download |
| Corporations Canada API | Corporation status, dissolution date, directors, BN | Live REST API (ISED) |
| Beneficial Ownership Registry | Individuals with Significant Control (since Jan 2024) | Public search via API |
| Office of Superintendent of Bankruptcy | Insolvency and receivership filings | Public records |
| Canada's Business Registries (CBR) | Cross-provincial entity lookup | Web search |

**Scope note:** Corporations Canada API covers federally incorporated entities (500,000+ corporations). Provincial-only entities are out of scope for v1 — acknowledged as a known limitation.

---

## Tech Stack

```
Python 3.11+
├── pandas          — data ingestion and aggregation
├── httpx           — async Corporations Canada API calls
├── rapidfuzz       — fuzzy entity name matching
├── anthropic       — Claude claude-sonnet-4-6 for case file generation
├── streamlit       — dashboard UI
└── python-dotenv   — environment config

APIs
├── open.canada.ca/data/dataset/432527ab.../grants.csv
├── api.ised-isde.canada.ca/corporations/v1/search
└── api.anthropic.com/v1/messages (claude-sonnet-4-6)
```

---

## Project Structure

```
phantom-flow/
├── data/
│   ├── grants.csv              # downloaded at runtime
│   └── results.json            # scored entity output
├── src/
│   ├── ingest.py               # Agent 1 — load + normalize
│   ├── zombie_detect.py        # Agent 2 — Corp Canada API lookup
│   ├── risk_profile.py         # Agent 3 — scoring + Lazarus detection
│   ├── recovery_ai.py          # Agent 4 — Claude case files + ROI
│   └── dashboard.py            # Agent 5 — Streamlit UI
├── .env                        # ANTHROPIC_API_KEY
├── requirements.txt
└── README.md
```

---

## Why This Wins — Hackathon Judging Criteria

### 1. Clear alignment to Challenge #1 (Zombie Recipients)
The brief asks: *"Did the public get anything for its money, or did it fund a disappearing act?"*  
We answer this question for every entity in the federal grants dataset simultaneously — with a ranked, actionable output. No interpretation required.

### 2. Real data, real findings
We use actual federal open data, a live government API, and pre-validated Auditor General findings. The demo shows real entity patterns — not synthetic examples. Judges see genuine results from genuine data on the day.

### 3. Novel AI application — not a chatbot
The Recovery ROI Agent is genuinely new. No government tool currently cross-references grants data with dissolution records at scale and produces prioritized enforcement triage. This is a capability gap that exists today.

### 4. Agentic architecture
Five agents working in a coordinated pipeline is a genuine demonstration of agentic AI — each agent has a discrete task, passes structured output to the next, and the final agent (Claude) produces human-readable reasoning on top of machine scoring. This is what the hackathon organizers mean by "emerging agentic technologies."

### 5. Defensible methodology
Every score is calculated from explicit rules, not a black box. The scoring rubric is documented, explainable, and reproducible. When a judge asks "why is this entity ranked #1?" — the answer is one click away.

### 6. Political relevance in the room
The ministers and deputy ministers attending this event were responsible for CEWS, CERB, and the pandemic spending programs. This is not a theoretical accountability problem — it is the accountability problem they have been asked questions about in Parliament. The demo speaks directly to their mandate.

### 7. Actionable on Monday morning
The output is not a report or a recommendation. It is a prioritized enforcement queue. An auditor can open the dashboard, filter by province, click a case, and hand the AI-generated case file to legal by end of day. That's the real-world test for any government AI tool.

---

## The Pitch — 3 Minutes

> "We downloaded 100,000 federal grant records this morning. We ran them against the Corporations Canada API. We found entities that received public funding and dissolved within months.
>
> Here's the ranked list. Entity #1 received $2.3M across three federal programs, then dissolved 7 months after the last payment. Our AI agent spent 4 seconds on it. Here's the case file it wrote. [show screen]
>
> Now scroll to the bottom. Score of 17. We're telling you — don't pursue this one. The cost of recovery exceeds what you'd get back. That's the other half of the value: knowing what to walk away from.
>
> This tool doesn't replace auditors. It tells them where to look first. And right now, nobody is telling them that."

---

## Limitations — Acknowledged Upfront

| Limitation | Impact | Mitigation |
|---|---|---|
| Federal entities only (Corp Canada API) | Misses provincial-only orgs | Scope v1 to federal; note as future work |
| Name matching is fuzzy, not perfect | Some entities may not match | Accept ~80% match rate; flag unmatched |
| No direct CEWS recipient data (confidential) | Can't name individual CEWS cases | Use grants CSV as primary; cite AG aggregate numbers |
| Recovery estimates are heuristic | Not legally precise | Frame as triage tool, not audit finding |

---

## Build Timeline — One Day

| Hours | Task | Milestone |
|---|---|---|
| 0–1 | Download CSV, test Corp Canada API, set up repo | Environment confirmed |
| 1–2 | `ingest.py` — load, clean, aggregate entities | Entity table ready |
| 2–3 | `zombie_detect.py` — API lookups, flag dissolved | Zombie list populated |
| 3–4 | `risk_profile.py` — score + Lazarus detection | Every zombie scored |
| 4–5 | `recovery_ai.py` — Claude case files (top 50) | Case summaries done |
| 5–7 | `dashboard.py` — Streamlit running, filters working | Live demo ready |
| 7–8 | Select top 5 real cases, rehearse pitch | Stage ready |

---

## What Success Looks Like

At end of day, we can stand on stage and say:

- We processed **[N]** federal grant recipients
- We identified **[N]** zombie entities using live government data
- We ranked them by recovery ROI — top case is worth **$[X]** and here's why
- We can tell government which **[N]** cases to pursue and which to write off
- The total estimated recoverable from high-priority cases is **$[X]M**
- A working tool is running right now that any auditor can use

---

*Challenge: #1 — Zombie Recipients | Team: [Team Name] | Agency 2026 Ottawa*

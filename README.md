# Phantom Flow — Zombie Grant Recipients

**Ottawa AI Hackathon 2026 · Zombie Recipients Challenge**

Phantom Flow identifies Canadian companies and nonprofits that received federal grants and then dissolved or went inactive within 12 months — "zombie recipients" — and ranks them by recovery ROI for enforcement action.

---

## Live Demo

**[https://agency-hack-egency.vercel.app](https://agency-hack-egency.vercel.app)** — no install required, runs in the browser with 20 demo entities pre-loaded.

---

## What It Does

The Canadian government publishes ~200K rows of proactive disclosure grant data at open.canada.ca. Phantom Flow:

1. **Ingests** the full grants CSV (or uses bundled demo data)
2. **Matches** each recipient against Corporations Canada using fuzzy name matching
3. **Detects** zombie patterns — dissolved/struck-off within 12 months of last award
4. **Scores** each case by a 4-component ROI formula
5. **Ranks** them in an enforcement queue with AI-generated forensic narratives

---

## Getting Started

### Option A — Vercel (zero install)

Open **https://agency-hack-egency.vercel.app**

The app loads with 20 representative demo entities automatically. No API key required.

### Option B — Local full pipeline

**Requirements:** Python 3.11+, pip

```bash
# Clone
git clone https://github.com/Adithiyan/agency-hack-egency.git
cd agency-hack-egency

# Install dependencies
pip install -r requirements.txt

# (Optional) Set API keys for AI case summaries
# Create .env with:
# GEMINI_API_KEY=your_key_here
# PHANTOM_FLOW_LLM_PROVIDER=gemini

# Start the server
PYTHONPATH=src python server.py
```

Open **http://localhost:8765**

---

## How to Use

### Step 1 — Load Data

**On Vercel:** Data loads automatically (20 demo entities).

**Locally:** Click **Run demo pipeline** in the sidebar for instant demo data, or **Run live (real data)** to download the full 200K-row Government of Canada grants dataset (~2–5 min).

### Step 2 — Browse the Enforcement Queue

The **Queue** tab shows zombie candidates ranked by ROI score (0–100):

| Column | Description |
|--------|-------------|
| Zombie | Red dot = dissolved ≤12 months after last award |
| Prov | Recipient province |
| Awarded | Total federal grants received |
| Recoverable | Estimated recoverable amount |
| Δ Mo | Months between last award and dissolution |
| ROI Score | Enforcement priority score with bar chart |
| Recommendation | Refer / Letter / Review / Monitor / Write off |

Click any row to open the full **Case Detail** panel with AI forensic narrative.

### Step 3 — AI Investigator

Click the **AI Investigator** button in the toolbar. The AI:

- Reviews the top 8 zombie candidates by ROI score
- Selects the single most actionable case
- Writes a 200-word CBC-style forensic narrative
- Lists 3–5 specific red flags with data citations

Works with a Gemini API key (free at aistudio.google.com) or falls back to a deterministic template.

### Step 4 — Filter & Search

Use the sidebar to filter by province, match confidence, funding dependency, minimum ROI score, or zombies-only. Click column headers to sort.

### Step 5 — Entity Lookup

Go to **Entity Lookup** tab. Type any company or nonprofit name to check its corporate status, dissolution date, and ROI score. Works offline using loaded data.

### Step 6 — Upload Your Own Data

Go to **Upload CSV** tab. Upload any Government of Canada proactive disclosure grants CSV (download link provided in the tab), then click **Upload & Run**.

### Step 7 — Export

Click **Export CSV** to download the current filtered results as a spreadsheet.

### Step 8 — Ask AI

Click the **Ask AI** button (bottom-right corner, green pulsing dot). Ask anything about the data or methodology:

- *"What is a zombie recipient?"*
- *"How is the ROI score calculated?"*
- *"Show me the top 3 cases"*
- *"Which province has the most zombies?"*
- *"What's the difference between demo and live data?"*

Works even before data is loaded.

---

## ROI Score Formula

| Component | Weight | Description |
|-----------|--------|-------------|
| Recoverable amount | 35 pts | Total awarded × zombie confidence multiplier |
| Evidence strength | 30 pts | Match confidence × dissolution timing sharpness |
| Pursuit cost | 20 pts | Inverse of organizational complexity |
| Public exposure | 15 pts | Funding size relative to dataset peers |

| Score | Action |
|-------|--------|
| ≥ 70 | Immediate referral |
| 50–69 | Compliance letter |
| 30–49 | Review |
| < 30 | Monitor or write off |

---

## Zombie Detection Logic

An entity is flagged **zombie** if:

1. It received ≥ $25,000 in federal grants
2. A corporate match is found in Corporations Canada (confidence ≥ 0.5)
3. The dissolution/strike-off date falls within **12 months** of the last grant award

---

## Data Sources

| Source | Description |
|--------|-------------|
| [open.canada.ca grants](https://open.canada.ca/data/dataset/432527ab-7aac-45b5-81d6-7597107a7013/resource/1d15a62f-5656-49ad-8c88-f40ce689d831/download/grants.csv) | ~200K rows of proactive disclosure grants since 2011 |
| Corporations Canada | Federal corporate registry — status, dissolution dates |

---

## Project Structure

```
├── web/                    # Static frontend (Vercel)
│   ├── index.html          # Single-page app
│   ├── app.js              # All UI logic (vanilla JS)
│   ├── styles.css          # Component styles
│   ├── tailwind.css        # Compiled Tailwind utilities
│   └── data/results.json   # Bundled 20-entity demo dataset
│
├── src/phantom_flow/       # Python pipeline
│   ├── pipeline.py         # End-to-end runner
│   ├── ingest.py           # Grants CSV download + aggregation
│   ├── normalize.py        # Name normalization
│   ├── matching.py         # Fuzzy corporate matching (rapidfuzz)
│   ├── scoring.py          # ROI scoring + zombie detection
│   ├── corporations.py     # Corporations Canada lookup
│   └── llm.py              # LLM abstraction (Gemini/Claude/Groq)
│
├── server.py               # Flask dev server + API
├── data/demo/              # Demo fixtures
└── vercel.json             # Static deployment config
```

---

## API Endpoints (local server)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Server health + settings |
| `/api/results` | GET | Current processed results |
| `/api/run` | POST | Trigger pipeline (`{demo: true/false}`) |
| `/api/pipeline-status` | GET | Poll running pipeline |
| `/api/upload` | POST | Upload grants CSV |
| `/api/lookup` | POST | Single entity lookup + score |
| `/api/investigate` | POST | AI autonomous case selection |
| `/api/chat` | POST | AI assistant chat |
| `/api/settings` | POST | Update API key + settings |

---

## Environment Variables

```bash
PHANTOM_FLOW_LLM_PROVIDER=gemini      # gemini | claude | groq | none
GEMINI_API_KEY=                        # From aistudio.google.com (free)
GEMINI_MODEL=gemini-2.5-flash
ANTHROPIC_API_KEY=                     # Optional: Claude
PHANTOM_FLOW_USE_LIVE_CORP=false       # true = live corp registry API
PHANTOM_FLOW_LLM_CASE_LIMIT=25        # Max AI summaries per run
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla JS, Tailwind CSS v3, Chart.js |
| Backend | Python 3.11, Flask |
| Matching | rapidfuzz (fuzzy string matching) |
| Data | pandas, httpx |
| AI summaries | Gemini 2.5 Flash (OpenAI-compatible endpoint) |
| Deployment | Vercel static + optional local Flask |

---

## Ottawa AI Hackathon — Zombie Recipients Challenge

> Identify Canadian companies and nonprofits that received large public grants and dissolved within 12 months. Build a tool that ranks them by recovery potential.

Phantom Flow addresses this with:
- Full open.canada.ca grants dataset ingestion
- Fuzzy matching against Corporations Canada
- 12-month zombie window detection (per challenge spec)
- 4-component ROI scoring for enforcement prioritization
- AI forensic narratives (Gemini 2.5 Flash)
- Responsive enforcement triage dashboard
- Zero-install Vercel deployment with bundled demo data

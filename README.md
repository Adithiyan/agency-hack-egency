# Phantom Flow

Enforcement triage for Canadian public grants. Match grant recipients against
federal corporate status records, flag entities that dissolved within a short
window after their last award, and rank by recovery ROI with an evidence-backed
case file for each entry.

> **Scope.** Phantom Flow surfaces public-record patterns. It does not assert
> wrongdoing. Confirm every case against authoritative sources before acting.

## Quickstart

```bash
# 1. Clone and enter the repo
cd phantom-flow

# 2. Install dependencies (Python 3.10+)
python -m pip install -r requirements.txt

# 3. Configure secrets (optional; AI summaries fall back to a template if unset)
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY

# 4. Run the demo pipeline (uses bundled offline fixtures)
PYTHONPATH=src python -m phantom_flow.pipeline --demo --top 10

# 5a. Launch the static responsive dashboard (recommended for the demo)
python -m http.server 8765
# then open http://localhost:8765/web/

# 5b. Or launch the Streamlit dashboard
streamlit run app/streamlit_app.py
```

The pipeline writes both `data/processed/results.json` (for Streamlit) and
`web/data/results.json` (for the static dashboard) on every run.

The demo path requires no live API access. It reads
`data/demo/grants_demo.csv` and `data/demo/corp_records.json`, writes
`data/processed/results.json`, and the Streamlit app loads from there.

## What it does

1. **Ingest** the federal grants and contributions dataset (or a local CSV).
2. **Aggregate** awards by normalized recipient name.
3. **Match** each recipient against Corporations Canada records (live, cached,
   or demo fixture).
4. **Flag zombies**: dissolved, inactive, bankrupt, struck, or cancelled within
   a configurable window (default 24 months) after the last award.
5. **Score** each case on four visible components (recoverable amount,
   evidence strength, pursuit cost, public value exposure) summing to 100.
6. **Recommend** an action: `immediate referral`, `compliance letter`,
   `review`, or `write off`.
7. **Summarize** the top cases with Claude using only structured facts (with a
   no-API fallback so the demo never hard-fails).

## Project layout

```
phantom-flow/
├── web/                          # static responsive dashboard (HTML+Tailwind)
│   ├── index.html                # mobile-first; cards on mobile, table on desktop
│   ├── app.js                    # vanilla JS, DOM-built (no innerHTML / no XSS)
│   ├── styles.css                # supplementary styles (pills, ROI bar, a11y)
│   └── data/results.json         # mirrored from data/processed by the pipeline
├── design-system/phantom-flow/   # MASTER.md (design tokens + rationale)
├── app/
│   └── streamlit_app.py          # alternate Streamlit dashboard
├── src/phantom_flow/
│   ├── ingest.py                 # CSV download, load, aggregate
│   ├── normalize.py              # name canonicalization
│   ├── corporations.py           # corporate lookup + cache + fixture
│   ├── matching.py               # fuzzy match + confidence label
│   ├── scoring.py                # ROI score with breakdown
│   ├── case_writer.py            # Claude summary + fallback
│   ├── pipeline.py               # end-to-end runner (`-m phantom_flow.pipeline`)
│   └── config.py                 # env-driven settings
├── data/
│   ├── raw/                      # downloaded grants CSV (gitignored)
│   ├── interim/                  # corp lookup + summary caches
│   ├── processed/                # results.json, entities.json
│   └── demo/                     # offline fixtures + grants_demo.csv
├── tests/
│   ├── test_normalize.py
│   ├── test_scoring.py
│   └── test_pipeline.py          # runs the full demo pipeline end-to-end
├── pyproject.toml / requirements.txt
└── .env.example
```

## Scoring rubric

Each case carries a `score_breakdown` dict so the dashboard can show the math.

| Component               | Max | Drives                                       |
| ----------------------- | --: | -------------------------------------------- |
| Recoverable amount      | 35  | Award size and short award-to-dissolution gap |
| Evidence strength       | 30  | Match confidence + presence of dissolution   |
| Pursuit cost            | 20  | Penalizes weak matches and stale cases       |
| Public value exposure   | 15  | Multi-program dependency + total amount      |

Recommendation thresholds:

- `>= 80` and confidence `medium`/`high`: **immediate referral**
- `40 - 79` and confidence `medium`/`high`: **compliance letter**
- confidence `low` or `none`: **review**
- `< 40`: **write off**

## Running tests

```bash
PYTHONPATH=src python -m pytest tests/
```

## Configuration

Environment variables (see `.env.example`):

| Var                            | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `ANTHROPIC_API_KEY`            | Enables Claude case summaries                 |
| `PHANTOM_FLOW_GRANTS_URL`      | Override the grants CSV download URL          |
| `PHANTOM_FLOW_GRANTS_CSV`      | Local cached CSV path                         |
| `PHANTOM_FLOW_USE_LIVE_CORP`   | `true` to call the Corporations Canada API   |

## Limitations

- The grants dataset names recipients but not directors or beneficial owners.
- Corporate name fuzzy matching can produce false positives; low-confidence
  cases are routed to **review**, not enforcement.
- "Public funding dependency" (the >70% revenue threshold in the challenge
  brief) cannot be proven from grant data alone. Phantom Flow reframes this as
  *public funding exposure* derived from program count and total awarded.
- Live Corporations Canada access can require session cookies. The demo path
  uses a deterministic fixture so the pitch never depends on a live API.

## License

See [LICENSE](LICENSE).

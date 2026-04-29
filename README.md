# Phantom Flow

Phantom Flow is an evidence-backed triage tool for the Zombie Recipients challenge: it ranks organizations that received public grants or contributions and then dissolved soon after, so auditors can decide which cases are worth reviewing first.

The current build is a runnable MVP with representative cached demo data. It is structured so live Government of Canada grants data and Corporations Canada records can be connected behind the same pipeline.

## What It Does

- Aggregates grant and contribution awards by recipient.
- Normalizes entity names for matching.
- Matches recipients to federal corporate records.
- Flags dissolved, inactive, bankrupt, insolvent, or receivership records within a 24-month window.
- Scores each case with an explainable Recovery ROI model.
- Generates a constrained case summary from structured evidence, using deterministic templates by default or Groq/Gemini/Claude when configured.
- Presents a polished web enforcement console with filters, evidence rows, score breakdowns, charts, and CSV export.

## Quickstart

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:PYTHONPATH="src"
python -m phantom_flow.pipeline
python serve_dashboard.py
```

If dependencies are already installed, the minimum local run is:

```powershell
$env:PYTHONPATH="src"
python -m phantom_flow.pipeline
python serve_dashboard.py
```

Open [http://localhost:4173/web/](http://localhost:4173/web/).

The older Streamlit prototype is still available:

```powershell
$env:PYTHONPATH="src"
streamlit run app/streamlit_app.py
```

## Project Structure

```text
app/
  streamlit_app.py          Dashboard
data/
  demo/                     Representative demo inputs
  processed/                Generated dashboard data
docs/
  data-validation.md        Source validation notes and risks
src/phantom_flow/
  ingest.py                 Grant loading and aggregation
  matching.py               Entity matching
  scoring.py                Recovery ROI scoring
  case_writer.py            Evidence-constrained case summaries
  pipeline.py               CLI pipeline
tests/                      Focused unit tests
web/                        Polished static dashboard
```

## Scoring Model

The Recovery ROI score is transparent and stored with every case:

| Component | Max Points |
|---|---:|
| Recoverable amount | 35 |
| Evidence strength | 30 |
| Pursuit cost | 20 |
| Public value exposure | 15 |

Recommendations:

- `80+`: immediate referral
- `40-79`: compliance letter or batch review
- `<40`: write off or monitor

The score is a triage signal, not a finding of wrongdoing.

## Demo Caveats

- Current demo data is representative and intentionally labeled as such.
- Live data validation is the next milestone.
- Federal corporation records do not cover provincial-only entities.
- Public funding dependency cannot be proven from grants data alone; the MVP treats this as public funding exposure unless external revenue data is added.
- AI summaries are constrained to known structured facts.

## Development

Run the pipeline:

```powershell
$env:PYTHONPATH="src"
python -m phantom_flow.pipeline
```

Run top-case summaries with Groq for testing:

```powershell
$env:PYTHONPATH="src"
$env:GROQ_API_KEY="..."
python -m phantom_flow.pipeline --llm-provider groq --llm-limit 5
```

Run final summaries with Gemini or Claude:

```powershell
$env:PYTHONPATH="src"
$env:GEMINI_API_KEY="..."
python -m phantom_flow.pipeline --llm-provider gemini --llm-limit 10

$env:ANTHROPIC_API_KEY="..."
python -m phantom_flow.pipeline --llm-provider claude --llm-limit 10
```

Agent and model details are documented in [docs/agents-and-models.md](docs/agents-and-models.md).

Run tests:

```powershell
$env:PYTHONPATH="src"
python -m pytest -q
```

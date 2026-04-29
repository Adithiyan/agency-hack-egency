# Phantom Flow Winning Hackathon Plan

## Document Review

### `README.md`

Current state: placeholder only.

Needed before judging:
- Replace with a polished project overview.
- Include a quickstart that works from a clean checkout.
- Explain the data pipeline, scoring model, limitations, and demo flow.
- Add screenshots or a short demo GIF once the dashboard exists.

### `plan.md`

Current state: useful build sketch, but not production-ready.

Issues to fix:
- Markdown has encoding artifacts that make the file look unpolished.
- Several code blocks are malformed, for example `python# GOAL`.
- The proposed grant CSV URL is incomplete.
- The Corporations Canada API endpoint and auth assumptions need validation.
- The scoring model in the code sketch does not match the weighted rubric in the brief.
- The "public funding dependency ratio" cannot be proven from grants data alone unless external revenue data is added or the metric is reframed as "public funding exposure."
- Director and beneficial ownership access may require API subscription/login, so Lazarus detection needs a fallback.

### `phantom-flow-project-brief.md`

Current state: strong story and judging alignment.

Strengths:
- Clear problem statement.
- Strong government relevance.
- Good "not a chatbot" AI framing.
- Judges can understand the value in one screen: ranked recovery triage.

Risks:
- Some claims depend on sources that are not cited in the repo.
- CEWS examples are compelling but individual CEWS recipient data is not available for naming cases, so the demo must avoid implying it can identify confidential CEWS cases.
- The brief promises five agents and several data sources. For a hackathon, the winning version should do fewer things reliably and visibly.
- The dashboard needs evidence traceability: every case should show exactly which data points led to the score.

## Winning Strategy

Build a defensible enforcement triage demo, not a broad investigation platform.

The judging hook should be:

> "We converted public grant records and federal corporate status records into a ranked enforcement queue, with evidence-backed case summaries and a clear recommendation for each entity."

The product should optimize for:
- Real records over synthetic examples.
- Explainable scoring over opaque AI.
- A polished dashboard over many half-working agents.
- Evidence links and confidence labels over aggressive claims.
- A memorable top-case story backed by raw data.

## Core MVP

### Must Have

1. Data ingestion from the Government of Canada grants and contributions dataset.
2. Entity normalization and aggregation by recipient name.
3. Federal corporation lookup or imported corporation dataset matching.
4. Zombie flag: dissolved, inactive, bankrupt, or similar status within a configurable window after last award.
5. Recovery ROI score with visible components.
6. Claude-generated case summary constrained to verified facts.
7. Streamlit dashboard with ranked table, filters, case detail, and export.
8. Demo dataset cached locally so the pitch works without live API failures.

### Should Have

1. Confidence score for entity matching.
2. Evidence panel showing grant rows, corporate status, dissolution date, and scoring math.
3. "Pursue / letter / write off" recommendation.
4. Province, department, program, sector, and amount filters.
5. Top 5 case storyboard for the live pitch.

### Nice To Have

1. Lazarus/director matching if director data is accessible in time.
2. OSB bankruptcy enrichment.
3. News/web evidence enrichment.
4. Network graph of related entities/directors.
5. One-click case file export to Markdown or PDF.

## Implementation Plan

### Phase 0: Truth Check and Scope Lock

Goal: validate data availability before writing the full app.

Tasks:
- Find the actual grants and contributions CSV/API download endpoint.
- Download a small sample and confirm columns.
- Validate Corporations Canada access path, auth, rate limits, and response shape.
- Decide whether v1 uses live API, monthly/open JSON dataset, or a cached enriched sample.
- Collect citations for the problem claims used in the pitch.
- Define what "zombie" means in code:
  - dissolved within 12 months for strict challenge alignment;
  - optionally 24 months as an expanded view.

Deliverable:
- `docs/data-validation.md` with source links, schemas, limits, and chosen fallback.

### Phase 1: Repository Foundation

Goal: make the repo runnable and judge-friendly.

Tasks:
- Create app structure:
  - `src/phantom_flow/ingest.py`
  - `src/phantom_flow/corporations.py`
  - `src/phantom_flow/matching.py`
  - `src/phantom_flow/scoring.py`
  - `src/phantom_flow/case_writer.py`
  - `src/phantom_flow/pipeline.py`
  - `app/streamlit_app.py`
  - `data/raw/`, `data/interim/`, `data/processed/`, `data/demo/`
  - `tests/`
- Add `pyproject.toml` or `requirements.txt`.
- Add `.env.example`.
- Add `README.md` quickstart.
- Add deterministic sample data for tests and demo fallback.

Deliverable:
- Clean install and `streamlit run app/streamlit_app.py` works.

### Phase 2: Data Pipeline

Goal: produce a trustworthy `results.json`.

Tasks:
- Load grants data.
- Normalize names:
  - uppercase;
  - strip legal suffixes;
  - normalize punctuation;
  - keep original display names.
- Filter to actionable recipient types and award amounts.
- Aggregate by normalized entity:
  - total awarded;
  - number of grants;
  - first and last award date;
  - departments;
  - programs;
  - provinces;
  - sample descriptions.
- Match entities to corporate records:
  - exact name first;
  - fuzzy name second;
  - require confidence threshold;
  - keep unmatched records visible.
- Cache API responses to disk.

Deliverable:
- `data/processed/entities.json`
- `data/processed/matches.json`
- `data/processed/results.json`

### Phase 3: Scoring Model

Goal: make every ranking explainable.

Use a score with visible components:

| Component | Weight | Implementation |
|---|---:|---|
| Recoverable amount | 35 | Higher awarded amount and shorter award-to-dissolution window |
| Evidence strength | 30 | Match confidence, corporate status confidence, dissolution date present |
| Pursuit cost | 20 | Penalize old cases, weak matches, cross-jurisdiction uncertainty |
| Public value exposure | 15 | Program count, award concentration, description/category risk |

Tasks:
- Implement `score_entity(entity)`.
- Store component scores, not only totals.
- Add recommendation thresholds:
  - `80+`: immediate referral;
  - `40-79`: compliance letter or batch review;
  - `<40`: write off / low priority.
- Add a confidence label separate from risk score.

Deliverable:
- Each row has `roi_score`, `score_breakdown`, `recommendation`, `confidence`, and `flags`.

### Phase 4: AI Case Writer

Goal: use AI where it clearly helps the demo.

Tasks:
- Generate summaries only from structured facts.
- Include a strict prompt rule: do not infer fraud, wrongdoing, or unrecoverable facts.
- Generate:
  - 3-sentence executive summary;
  - recommended action;
  - evidence checklist;
  - caveats.
- Cache generated summaries.
- Provide a no-API fallback summary template.

Deliverable:
- Top 25 or top 50 case summaries are ready before demo.

### Phase 5: Dashboard

Goal: make the first screen instantly persuasive.

Dashboard layout:
- Top metrics:
  - entities analyzed;
  - zombie candidates;
  - high-priority cases;
  - total awarded;
  - estimated recoverable.
- Ranked enforcement queue:
  - entity;
  - province;
  - total awarded;
  - status;
  - months to dissolution;
  - ROI score;
  - recommendation;
  - confidence.
- Case detail:
  - AI summary;
  - score breakdown;
  - timeline;
  - grant evidence rows;
  - corporate evidence;
  - caveats.
- Filters:
  - recommendation;
  - province;
  - department;
  - score range;
  - confidence.

Design priorities:
- Dense, official, audit-tool feel.
- Avoid a marketing landing page.
- Show evidence and action in the first viewport.
- Use color sparingly: red for immediate referral, amber for review, gray for write-off.

Deliverable:
- A polished Streamlit app with stable demo data.

### Phase 6: Validation and Pitch

Goal: prevent embarrassing demo failure.

Tasks:
- Write unit tests for normalization, matching, and scoring.
- Run pipeline on a fixed sample.
- Manually inspect top 10 cases.
- Remove or downgrade any case with weak match confidence.
- Create `docs/demo-script.md`.
- Capture one screenshot for the README.
- Rehearse exactly three minutes.

Deliverable:
- Demo can run offline from cached data.
- Pitch names only cases with defensible evidence.

## Demo Script

1. "We loaded the public grants and contributions dataset and grouped awards by recipient."
2. "We matched those recipients against federal corporate status records."
3. "The dashboard turns that into an enforcement queue ranked by recovery ROI."
4. "This top case received `$X`, dissolved `Y` months later, and has a high-confidence match."
5. "The AI summary is not inventing facts. It is summarizing this evidence panel."
6. "The bottom of the list matters too: these are cases we recommend not pursuing because the recovery ROI is poor."
7. "This does not replace auditors. It gives them a defensible first-pass triage list."

## Risk Register

| Risk | Severity | Mitigation |
|---|---:|---|
| Corporation API requires subscription or rate-limits live demo | High | Cache responses and support imported public dataset fallback |
| Name matching creates false positives | High | Show confidence, keep evidence visible, suppress low-confidence cases from top demo |
| Public funding dependency ratio cannot be proven | High | Reframe as public funding exposure unless revenue data is added |
| CEWS individual recipients are unavailable | Medium | Use CEWS only as context, not as named-case evidence |
| AI summary overstates wrongdoing | High | Use constrained prompt and include caveats |
| Dashboard looks like a data table only | Medium | Add metrics, timeline, score breakdown, and case narrative |
| Live internet fails | High | Ship cached demo data and local run path |

## Immediate Next Steps

1. Validate the grants dataset endpoint and schema.
2. Validate Corporations Canada API access and choose fallback.
3. Rewrite `README.md` and clean Markdown encoding artifacts.
4. Scaffold the Python project.
5. Implement ingestion, normalization, scoring, and cached demo output.
6. Build the Streamlit dashboard around the ranked enforcement queue.
7. Add case summaries and polish the pitch.

## Definition of Done

The project is hackathon-ready when:
- A judge can run it from the README.
- The dashboard loads in under 10 seconds from cached data.
- Top cases have evidence, confidence, and score breakdowns.
- The pitch does not depend on unverified claims.
- The app works without live API calls during the demo.
- The repo clearly states limitations and responsible-use caveats.

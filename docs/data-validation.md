# Data Validation Notes

## Current Status

This repository currently ships with representative cached demo data so the product can be built and demonstrated without live network or API failures.

Before presenting live findings, validate and document the production sources below.

## Grants and Contributions

Target source: Government of Canada proactive disclosure grants and contributions data.

Validation tasks:
- Confirm direct CSV or API download endpoint.
- Confirm current schema and required columns:
  - recipient legal name;
  - agreement value;
  - agreement start date;
  - recipient province;
  - department or owner organization;
  - program name;
  - description.
- Confirm record count and refresh cadence.
- Save a small source sample in `data/raw/` only if licensing and size are appropriate.

## Federal Corporation Records

Target source: Corporations Canada federal corporation records.

Validation tasks:
- Confirm whether the selected endpoint requires API subscription/login.
- Confirm rate limits and demo-safe caching approach.
- Confirm search response fields:
  - legal name;
  - corporation number;
  - business number;
  - status;
  - dissolution date;
  - directors, if available.
- Confirm whether director data is accessible without extra authorization.

## Known Limits

- Federal corporation records exclude provincial and territorial corporations.
- Name matching can create false positives; top cases must use match confidence and evidence review.
- CEWS individual recipients should not be named unless a public source supports the specific case.
- Recovery estimates are heuristic and should be presented as prioritization, not legal recovery values.

## Implementation Choice

The MVP uses a cached data path first. Live API access should write cached raw responses and then run the same pipeline against those files. This keeps the demo stable and makes the evidence auditable.

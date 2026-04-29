# Data Validation — Phantom Flow

## 1. Grants and Contributions Dataset

**Source:** Government of Canada — Proactive Disclosure  
**Dataset ID:** `432527ab-7aac-45b5-81d6-7597107a7013`  
**CSV URL:** `https://open.canada.ca/data/dataset/432527ab-7aac-45b5-81d6-7597107a7013/resource/1d15a62f-5656-49ad-8c88-f40ce689d831/download/grants.csv`  
**Schema URL:** `https://open.canada.ca/data/recombinant-published-schema/grants.json`  
**Format:** CSV, UTF-8 BOM, ~200k+ rows (full dataset)  
**Update cadence:** Quarterly proactive disclosure  
**Validated:** 2026-04-29 — status 206, Content-Type: text/csv, header confirmed

### Confirmed columns (subset used)

| Column | Type | Notes |
|---|---|---|
| `recipient_legal_name` | text | Legal name as registered |
| `recipient_type` | choice | F=For-profit, N=Nonprofit, A=Indigenous, S=Academia, G=Govt, P=Individual |
| `recipient_business_number` | text | Canada Revenue Agency BN (optional) |
| `agreement_value` | numeric | CAD, can be 0 for nil reports |
| `agreement_start_date` | date | ISO format YYYY-MM-DD |
| `agreement_end_date` | date | ISO format YYYY-MM-DD |
| `recipient_province` | text | Province/territory code |
| `owner_org` | text | Departmental slug (e.g. `ised`, `fednor`) |
| `owner_org_title` | text | Full department name |
| `description_en` | text | Agreement description |
| `naics_identifier` | text | NAICS code for sector |

### Filtering decisions

- `agreement_value >= $25,000` — removes nil/token entries
- `recipient_type IN (F, N, A, O)` — for-profit, nonprofits, Indigenous, Other; excludes governments and academia (challenge focus is on companies + nonprofits)
- `recipient_legal_name` non-null

### Limitations

- No total revenue data — public funding dependency (>70-80%) **cannot be proven directly**. We proxy it via funding concentration (years × departments).
- Recipient names are not standardized across departments. Fuzzy matching required.
- Large grants may be split across multiple rows (amendments).

---

## 2. Corporations Canada

**Source:** Innovation, Science and Economic Development Canada (ISED)  
**Search UI:** `https://ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html`  
**API endpoint:** `https://ised-isde.canada.ca/cc/lgcy/api/v1/searchCompany` (best-effort; no published auth spec)

### Status field values observed

| Status | Zombie? |
|---|---|
| Active | No |
| Dissolved | Yes |
| Bankrupt | Yes |
| Inactive | Yes |
| Cancelled | Yes |
| Struck | Yes |

### Access limitations

- The API does not require an API key for basic search but may rate-limit or redirect in automated contexts.
- Director / beneficial ownership endpoints require authentication (CanadianBusinessRegistry subscription).
- **Fallback:** Demo fixture at `data/demo/corp_records.json` — deterministic, works offline, used when `PHANTOM_FLOW_USE_LIVE_CORP=false`.

---

## 3. Zombie Definition (Challenge Alignment)

> "Identify entities that went bankrupt, dissolved, or stopped filing **within 12 months** of receiving funding."

| Config key | Value | Meaning |
|---|---|---|
| `zombie_window_months` | **12** | Challenge strict window |
| `zombie_window_extended` | 24 | Broader view (flagged separately) |

Zombie flag logic:
1. Corporate status is Dissolved / Bankrupt / Inactive / Cancelled / Struck, AND
2. Dissolution date is within `zombie_window_months` of last award date (allow ±3 months data lag)

---

## 4. Public Funding Dependency Proxy

> "Flag entities where public funding makes up more than 70-80% of total revenue."

No total revenue data is available in the grants dataset or Corporations Canada.

**Proxy approach used:**

| Signal | Interpretation |
|---|---|
| 3+ consecutive years of grants from 3+ departments | HIGH dependency — likely cannot survive without it |
| 3+ years OR 2+ years from 2+ departments | HIGH |
| 2 years from 2+ departments | MEDIUM dependency |
| 1 year, 1 department | LOW |

These thresholds conservatively identify entities whose multi-year, multi-departmental dependency pattern suggests grants constitute the majority of revenue. Presentations should note this is a proxy, not a direct revenue measurement.

---

## 5. Chosen Data Path for Demo

| Step | Path |
|---|---|
| Grants | `data/demo/grants_demo.csv` (offline) or live download |
| Corp lookups | `data/demo/corp_records.json` (offline fixture) or `PHANTOM_FLOW_USE_LIVE_CORP=true` |
| Results | `data/processed/results.json` → mirrored to `web/data/results.json` |
| Case summaries | `data/interim/case_summaries.json` (cached after first Claude call) |

The demo path requires no live internet and runs in < 5 seconds.

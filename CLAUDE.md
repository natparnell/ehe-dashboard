# EHE Dashboard — Claude Knowledge File

## Overview

Interactive dashboard on the DfE "Elective Home Education" census statistics for England, with a focus on the South West region and the Cornwall, Plymouth and Devon local authorities (the WeST footprint). Built January 2026; cloned back to this Mac on 12/07/2026 after the local copy went missing (only the GitHub repo survived).

- **Live URL:** https://ehe-dashboard.onrender.com/
- **Hosting:** Render, free tier — cold starts take ~30 seconds after idle
- **GitHub repo:** `natparnell/ehe-dashboard` — **PUBLIC**. Do not add anything WeST-internal (pupil-level data, credentials, internal commentary) without making the repo private first.
- **Deploy:** presumed auto-deploy on push to `main` (standard Render setup) but NOT confirmed from this machine — check the Render dashboard before relying on it.
- **Status (12/07/2026):** Nat plans to refactor this app and move it (new context window). Treat the current code as the starting point, not a settled architecture.

## Stack

Python + Dash 2.14+ / dash-bootstrap-components (Flatly theme) + Plotly + pandas, served by gunicorn in production. This matches Nat's preferred AAR analytics stack (see `~/CLAUDE.md`, "Default stack for dashboards"), except there is no DuckDB layer: the CSV is loaded straight into a pandas DataFrame at import time.

## Run locally

```bash
cd ~/ehe-dashboard
pip install -r requirements.txt   # or use a venv
python app.py                     # Dash dev server on http://127.0.0.1:8050
```

Port comes from the `PORT` env var (Render sets it) with 8050 as the local default. `DEBUG` env var toggles debug mode (defaults to True locally). `server = app.server` is exposed for gunicorn.

## File map

| File | Purpose |
|---|---|
| `app.py` | The whole app, ~1,270 lines: data loading, aggregation helpers, chart builders, layout, callbacks |
| `ehe_census.csv` | The DfE census extract, ~59,000 rows, committed to the repo (public OGL data) |
| `DASHBOARD_STYLING.md` | Styling guide: Flatly theme, `CUSTOM_STYLE` object, header gradient, KPI card patterns |
| `requirements.txt` | pandas, plotly, dash, dash-bootstrap-components, gunicorn |

`app.py` is organised in commented sections: data loading (`load_and_prepare_data`), aggregation helpers (`get_national_totals` / `get_regional_totals` / `get_la_totals`), chart builders (`build_*_chart`), layout (one `dbc.Tab` per view), then callbacks.

## Data

Source: DfE Explore Education Statistics, "Elective home education" release
(https://explore-education-statistics.service.gov.uk/find-statistics/elective-home-education/2025-26-autumn-term).

CSV shape:
- `time_period` — 202223, 202324, 202425, 202526 (converted to "2022/23" style in `academic_year`)
- `time_identifier` — Autumn / Spring / Summer term (2025/26 has autumn only, being the latest release)
- `geographic_level` — National / Regional / Local authority
- `breakdown_topic` — Total, Reason, Sex, Year group (each with a `breakdown` value)
- `child_count`, `child_percent`, `rate_per_100`

Headline anchor: England, 2025/26 autumn term, 126,000 children in EHE, rate 1.5 per 100.

**Gotcha:** LA names in the CSV contain embedded commas inside quoted fields (e.g. "Bournemouth, Christchurch and Poole"); always parse with pandas, never naive comma splitting.

## Dashboard structure

Six `dbc.Tab` views:
1. **Overview** — national KPI cards + national trend
2. **Regional Comparison** — counts and rates per 100 by region, South West highlighted by default
3. **Local Authorities** — LA comparison and trends (Cornwall / Plymouth / Devon focus)
4. **Time Analysis** — term-by-term trends (`year_term` axis, e.g. "2022/23 Autumn")
5. **Demographics & Reasons** — reasons for EHE, year-group distribution, sex split, at national / regional / LA level
6. **Data Explorer** — filterable table with CSV download (`dcc.send_data_frame`)

## Where it's linked from

- EduTrack Analytics Portal sidebar, Tools section ("EHE Dashboard" external link) — `~/CCP2/edutrack-analytics-portal/components/Sidebar.tsx`
- `CCP2/menu.html` tile "EHE Dashboard (Elective Home Education)" (performanceAnalyticsApps manifest)
- The Palace schoolroom ("HOME EDUCATION" picture) — `~/palace/js/config.js`

If the URL changes when the app is moved off Render, update all three.

## Conventions

UK English, DD/MM/YYYY dates, no em dashes in visible content, "WeST" never "WST" (see `~/CLAUDE.md`).

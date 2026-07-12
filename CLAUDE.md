# EHE Dashboard — Claude Knowledge File

## Overview

Interactive dashboard on the DfE "Elective Home Education" statistics for England, with a focus on the South West region and the Cornwall, Plymouth and Devon local authorities (the WeST footprint, an LA-area proxy, not WeST's own pupils). Rebuilt July 2026 from the earlier Python/Dash tool into a static React app, fixing that tool's central methodology flaw (it silently summed counts, rates and percentages across terms) and tying every displayed figure to a published DfE value through a reconciliation test suite.

- **Deploy target:** Firebase Hosting, target `ehe` -> site `west-ehe` on the shared project `west-analytics-47c83`. Deploy with `firebase deploy --only hosting:ehe` ONLY (see the STOP note below). Manual, only after Nat has reviewed on localhost.
- **GitHub repo:** `natparnell/ehe-dashboard` — **PUBLIC**. Do not add anything WeST-internal (pupil-level data, credentials, internal commentary) without making the repo private first.
- **Status (12/07/2026):** rebuilt in a fresh context window; the build and all 60 tests are green.

## Stack

React 19 + TypeScript (strict) + Vite 7 + Tailwind v4 (via `@tailwindcss/vite`, no `tailwind.config.js`). Custom typed SVG chart components (no chart library); `d3-geo` / `d3-scale` / `d3-scale-chromatic` for the LA choropleth only. `papaparse` (dev only) for preprocessing; `vitest` + `@testing-library/react` + jsdom for tests. `lucide-react` icons, `html-to-image` for chart PNG download. No router: a `views.ts` registry + one `switch` in `App.tsx`; a single `dataService.ts` fetch boundary with an in-memory + IndexedDB (`ehe-cache`) version gate.

## Run locally

```bash
cd ~/ehe-dashboard
npm install
npm run preprocess   # streams data/*.csv -> public/processed/*.json (required before dev/test/build)
npm run dev          # Vite dev server on http://127.0.0.1:3009
```

`public/processed/` is git-ignored (regenerable build artefacts), so run `npm run preprocess` after a fresh clone and after any data refresh before `dev`, `test` or `build`.

## Test, lint and build

```bash
npm test          # 60 tests: src/recon.test.ts + src/views.smoke.test.tsx
npm run lint
npm run build     # preprocess && tsc -b && vite build && stamp dist/version.json -> dist/
```

## File map

| Path | Purpose |
|---|---|
| `data/ehe_census.csv` | DfE census-date stock, ~59,000 rows, committed (public OGL data) |
| `data/ehe_academic_year.csv` | DfE academic-year at-any-point flow, 655 rows, one year behind the census |
| `data/README.md` | Source URLs, refresh path, suppression semantics, boundary attribution |
| `scripts/preprocess.mjs` | Streams the two CSVs into `public/processed/*.json` (the only build step that touches data) |
| `scripts/DATA_SHAPES.md` | The exact JSON contract each view builds against |
| `public/geo/ctyua_2023_buc.geojson` | ONS Dec-2023 CTYUA boundaries (England) for the choropleth |
| `src/` | React app: `App.tsx`, `views.ts`, `services/dataService.ts`, `components/views/*`, `components/charts/*`, `utils/*` |
| `src/recon.test.ts` | Reconciliation against published DfE anchors |
| `src/views.smoke.test.tsx` | jsdom render of all 10 views against the real generated JSON |
| `REBUILD_SPEC.md` | The authoritative build spec |

## Data

Source: DfE Explore Education Statistics, "Elective home education" release
(https://explore-education-statistics.service.gov.uk/find-statistics/elective-home-education/2025-26-autumn-term).

Headline anchor: England, 2025/26 autumn term, 126,000 children in EHE, rate 1.5 per 100. Hard rules enforced in `preprocess.mjs` and re-checked by the tests: suppression symbols (`low` / `x` / `z` / blank) parse to **null, never 0**, with the symbol preserved; only counts are ever summed (within one term-point), never rates or percentages; the footprint pooled rate is population-weighted via the back-out identity, never a mean of LA rates.

**Gotcha:** LA names in the CSV contain embedded commas inside quoted fields (e.g. "Bournemouth, Christchurch and Poole"); always parse with papaparse, never naive comma splitting.

## Dashboard structure

10 views (a `views.ts` registry + one `switch` in `App.tsx`), grouped Start here / Places / Questions / Reference: Headlines, National, Regional, WeST Footprint, LA Map, Stocks/Flows/Enforcement, Year Groups, Reasons, Data Explorer, Methodology.

## STOP — shared Firebase project `west-analytics-47c83`

This site shares a Firebase project with many other WeST apps (Strategic Cascade, EduTrack, TechSprint, etc.). **Only ever `firebase deploy --only hosting:ehe`.** A bare `firebase deploy` (or any `firestore:rules` deploy) replaces the project-wide Firestore ruleset shared with those apps and takes them offline. See the STOP section in `~/CLAUDE.md`. The site is created once at first deploy with `firebase hosting:sites:create west-ehe`; it is not created during the build.

## Where it's linked from

- EduTrack Analytics Portal sidebar, Tools section ("EHE Dashboard" external link) — `~/CCP2/edutrack-analytics-portal/components/Sidebar.tsx`
- `CCP2/menu.html` tile "EHE Dashboard (Elective Home Education)"
- The Palace schoolroom ("HOME EDUCATION" picture) — `~/palace/js/config.js`

The live URL is now `https://west-ehe.web.app` (Firebase). Update all three link sites when the deploy first goes live (previously the app was on Render at `https://ehe-dashboard.onrender.com/`, now retired).

## Conventions

UK English, DD/MM/YYYY dates, no em dashes in visible content, "WeST" never "WST" (see `~/CLAUDE.md`).

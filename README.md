# EHE Dashboard

A static React dashboard on the DfE **Elective Home Education** statistics (census-date stock,
Autumn term 2025/26 release, plus the annual at-any-point flow file). It keeps the Cornwall /
Plymouth / Devon + South West narrative of the earlier Python/Dash tool while fixing that tool's
central methodology flaw (it silently summed counts, rates and percentages across terms) and tying
every displayed figure to a published DfE value through a reconciliation test suite.

The dashboard reads the DfE LA-grain data; the **WeST footprint** (Cornwall + Plymouth + Devon) is
an **LA-area proxy for children in those areas, not WeST's own pupils**, and every footprint figure
is captioned as such. Badged "official statistics in development".

This repo is **public**: no credentials, nothing WeST-internal.

## Stack

- React 19 + TypeScript (strict) + Vite 7
- Tailwind v4 via `@tailwindcss/vite` (CSS-configured, no `tailwind.config.js`)
- Custom typed SVG chart components (no chart library); `d3-geo` / `d3-scale` /
  `d3-scale-chromatic` for the LA choropleth only
- `papaparse` (dev only) for preprocessing; `vitest` + `@testing-library/react` + jsdom for tests
- `lucide-react` icons, `html-to-image` for chart PNG download
- No router: a `views.ts` registry + one `switch` in `App.tsx`; a single `dataService.ts` fetch
  boundary with an in-memory + IndexedDB (`ehe-cache`) version gate

## Data

Two committed source CSVs (Open Government Licence v3.0) under `data/`:

- `data/ehe_census.csv`: census-date stock, 58,968 rows, 10 term-points (Autumn 2022/23 to
  Autumn 2025/26).
- `data/ehe_academic_year.csv`: annual at-any-point flow, 655 rows, 2021/22 to 2024/25 (one year
  behind the census file).

Source URLs, refresh path and suppression semantics are in `data/README.md`. The processed JSON
shapes the views build against are documented in `scripts/DATA_SHAPES.md`.

`scripts/preprocess.mjs` streams the CSVs into compact JSON under `public/processed/` (git-ignored,
regenerable). Hard rules enforced there and re-checked by the tests: suppression symbols (`low` /
`x` / `z` / blank) parse to **null, never 0**, with the symbol preserved; only counts are ever
summed (within one term-point), never rates or percentages; the footprint pooled rate is
population-weighted via the back-out identity, never a mean of LA rates.

## Run locally

```bash
npm install
npm run preprocess   # streams data/*.csv -> public/processed/*.json (required before dev/test)
npm run dev          # Vite dev server on http://127.0.0.1:3009
```

`public/processed/` is git-ignored, so run `npm run preprocess` after a fresh clone (and again after
any data refresh) before `dev`, `test` or `build`.

## Test

```bash
npm test
```

Two suites (60 tests):

- `src/recon.test.ts`: Node-environment reconciliation against `public/processed/*.json`, asserting
  the exact DfE published anchors (England 126,000 / 1.5, South West 15,830 / 2.0 rank 1 of 10, the
  footprint pooled series, the reasons crossover, the flows anchors, suppression invariants, and so
  on).
- `src/views.smoke.test.tsx`: jsdom render of all 10 views against the real generated JSON,
  asserting a distinctive post-load fragment per view.

## Lint and build

```bash
npm run lint
npm run build   # preprocess && tsc -b && vite build && stamp dist/version.json
```

`npm run build` writes the production site to `dist/`.

## Deploy

Deployment is **manual and only after Nat has reviewed on localhost**. The Firebase target `ehe`
maps to site `west-ehe` on the shared project `west-analytics-47c83`.

```bash
firebase deploy --only hosting:ehe
```

Only ever `--only hosting:ehe`. A bare `firebase deploy` (or any `firestore:rules` deploy) would
replace the project-wide Firestore ruleset shared with other WeST apps and take them offline: see the
STOP section in `~/CLAUDE.md`. The site is created once at first deploy with
`firebase hosting:sites:create west-ehe`; it is **not** created during the build.

## Licence and attribution

Source data: DfE *Elective home education* statistics, released under the Open Government Licence
v3.0. Release and licence links are surfaced in the Methodology and Explorer views. Attribute:
"Contains Department for Education data licensed under the Open Government Licence v3.0."

Boundary data: the LA choropleth uses `public/geo/ctyua_2023_buc.geojson`, ONS *Counties and Unitary
Authorities (December 2023) Boundaries UK BUC* from the ONS Open Geography Portal, Open Government
Licence v3.0. Attribute: "Source: Office for National Statistics licensed under the Open Government
Licence v3.0. Contains OS data (c) Crown copyright and database right 2023." See `data/README.md` for
details; the credit is also shown in the Map view.

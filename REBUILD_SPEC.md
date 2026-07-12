# EHE Dashboard Rebuild Specification

Authoritative spec for rebuilding the EHE dashboard as a static React app on Firebase Hosting,
replacing the Python/Dash app (`app.py`, kept in git history). Synthesized 12/07/2026 from: a full
audit of the Dash app, the NEETS dashboard skeleton (`~/NEETS`, the sibling reference
implementation), a DfE data-landscape survey, and three insight-discovery passes (national, South
West, WeST footprint). Build agents: follow this file exactly; where it is silent, copy the NEETS
pattern; where NEETS is silent, keep it simple.

Conventions: UK English, DD/MM/YYYY, no em dashes anywhere in user-visible text, "WeST" never
"WST". The repo is PUBLIC: nothing WeST-internal, no credentials.

---

## 1. Goal

Keep the essence of the current dashboard (the Cornwall / Plymouth / Devon + South West narrative
spine, reason colour families, termly rhythm, KPI cards) while fixing its one systemic methodology
flaw (no term filter: historical years silently sum counts, rates and percentages across terms),
adding the insights from discovery, and tying every displayed figure to DfE published values via a
reconciliation test suite.

Audience: public, but written for a numerate reader (the primary user is a mathematician CEO of a
31-school trust). Show real relationships; state assumptions and confounders plainly; never round
caveats away.

## 2. Stack and repo layout

React 19 + TypeScript (strict) + Vite 7 + Tailwind v4 (via `@tailwindcss/vite`, CSS-configured, no
tailwind.config.js). Custom typed SVG chart components (NO Nivo, NO chart library). `d3-geo`,
`d3-scale`, `d3-scale-chromatic` for the LA map only. `papaparse` (dev dep) for preprocessing.
`vitest` + `@testing-library/react` + jsdom for tests. `lucide-react` icons, `html-to-image` for
chart PNG download. Pin the same versions as `~/NEETS/package.json`, minus all `@nivo/*` packages.

Scripts: `dev` (vite), `preprocess` (node scripts/preprocess.mjs), `build` (preprocess && tsc -b &&
vite build && node scripts/write-version.mjs), `test` (vitest run), `lint`.

Dev server: port **3009**, host `127.0.0.1` (3001/3007 taken by other projects; 5060 forbidden).
Copy NEETS `server.watch.ignored` pattern for `data/`, `public/processed/`, `public/geo/`.

Layout (top level of the repo):

```
data/ehe_census.csv            # moved from repo root; committed (small, OGL)
data/ehe_academic_year.csv     # already downloaded; committed (tiny, OGL)
data/README.md                 # source URLs, refresh path, suppression semantics
scripts/preprocess.mjs         # streams CSVs -> public/processed/*.json
scripts/write-version.mjs      # stamps dist/version.json post-build
public/processed/              # generated, git-ignored
public/geo/ctyua_2023_buc.geojson  # copied from ~/NEETS/public/geo/ (ONS Dec-2023 CTYUA, England)
src/                           # app (views.ts registry, App.tsx switch, components/, services/, utils/)
firebase.json / .firebaserc    # target "ehe" -> site "west-ehe", project west-analytics-47c83
REBUILD_SPEC.md                # this file
```

Delete from working tree (history keeps them): `app.py`, `requirements.txt`, `DASHBOARD_STYLING.md`,
any Render config (`render.yaml`, `Procfile`). Do NOT delete `ehe_census.csv` — move it to `data/`.

Firebase: copy NEETS `firebase.json` shape (public `dist`, SPA rewrite, cache headers for
`/processed/**` 3600s and `/geo/**` 86400s) with target `ehe`; `.firebaserc` maps target `ehe` to
site `west-ehe` on project `west-analytics-47c83`. Deploy is ALWAYS
`firebase deploy --only hosting:ehe` and never anything else (project-wide Firestore ruleset shared
with other WeST apps; see ~/CLAUDE.md STOP section). The site itself will be created at deploy time
(`firebase hosting:sites:create west-ehe`) — NOT during the build, and no deploy happens until Nat
signs off on localhost.

NEETS patterns to port near-verbatim: `dataService.ts` (only fetch boundary; memory + IndexedDB
cache, DB name **`ehe-cache`**, version-gated on `metadata.json.generated_at`, purge other
versions), `idbCache.ts`, `UpdateBanner.tsx` (polls `/version.json`), `ChartCard.tsx` (title,
subtitle, PNG download, footnote), chart components (`LineChart`, `BarChart`, `ScatterChart` with
ResizeObserver width, nice ticks, null-gap support, dashed-England convention, hover tooltip),
`formatting.ts` (`NA = 'n/a'` for null — never '0', never a dash; en-GB locale; explicit +/- on
deltas), views registry pattern (`views.ts` + grouped `Sidebar` + one `switch` in `App.tsx`, no
router), print pattern (`print:hidden` on sidebar/buttons, `print:break-inside-avoid` on cards,
Print button on the lead view), tsconfig project-references with the same strict flags, ESLint flat
config, `@source not` directives in `index.css` so Tailwind never scans `data/` or `public/`.

## 3. Data inputs and preprocessing

### 3.1 Sources

1. `data/ehe_census.csv` — census-date stock. 58,968 rows. Columns: `time_period` (202223, 202324,
   202425, 202526), `time_identifier` (Autumn/Spring/Summer term), `geographic_level` (National /
   Regional / Local authority), country/region/LA codes and names, `breakdown_topic` (Total / Sex /
   Year group / Reason), `breakdown`, `child_count`, `child_percent`, `rate_per_100`.
   2025/26 has Autumn only. **There are 10 regional rows: London is split Inner London / Outer
   London. There is no "London" row.**
2. `data/ehe_academic_year.csv` — annual flows, 655 rows, LA/Regional/National grain, 2021/22 to
   2024/25 (one year behind the census file). Measures: `ehe_anytime_full_year`,
   `ehe_starts_full_year`, `ehe_returns_full_year`, `ehe_leave`, `ehe_section_437_full_year`,
   `ehe_sao_issued_full_year`, `ehe_sao_revoked_full_year`, plus prior-school-type counts and
   percentages (`ehe_schtype_*` / `ehe_schtype_*_pc`).

Parse with papaparse streaming; LA names contain quoted commas ("Bournemouth, Christchurch and
Poole") — never naive splitting.

### 3.2 Value parsing (hard rule)

`low`, `x`, `z`, and blank all parse to **null, never 0**, but keep the symbol:
every numeric cell in processed JSON is `{ v: number | null, f?: 'low' | 'x' | 'z' }` or, where a
flat number is used, a parallel flag field. Semantics (from the DfE methodology, must appear in the
Methodology view): `x` = not available, `z` = not applicable, `low` = rounds to 0 but is not 0.
Rounding as published: LA and regional counts to nearest 10, national to nearest 100, percentages
to whole numbers, rates to 1 dp. Totals may not sum due to rounding.

### 3.3 Processed outputs (`public/processed/`)

Emit compact JSON via a shared `writeJson(name, data)` that logs sizes. `metadata.json` is written
LAST (its presence gates the tests and dataService). Exact field naming is the preprocess author's
choice, but document every file's shape in **`public/processed/DATA_SHAPES.md`** (also generated,
also git-ignored... actually write DATA_SHAPES.md to `scripts/DATA_SHAPES.md`, committed, since view
agents need it) — view agents build against that document.

1. `totals.json` — every geography (National, 10 regions, every LA) x every term-point (10) for
   `breakdown_topic=Total`: count, rate, percent, flags. Include `new_la_code`, `region_name`,
   an ordered `periods` list (e.g. `{ year: '2022/23', term: 'Autumn' }` with a sort key), and each
   geography's back-out population per period (`pop = count / rate * 100`, null if either is null).
2. `breakdowns.json` — National + Regional rows for Sex / Year group / Reason, all periods
   (percent always; count where published). Small.
3. `breakdowns-la.json` — all LA rows for Sex / Year group / Reason, all periods. The big one;
   lazy-loaded. If it exceeds ~4 MB minified, split by topic.
4. `footprint.json` — precomputed pooled footprint (Cornwall + Plymouth + Devon) per period from
   2023/24 Autumn onward (2022/23 excluded: Cornwall suppressed): summed count, pooled rate (see
   4.3), pooled population, per-constituent values, the excess-vs-England-rate derivation, and the
   footprint year-group aggregate for the latest period (summed counts with a
   suppressed-cells-excluded note). Benchmarks Torbay / Somerset / Dorset included as plain series.
5. `flows.json` — from `ehe_academic_year.csv`: National, South West, footprint LAs + Torbay /
   Somerset / Dorset, all years: anytime, starts, returns, leave, s437, SAO issued/revoked, and the
   prior-school-type percentage mix (national at minimum).
6. `map-la.json` — latest Autumn per LA keyed by `new_la_code`: rate, count, la_name, region_name,
   flags. Include a `missingCodes` list of any data codes with no boundary feature (surface in an
   amber notice, never silently drop).
7. `headlines.json` — the precomputed KPI numbers used by the Headlines view (national 126,000 /
   1.5; SW 15,830 / 2.0 / rank 1 of 10; footprint 5,770 / 2.65 / x-England multiple; Plymouth
   Y10-11 share; flows anchors), each with period labels, so the lead view renders from data, not
   hardcoded strings.
8. `metadata.json` — `generated_at` ISO stamp (from build time), source release name and URL,
   period coverage of both files, row counts.

## 4. Hard methodology rules (recon-enforced; violating any of these is a build failure)

1. **Term is first-class.** Every figure is a single term-point, or a series of distinct
   term-points. Counts, rates and percentages are NEVER summed or averaged across terms. (This is
   the Dash app's central defect: historical years summed three terms, rendering rates like 5.4
   "per 100".)
2. **Rates and percentages are as-published.** Never recompute, sum, or average them across
   geographies or terms. Only counts may be summed (across LAs within one period) or differenced
   (adjacent stocks of the same geography = net change, not gross flow).
3. **Footprint pooled rate** = `sum(count) / sum(count / rate * 100) * 100` — population-weighted
   via the back-out identity, never a mean of LA rates. Validation: England back-out population
   ~8.4M. The footprint aggregate series starts 2023/24 Autumn.
4. **Year-on-year = autumn-to-autumn only.** The census-date stock rises within a year and resets
   each September (the sawtooth); cross-year comparisons at unlike terms are forbidden. Where the
   sawtooth itself is shown, September resets are annotated so they cannot be read as decline.
5. **Stock vs flow never conflated.** Census-date (126,000, termly) and at-any-point (175,900,
   annual, one year behind) are different measures, always labelled, never arithmetically
   reconciled to each other in a chart.
6. **Suppression to null, symbol preserved** (3.2). Suppressed cells in tables render the symbol or
   a hatch, never blank, never 0. Aggregates over partially suppressed cells carry an "excludes
   suppressed small cells" footnote.
7. **Region rank claims say "of 10"** with an Inner/Outer London note.
8. **Reason data honesty.** Above LA level, reason counts are suppressed: use percentages.
   Unknown / No reason given / Other are presented as data quality, visually separated from
   substantive reasons. A renormalised "% of known substantive reasons" cut is offered, labelled
   approximate (integer-rounded inputs, low-suppressed small categories understate the
   denominator). NEVER claim a school-driven vs lifestyle split at LA level for the footprint; the
   suppression will not bear it. Cross-region named-reason comparison always carries the
   Unknown-variation caveat (7% to 29% by region).
9. **Footprint proxy caveat on every footprint figure**: LA-area children (Cornwall, Plymouth,
   Devon), not WeST pupils. Copy the NEETS convention.
10. **Collection-maturity caveat on every trend**: voluntary from autumn 2022 (93-100% response),
    mandatory from autumn 2024; national/regional figures uprated for non-response; part of the
    apparent growth is improved coverage. Falling "Unknown" reason share (21% to 17%) is partly
    recording improvement. Badge the whole dashboard "official statistics in development".
11. Sex splits: the published split includes Unknown; if Unknown is excluded say "of those with
    known sex". Sex rates do not exist (suppressed everywhere).
12. National reason counts / per-year-group rates are structurally suppressed: never promise them.

## 5. Views

Registry order and grouping (`views.ts`). Each view = one file in `src/components/views/`,
named `<Id>View.tsx`. A view agent owns exactly its own file and touches nothing shared.

**Group "Start here"**
1. `headlines` — **EHE: What the Data Shows** (lead view, default). Plain-English narrative with
   Print button, KPI tiles from `headlines.json`, and the six findings in order: (a) 126,000 /
   1.5% England autumn 2025/26 with the sawtooth mini-chart; (b) stock vs flow (175,900 at any
   point, 78,000 starts, 28,100 returns, 2024/25); (c) South West is the highest-rate region in
   every term since collection began (2.0, 1.33x England); (d) footprint at ~1.75x England, ~5,770
   children, Plymouth rate doubled in two years; (e) Plymouth Years 10-11 = 51% (England 36%),
   the GCSE-phase signal; (f) mental health has overtaken philosophical/preferential nationally
   (16% vs 12%; was 9% vs 16%), with ~3 in 10 reasons unknown. Every finding carries its caveat
   inline. Link to the DfE release. Footer badge: official statistics in development.

**Group "Places"**
2. `national` — the sawtooth line (10 term-points, September resets annotated, within-year gains
   and resets called out: +16,700/+25,900/+25,500 gains, -5,600/-6,200/-11,200 resets), rate line
   (1.0 to 1.5 autumn-to-autumn), maturity caveat panel (response rate 93% to 100%, unknown-reason
   share falling), autumn-to-autumn KPI row.
3. `regional` — ranked bar of 10 regions (published rates, SW highlighted, England 1.5 datum);
   SW vs England dual trend with the ratio panel (stable 1.29-1.50, "persistent level, not faster
   growth"; both +56% over three autumns); within-SW LA ranking (rural/coastal 2.7-2.9 vs urban
   1.0-1.4, England line); sex and year-group "no difference" controls (SW mirrors England).
4. `footprint` — **WeST Footprint** (Cornwall, Plymouth, Devon; proxy caveat prominent).
   Trajectory multi-line: three LAs + pooled footprint vs SW and England reference bands,
   2023/24 on; stacked count growth (4,140 to 5,770); benchmark panel with Torbay (2.8, fits the
   peninsula), Somerset (2.9) and Dorset (1.8, the deliberate rural contrast); the excess-EHE
   bignum (~2,500 above national-rate expectation, labelled illustrative with its assumptions);
   Plymouth callout (rate doubled; urban statistical neighbours differ).
5. `map` — LA choropleth of latest-autumn rates over the ONS boundaries (d3-geo, quantile classes,
   join `properties.code` = `new_la_code`), plus the mandatory paired sortable ranked table
   (values as text, suppression hatched), amber code-join notice for unmatched codes, blob or fill
   toggle optional. Never a map-only channel.

**Group "Questions"**
6. `flows` — **Stocks, Flows and Enforcement**. Stock-vs-flow explainer (waterfall: at-any-point =
   census stocks + starts/returns/leavers framing, labelled schematic not reconciliation); national
   flows trend (175,900 up from 153,300; starts 78,000; returns 28,100); enforcement tiles (7,400
   s437 notices, 2,500 SAOs issued, 600 revoked; LAs issuing zero shrinking 30 to 22 / 54 to 38 if
   derivable from the LA file — otherwise national only); footprint enforcement contrast (Devon
   4,030 anytime / 10 notices vs Plymouth 1,090 / 100 notices — shown as notices per 1,000 EHE
   children, with a recording-practice caveat); prior-school-type mix (national). Annual, one year
   behind the census file: label periods explicitly everywhere.
7. `yeargroups` — the age gradient: national counts Reception 400 rising to Year 11 24,100, the
   Year 8-to-9 inflection, Years 10-11 = 36%; footprint aggregate vs England overlay (39.3% vs
   36.4%); per-LA Y10+Y11 tiles (Plymouth 51%, Torbay 40%, Cornwall 39%, Devon 36%); note the
   Year 11 September age-out interacts with the sawtooth. Counts exist from 2024/25 only
   (percent-only before): show a 2-point count trend at most.
8. `reasons` — national ranked bar (latest autumn percentages, reason colour families, Unknown/No
   reason/Other visually set apart in the data-quality colour); the crossover slopegraph (mental
   health 9-13-14-16 vs philosophical 16-16-14-12 over four autumns); the renormalised
   known-reasons toggle; the regional honesty scatter (x = Unknown %, y = mental health %, SW
   annotated; caption: mechanical dilution, not causation); footprint recording-gap stacked bars
   (substantive vs Unknown vs Other per LA over three autumns; Cornwall "Other" 36% anomaly
   callout; Devon Unknown rising 19-31-36). New-categories-autumn-2025 note.

**Group "Reference"**
9. `explorer` — filterable, sortable real HTML table over both datasets (geography level, topic,
   period, breakdown filters), as-published symbols shown, CSV download of the CLEAN source schema
   (raw column names, no derived columns — the Dash app leaked its helper columns), plus links to
   the DfE release and both raw files.
10. `methodology` — census-date vs at-any-point definitions; rounding table; suppression symbol
    semantics; uprating and response-rate history; rate denominator (ONS mid-year 5-16 population;
    the uprating base "year groups R to 11" is a different population — do not conflate); the
    footprint pooled-rate maths written out with its failure modes (rate-rounding error ~±3% on
    Plymouth's back-out, mitigated by multi-year averaging); autumn-to-autumn comparison rule; the
    sawtooth explanation; refresh path (next release winter 2026, resolve dataset GUIDs fresh from
    the data catalogue each release, do not hard-code them); OGL attribution and release link.

## 6. Reconciliation anchors (`src/recon.test.ts`)

Node-environment vitest reading `public/processed/*.json` off disk, gated on `metadata.json`
existing ("run npm run preprocess first"). Assert EXACT published values (they are as-published;
no tolerance except where a derived value meets rounding, stated per case):

| Anchor | Value |
|---|---|
| England, Total, autumn 2025/26 | count 126,000; rate 1.5 |
| England autumn series | counts 80,900 / 92,000 / 111,700 / 126,000; rates 1.0 / 1.1 / 1.4 / 1.5 |
| England summer 2024/25 | count 137,200 (reset to 126,000 = -11,200) |
| South West, autumn 2025/26 | count 15,830; rate 2.0; rank 1 of 10 regions, every term rank 1 |
| SW autumn rate series | 1.5 / 1.6 / 1.8 / 2.0 |
| Regional autumn 2025/26 rate order | SW 2.0 top; Inner London 0.9 bottom; 10 regions exactly |
| Cornwall / Plymouth / Devon / Torbay autumn 2025/26 | rates 2.9 / 2.0 / 2.7 / 2.8; counts 2,210 / 720 / 2,840 / 500 |
| Footprint pooled, autumn 2025/26 | count 5,770; rate 2.65 ± 0.05 (back-out rounding); 2024/25: 5,130 / 2.39; 2023/24: 4,140 / 1.90 |
| Footprint excludes 2022/23 | no aggregate row exists |
| England back-out population | 8,400,000 ± 2% |
| National reasons autumn 2025/26 | Unknown 17, Mental health 16, No reason given 12, Philosophical/preferential 12 (percent) |
| Mental health autumn series | 9 / 13 / 14 / 16; Philosophical 16 / 16 / 14 / 12 |
| SW Unknown reason autumn 2025/26 | 27 |
| National sex autumn 2025/26 | Female 65,100 (52%), Male 60,700 (48%) |
| National year groups autumn 2025/26 | Y11 24,100; Y10 21,800; Y10+Y11 share ≈ 36% of 126,000 |
| Plymouth Y10+Y11 percent autumn 2025/26 | 31 + 20 = 51 |
| Flows national 2024/25 | anytime 175,900; starts 78,000; returns 28,100; s437 7,400; SAO issued 2,500; revoked 600; 2023/24 anytime 153,300 |
| Flows footprint 2024/25 | Devon anytime 4,030 / s437 10; Plymouth 1,090 / 100; Cornwall 3,170 / 40 |
| Suppression invariants | no numeric 0 produced from low/x/z; Cornwall 2022/23 autumn Total is null-flagged; regional reason counts null-flagged |
| Structural | regional autumn 2025/26 counts sum to ≈126,000 within rounding (126,040); every geography x period in totals.json unique |

Plus `views.smoke.test.tsx` (jsdom): render every view with the real generated JSON, assert key
text fragments, stub ResizeObserver.

## 7. Design system

- Geography colours: one fixed colour per place used everywhere (NEETS `GeoRole` pattern):
  England = slate, dashed lines by convention; South West = deep blue; Cornwall = golden/amber;
  Plymouth = teal; Devon = green; Footprint = strong red (the narrative colour, matching the old
  app's key-LA red #E94F37); benchmarks (Torbay/Somerset/Dorset) = muted greys. Colour-blind-safe
  contrast; check adjacent-series distinguishability.
- Reason colours: port the Dash app's family logic (health = blues, school-dissatisfaction =
  oranges/yellows, exclusion = purples, lifestyle/philosophical = greens, Unknown/No reason/Other =
  the red-grey data-quality family) — from `app.py` REASON_COLORS lines 84-104 in git history or
  re-derive families with fresh hexes; families matter, not the exact hexes.
- Term palette: Autumn / Spring / Summer distinct (old app: red / blue / green).
- KPI cards: colour-coded top border, uppercase micro-label, big number, sub-line — port the
  essence of the Dash cards into a `KpiCard.tsx`.
- Rising EHE is NEUTRAL, not good/green: deltas render in neutral ink with explicit +/- signs
  (the Dash app coloured rises green; do not repeat that).
- Zero is a value: `0` renders as "0"; only null renders "n/a" (the Dash app's falsy-zero bug).
- Every chart inside `ChartCard` with title, subtitle (period + measure), footnote (caveat), PNG
  download. Suppressed points = gaps in lines, hatched cells in tables/map.
- Accessible: text alternatives for the map (the ranked table), aria labels on controls,
  print-friendly (`print:` variants).

## 8. Build phases and ownership

1. **Scaffold** (one agent): repo restructure per §2 (git mv the CSV, delete Dash files), full
   config set, `npm install` green, shared components (`ChartCard`, `KpiCard`, charts, dataService,
   idbCache, UpdateBanner, formatting, colors, types), `views.ts` registry with all 10 ids,
   `Sidebar`, `App.tsx` switch, and a STUB file per view (renders its title + "under construction")
   so the app compiles and runs from the start. Copies the geo file from NEETS.
2. **Data** (one agent): `preprocess.mjs` + `write-version.mjs` + `scripts/DATA_SHAPES.md` +
   `data/README.md`. Runs `npm run preprocess`, checks output sizes.
3. **Gate** (one agent): `src/recon.test.ts` per §6 against the generated JSON. All anchors green
   before views start. Discrepancies are investigated, not tolerated away: if an anchor is wrong,
   determine whether the spec anchor or the pipeline is at fault and say so.
4. **Views** (one agent per view, parallel): each owns exactly `src/components/views/<Id>View.tsx`.
   No edits to shared files; view-local helpers live inside the view file. Data via `dataService`
   loaders only, shapes per `scripts/DATA_SHAPES.md`.
5. **Integrate** (one agent): `npm run build` + `npm test` + `npm run lint` green; writes
   `views.smoke.test.tsx`; fixes integration issues; updates `README.md` for the new stack;
   verifies no view stub remains.

No commits, no pushes, no deploys during the build. Nat reviews on localhost first.

## 9. After sign-off (not part of the build)

Create site `west-ehe`, deploy `--only hosting:ehe`, update the three link locations
(EduTrack `Sidebar.tsx`, `CCP2/menu.html` tile, `~/palace/js/config.js`), update this repo's
`CLAUDE.md` and the `~/CLAUDE.md` project row, commit and push.

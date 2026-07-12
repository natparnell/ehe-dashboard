# EHE source data

The two CSVs in this directory are the raw DfE Elective Home Education statistics.
Both are small and released under the Open Government Licence, so unlike the
NEETS dashboard they **are committed** to this public repo. They are the only
inputs to `scripts/preprocess.mjs`, which streams them into `public/processed/`
(git-ignored build artefacts).

## Files

| File | Grain | Measure | Rows | Coverage |
|---|---|---|---|---|
| `ehe_census.csv` | National / Regional / Local authority | Census-date **stock**, termly | 58,968 | 2022/23 to 2025/26; 2025/26 has Autumn only |
| `ehe_academic_year.csv` | National / Regional / Local authority | At-any-point **flow**, annual | 655 | 2021/22 to 2024/25 (one year behind the census) |

Stock (126,000 at the census date) and flow (175,900 at any point in the year)
are different measures and are never arithmetically reconciled to each other.

## Source

- **Release:** DfE, "Elective home education", Autumn term 2025/26.
- **Release page:** https://explore-education-statistics.service.gov.uk/find-statistics/elective-home-education/2025-26-autumn-term
- **Data catalogue (all datasets for the publication):**
  https://explore-education-statistics.service.gov.uk/data-catalogue?publication=elective-home-education
- **Publisher:** Department for Education (Explore Education Statistics service).
- **Licence:** Open Government Licence v3.0
  (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
  Attribute: "Contains Department for Education data licensed under the Open
  Government Licence v3.0."
- **Status:** Official statistics in development. Badge this on the whole
  dashboard.

The `ehe_census.csv` filename here is our local name for the census-date dataset;
`ehe_academic_year.csv` is our local name for the academic-year dataset. Their
underlying DfE dataset titles are the census-date and academic-year data sets
listed under the publication in the data catalogue.

## Boundary data

The LA choropleth in the Map view uses `public/geo/ctyua_2023_buc.geojson`
(committed, ~227 KB), the ONS **Counties and Unitary Authorities (December 2023)
Boundaries UK BUC** (ultra-generalised, clipped), England features only, copied
from the NEETS dashboard.

- **Source:** ONS Open Geography Portal
  (https://geoportal.statistics.gov.uk/), "Counties and Unitary Authorities
  (December 2023) Boundaries UK BUC".
- **Licence:** Open Government Licence v3.0. Attribute:
  "Source: Office for National Statistics licensed under the Open Government
  Licence v3.0." and "Contains OS data (c) Crown copyright and database right
  2023."
- **Join:** `properties.code` in the geojson matches the DfE `new_la_code`. Codes
  in the DfE data with no boundary in this December 2023 vintage (e.g. the
  abolished pre-April-2023 county codes) are surfaced in the Map view's amber
  "missing boundary" notice, never silently dropped.

## Refreshing for the next release (winter 2026)

The next release is expected winter 2026. To refresh:

1. Open the **release page** for the new term, then its **data catalogue** entry
   (the "Data catalogue" / "Download all data" links on the release).
2. **Resolve the two dataset GUIDs fresh from the catalogue every time. Never
   hard-code them: the GUIDs and the ZIP/API download IDs drift between
   releases.** Find the census-date and academic-year data sets under the
   publication, download each as CSV.
3. Overwrite `ehe_census.csv` and `ehe_academic_year.csv` here with the new CSVs,
   keeping these local filenames (the preprocess reads them by name).
4. Confirm the column headers are unchanged (see below). If the DfE renames or
   adds columns, update `scripts/preprocess.mjs` and `scripts/DATA_SHAPES.md`
   together.
5. Run `npm run preprocess`, then `npm test` (the reconciliation suite in
   `src/recon.test.ts`). Update the anchor values in that suite to the new
   release's published figures; investigate any mismatch rather than loosening a
   tolerance.
6. Update `release`, `source_url` and period coverage in the metadata block of
   `scripts/preprocess.mjs` (`buildMetadata`).

New reason categories may appear (the autumn-2025 collection added some); add
them to `REASON_ORDER` in the preprocess if so.

## Column reference

### `ehe_census.csv`

`time_period` (e.g. `202526`), `time_identifier` (`Autumn term` / `Spring term`
/ `Summer term`), `geographic_level` (`National` / `Regional` / `Local
authority`), `country_code`, `country_name`, `region_code`, `region_name`,
`old_la_code`, `new_la_code`, `la_name`, `breakdown_topic` (`Total` / `Sex` /
`Year group` / `Reason`), `breakdown`, `child_count`, `child_percent`,
`rate_per_100`.

There are **10 regional rows**: London is split into Inner London and Outer
London; there is no "London" row. Region rank claims say "of 10".

### `ehe_academic_year.csv`

The geography columns match the census. Measures: `ehe_starts_full_year`,
`ehe_anytime_full_year`, `ehe_returns_full_year`, `ehe_leave`,
`ehe_section_437_full_year`, `ehe_sao_issued_full_year`,
`ehe_sao_revoked_full_year`, plus prior-school-type counts `ehe_schtype_*`
(`ey`, `none`, `lamain`, `acad`, `free`, `ind`, `spec`, `ap`, `pru`, `ehe`,
`else_unk`) and their percentage twins `ehe_schtype_*_pc`.

## Suppression symbols (hard rule)

`low`, `x`, `z` and blank ALL parse to **null, never 0**, with the symbol
preserved (`cell = { v: number|null, f?: 'low'|'x'|'z' }`):

- `x` = not available
- `z` = not applicable
- `low` = rounds to 0 but is **not** 0
- blank = no data (`{ v: null }`, no flag)

Rounding as published by the DfE: LA and regional counts to the nearest 10,
national counts to the nearest 100, percentages to whole numbers, rates to 1
decimal place. Totals may not sum exactly because of rounding (the 10 regional
autumn-2025/26 counts sum to 126,040 against a national 126,000).

Rates and percentages are as-published: never recompute, sum or average them
across geographies or terms. Only counts may be summed (across LAs within one
period). The footprint pooled rate uses the population back-out identity
`sum(count) / sum(count / rate * 100) * 100`, never a mean of LA rates.

## Parsing gotcha: quoted commas in LA names

Four LA names contain commas inside quoted CSV fields:

- `"Bournemouth, Christchurch and Poole"`
- `"Bristol, City of"`
- `"Herefordshire, County of"`
- `"Kingston upon Hull, City of"`

**Never split rows on commas naively** (it shears these names and shifts every
later column). The preprocess uses papaparse, which respects the quoting; any
future tooling must do the same.

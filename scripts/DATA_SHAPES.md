# Processed data shapes

Authoritative contract for every JSON file in `public/processed/`, emitted by
`scripts/preprocess.mjs`. View agents build against this document; if a view
needs a shape not described here, that is a preprocess change, not a guess in
the view. All files are fetched only through `src/services/dataService.ts`.

Regenerate with `npm run preprocess`. `metadata.json` is written LAST; its
presence gates the tests and the dataService. The `public/processed/` directory
is git-ignored (build artefact).

## Conventions used by every file

### The cell type

Every numeric value from the DfE CSVs is a **cell**, never a bare number:

```ts
type Cell = { v: number | null; f?: 'low' | 'x' | 'z' }
```

- Live value: `{ v: 126000 }` (no `f`).
- Suppressed: `{ v: null, f: 'x' }`. The symbol is preserved so tables/maps can
  render the reason, never a blank and never `0`.
  - `x` = not available
  - `z` = not applicable
  - `low` = rounds to 0 but is **not** 0
- Genuinely absent (blank in source): `{ v: null }` (no `f`).

**Hard rule for views:** `v === null` renders as "n/a" (never "0", never a dash);
`v === 0` renders as "0". Only `null` is missing. Suppressed points are gaps in
lines and hatched cells in tables/maps.

### The period object (census / stock files)

The census is termly. Every stock file carries an ordered `periods` array and
keys its series by `period.key`.

```ts
type Period = { key: string; year: string; term: 'Autumn' | 'Spring' | 'Summer'; sort: number }
// e.g. { key: '202526-Autumn', year: '2025/26', term: 'Autumn', sort: 6075 }
```

`key` = `${time_period}-${term}` (e.g. `202526-Autumn`). `sort` ascending is the
correct display order (`startYear * 3 + termIndex`, Autumn=0/Spring=1/Summer=2).
There are **10** period-points: 2022/23, 2023/24, 2024/25 have all three terms;
2025/26 has Autumn only.

**Term is first-class.** Never sum or average a series across terms. Year-on-year
comparisons are autumn-to-autumn only (filter `term === 'Autumn'`).

### The flow-year object (academic-year / flow files)

The academic-year file is annual and one year behind the census.

```ts
type FlowYear = { key: string; label: string } // { key: '202425', label: '2024/25' }
```

Four years: 2021/22, 2022/23, 2023/24, 2024/25.

### Geography

- `level`: `'National' | 'Regional' | 'Local authority'`.
- `code`: ONS code. England `E92000001`; South West region `E12000009`;
  footprint LAs Cornwall `E06000052`, Plymouth `E06000026`, Devon `E10000008`.
- There are **10 regions**: London is split into Inner London and Outer London;
  there is no "London" row. Region rank claims say "of 10".
- 156 distinct LA codes / 154 distinct LA names.

---

## 1. `totals.json` (~160 KB, eager)

`breakdown_topic = Total` for every geography x every term-point, plus the
back-out population.

```ts
type Totals = {
  periods: Period[]                         // 10, ascending by sort
  geographies: {
    level: 'National' | 'Regional' | 'Local authority'
    code: string
    name: string
    region_code: string | null              // set for LA rows, null otherwise
    region_name: string | null              // set for Regional and LA rows
    series: {
      [periodKey: string]: {
        count: Cell
        rate: Cell                          // rate per 100 (5-16 population basis)
        percent: Cell                       // always 100 for Total; kept for symmetry
        pop: number | null                  // back-out = count / rate * 100, rounded to integer
      }
    }
  }[]
}
```

Sample geography (England), one period:

```json
{ "level": "National", "code": "E92000001", "name": "England",
  "region_code": null, "region_name": null,
  "series": { "202223-Autumn": { "count": { "v": 80900 }, "rate": { "v": 1 }, "percent": { "v": 100 }, "pop": 8090000 } } }
```

Sample suppressed cell (Cornwall, 2022/23 Autumn):

```json
"202223-Autumn": { "count": { "v": null, "f": "x" }, "rate": { "v": null, "f": "x" }, "percent": { "v": null, "f": "x" }, "pop": null }
```

Notes: a geography may lack a period entirely (missing key) if it did not appear
that term. `pop` is the population back-out identity; England pop ~8.4M. Only
counts may be summed across LAs within one period; never sum/average rates.

---

## 2. `breakdowns.json` (~306 KB, eager)

National + Regional rows for Sex / Year group / Reason, all periods. Percent
always; count where published (national reason counts and all regional reason
counts are structurally suppressed -> `{ v: null, f: 'x' }`).

```ts
type Breakdowns = {
  periods: Period[]
  reasonOrder: string[]                     // 19 reasons, display order (health first, Unknown last)
  yearGroupOrder: string[]                  // Reception..Year 11, then Unknown (13)
  sexOrder: string[]                        // ['Female','Male','Unknown']
  records: {
    level: 'National' | 'Regional'
    code: string
    name: string
    region_code: null
    region_name: string | null              // region name for Regional rows, null for National
    topic: 'Sex' | 'Year group' | 'Reason'
    breakdown: string                       // one of the *Order lists
    series: { [periodKey: string]: { count: Cell; percent: Cell } }
  }[]
}
```

Sample (England, Reason = Mental health, latest autumn: count suppressed, percent live):

```json
{ "level": "National", "code": "E92000001", "name": "England", "region_code": null, "region_name": null,
  "topic": "Reason", "breakdown": "Mental health",
  "series": { "202526-Autumn": { "count": { "v": null, "f": "x" }, "percent": { "v": 16 } } } }
```

Sample (South West, Reason = Unknown: reason counts suppressed above LA level,
percent published):

```json
"202526-Autumn": { "count": { "v": null, "f": "x" }, "percent": { "v": 27 } }
```

Honesty rules for views (spec 4.8): above LA level use percentages;
Unknown / No reason given / Other are data quality, present them apart from
substantive reasons; cross-region named-reason comparison carries the
Unknown-variation caveat (7% to 29% by region).

---

## 3. `breakdowns-la-reason.json` (~2.3 MB) / `breakdowns-la-yeargroup.json` (~1.5 MB) / `breakdowns-la-sex.json` (~0.3 MB) (lazy)

The LA-grain breakdowns, split by topic (combined they exceed 4 MB). Same record
shape as `breakdowns.json` records but `level` is always `'Local authority'` and
`region_code` / `region_name` are populated. Each file carries only the order
list its topic needs.

```ts
type BreakdownsLaReason    = { periods: Period[]; topic: 'Reason';     reasonOrder: string[];    records: LaBreakdownRecord[] }
type BreakdownsLaYearGroup = { periods: Period[]; topic: 'Year group'; yearGroupOrder: string[]; records: LaBreakdownRecord[] }
type BreakdownsLaSex       = { periods: Period[]; topic: 'Sex';        sexOrder: string[];       records: LaBreakdownRecord[] }

type LaBreakdownRecord = {
  level: 'Local authority'
  code: string
  name: string
  region_code: string | null
  region_name: string | null
  topic: 'Reason' | 'Year group' | 'Sex'
  breakdown: string
  series: { [periodKey: string]: { count: Cell; percent: Cell } }
}
```

Sample (Gateshead, Reason = Physical health; a count of 10 with a `low` percent):

```json
{ "level": "Local authority", "code": "E08000037", "name": "Gateshead",
  "region_code": "E12000001", "region_name": "North East",
  "topic": "Reason", "breakdown": "Physical health",
  "series": { "202223-Autumn": { "count": { "v": 10 }, "percent": { "v": null, "f": "low" } } } }
```

Note: LA Year group counts exist only from 2024/25 (percent-only before); expect
suppressed counts in earlier periods. Never claim a school-driven vs lifestyle
reason split at LA level for the footprint; suppression will not bear it.

---

## 4. `footprint.json` (~7 KB, eager)

Precomputed pooled WeST-footprint aggregate (Cornwall + Plymouth + Devon) from
2023/24 Autumn onward. 2022/23 is excluded (Cornwall suppressed): no aggregate
row exists. Pooled rate is the population-weighted back-out identity
`sum(count) / sum(pop) * 100`, never a mean of LA rates.

**Footprint proxy caveat (spec 4.9): every footprint figure is LA-area children
(Cornwall, Plymouth, Devon), not WeST pupils.**

```ts
type Footprint = {
  periods: Period[]                         // footprint periods only (2023/24 Autumn onward), ascending
  constituentOrder: string[]                // ['Cornwall','Plymouth','Devon']
  constituentCodes: { [name: string]: string }
  benchmarkCodes: { [name: string]: string } // Torbay/Somerset/Dorset
  excludedYear: '2022/23'
  excludedReason: string
  series: {
    key: string; year: string; term: string; sort: number
    count: number                           // summed live constituent counts
    rate: number                            // pooled rate, 2 dp
    pop: number                             // summed back-out population
    constituents: {
      [name: string]: { code: string; count: number | null; rate: number | null; pop: number | null }
    }
    suppressed: string[]                     // constituent names excluded this period (empty when all live)
    england: { count: number | null; rate: number | null }  // reference for this period
    sw: { count: number | null; rate: number | null }
    excessVsEngland: {
      multiple: number | null               // pooled rate / England rate (e.g. 1.77)
      excessChildren: number | null         // count - expectedAtEnglandRate (illustrative)
      expectedAtEnglandRate: number | null  // pop * englandRate / 100
    }
  }[]
  benchmarks: {
    [name: string]: { code: string; series: { [periodKey: string]: { count: Cell; rate: Cell } } }
  }
  yearGroupLatest: {
    period: { key: string; year: string; term: string } | null
    order: string[]                         // yearGroupOrder
    groups: { breakdown: string; count: number | null; suppressedConstituents: string[] }[]
    note: string                            // "excludes suppressed small cells"
  }
}
```

Sample `series` entry (latest autumn):

```json
{ "key": "202526-Autumn", "year": "2025/26", "term": "Autumn", "sort": 6075,
  "count": 5770, "rate": 2.65, "pop": 217392,
  "constituents": {
    "Cornwall": { "code": "E06000052", "count": 2210, "rate": 2.9, "pop": 76207 },
    "Plymouth": { "code": "E06000026", "count": 720, "rate": 2, "pop": 36000 },
    "Devon":    { "code": "E10000008", "count": 2840, "rate": 2.7, "pop": 105185 } },
  "suppressed": [],
  "england": { "count": 126000, "rate": 1.5 }, "sw": { "count": 15830, "rate": 2 },
  "excessVsEngland": { "multiple": 1.77, "excessChildren": 2509, "expectedAtEnglandRate": 3261 } }
```

The `excessChildren` figure (~2,500) is illustrative: it assumes the footprint
would sit at the England rate. Label it as such with its assumption.

---

## 5. `flows.json` (~9 KB, eager)

From `ehe_academic_year.csv`: National, South West, and the footprint LAs plus
Torbay / Somerset / Dorset, all four years. Annual, one year behind the census;
**label periods explicitly and never reconcile against the census stock.**

```ts
type Flows = {
  years: FlowYear[]                         // 4, ascending
  measures: string[]                        // ['anytime','starts','returns','leave','s437','sao_issued','sao_revoked']
  records: {
    level: 'National' | 'Regional' | 'Local authority'
    code: string
    name: string
    region_code: string | null
    series: { [yearKey: string]: { [measure: string]: Cell } }
  }[]
  priorSchoolTypeNational: {
    order: string[]                         // 11 prior-school-type labels, display order
    series: { [yearKey: string]: { [typeLabel: string]: { count: Cell; pct: Cell } } }
  }
}
```

Measure meanings: `anytime` = EHE at any point in the year (the 175,900 stock-flow
headline); `starts` / `returns` / `leave` = flows; `s437` = section 437 notices;
`sao_issued` / `sao_revoked` = school attendance orders.

Sample record (Devon, 2024/25):

```json
{ "level": "Local authority", "code": "E10000008", "name": "Devon", "region_code": "E12000009",
  "series": { "202425": { "anytime": { "v": 4030 }, "starts": { "v": 1580 }, "returns": { "v": 680 },
    "leave": { "v": 70 }, "s437": { "v": 10 }, "sao_issued": { "v": null, "f": "low" }, "sao_revoked": { "v": 0 } } } }
```

Prior-school-type is national-only (LA/regional counts largely suppressed).
National counts are suppressed (`x`); use `pct`. Sample:

```json
"202425": { "LA-maintained school": { "count": { "v": null, "f": "x" }, "pct": { "v": 23 } },
            "Academy": { "count": { "v": null, "f": "x" }, "pct": { "v": 49 } } }
```

Enforcement contrast for the view: Devon 4,030 anytime / 10 notices vs Plymouth
1,090 / 100 notices; present as notices per 1,000 EHE children with a
recording-practice caveat.

---

## 6. `map-la.json` (~17 KB, eager)

Latest-autumn rate and count per LA, keyed for the choropleth join against
`public/geo/ctyua_2023_buc.geojson` (join `feature.properties.code === las[].code`).
Sorted by rate descending.

```ts
type MapLa = {
  period: { key: string; year: string; term: string }   // latest autumn (2025/26 Autumn)
  join: string                                            // human note of the join predicate
  las: { code: string; la_name: string; region_name: string | null; rate: Cell; count: Cell }[]
  missingCodes: { code: string; la_name: string }[]       // data codes with NO boundary feature
}
```

Sample:

```json
{ "period": { "key": "202526-Autumn", "year": "2025/26", "term": "Autumn" },
  "join": "properties.code === las[].code",
  "las": [ { "code": "E06000046", "la_name": "Isle of Wight", "region_name": "South East", "rate": { "v": 4.1 }, "count": { "v": 690 } } ],
  "missingCodes": [ { "code": "E10000006", "la_name": "Cumbria" } ] }
```

**`missingCodes` must be surfaced in an amber notice, never silently dropped**
(spec 3.3 item 6). At the current release these are Cumbria, North Yorkshire and
Somerset: April-2023 local-government-reorganisation codes absent from the
Dec-2023 CTYUA boundary vintage. The map is never a map-only channel: pair it
with the sortable ranked table (values as text, suppression hatched).

---

## 7. `headlines.json` (~3 KB, eager)

Every KPI the lead view renders, computed from the data (not hardcoded strings).
Each block carries its own period label.

```ts
type Headlines = {
  england: { period: PeriodLabel; count: Cell; rate: Cell; popBackout: number | null }
  englandAutumnSeries: { period: PeriodLabel; count: Cell; rate: Cell }[]   // 4 autumns, for the sawtooth/rate mini-charts
  sw: {
    period: PeriodLabel; count: Cell; rate: Cell
    rank: number; ofRegions: number                       // 1 of 10
    multipleVsEngland: number | null                       // ~1.33
    autumnRateSeries: { period: PeriodLabel; count: Cell; rate: Cell }[]
  }
  footprint: {
    period: PeriodLabel
    count: number | null; rate: number | null; pop: number | null
    multipleVsEngland: number | null                       // ~1.77
    excessChildren: number | null                          // ~2,509 (illustrative)
    constituents: { [name: string]: { code: string; count: number | null; rate: number | null; pop: number | null } } | null
    suppressed: string[]
    plymouthRateDoubled: { from: number; to: number; fromYear: string; toYear: string; multiple: number | null } | null
  }
  plymouthY10Y11: { period: PeriodLabel; y10pct: number | null; y11pct: number | null; sharePct: number | null; englandSharePct: number | null }
  reasonsShift: {
    period: PeriodLabel
    mentalHealthPct: number | null; philosophicalPct: number | null; unknownPct: number | null
    mentalHealthSeries: { period: string; pct: Cell }[]    // period is the year label here
    philosophicalSeries: { period: string; pct: Cell }[]
  }
  sex: { period: PeriodLabel; female: { count: Cell; pct: Cell }; male: { count: Cell; pct: Cell } }
  yearGroups: { period: PeriodLabel; y10Count: number | null; y11Count: number | null; y10y11Share: number | null }
  flows: {
    year: string | null; prevYear: string | null           // '2024/25' / '2023/24'
    anytime: number | null; anytimePrev: number | null
    starts: number | null; returns: number | null; leave: number | null
    s437: number | null; saoIssued: number | null; saoRevoked: number | null
  }
  source: string
  caveats: { footprintProxy: string; collectionMaturity: string; stockVsFlow: string }
}

type PeriodLabel = { key: string; year: string; term: string }
```

Anchor values at this release: England 126,000 / 1.5; SW 15,830 / 2.0 / rank 1 of
10 / 1.33x; footprint 5,770 / 2.65 / 1.77x / ~2,509 excess; Plymouth Y10+Y11 51%
vs England 36.4%; mental health 16% now above philosophical 12%; flows anytime
175,900 (from 153,300), starts 78,000, returns 28,100, s437 7,400, SAO issued
2,500, revoked 600.

---

## 8. `metadata.json` (~2 KB, written LAST)

Presence gates the tests and the dataService (version-key = `generated_at`).

```ts
type Metadata = {
  generated_at: string                      // ISO build stamp; IndexedDB cache key
  release: 'Autumn term 2025/26'
  source: string
  source_url: string
  licence: 'Open Government Licence v3.0'
  status: 'Official statistics in development'
  census: { file: string; measure: string; periods: PeriodLabel[]; period_count: number; rows: number }   // rows = raw source rows (58,968)
  academic_year: { file: string; measure: string; years: string[]; rows: number }                          // rows = raw source rows (655)
  regions: string[]                         // 10, alphabetical
  region_count: 10
  distinct_la_codes: number                 // 156
  distinct_la_names: number                 // 154
  footprint_las: { [name: string]: string }
  footprint_series_starts: '2023/24 Autumn'
  footprint_excludes: string
  benchmark_las: { [name: string]: string }
  suppression: { x: string; z: string; low: string; blank: string }
}
```

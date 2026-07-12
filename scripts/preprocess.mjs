// Preprocess: stream the two raw DfE Elective Home Education CSVs in data/ into
// compact, view-shaped JSON in public/processed/. Every emitted file's exact
// shape is documented in scripts/DATA_SHAPES.md; the ten view agents build
// against that document, so keep the two in lockstep.
//
// Hard rules enforced here (REBUILD_SPEC.md sections 3 and 4):
//  - 'low', 'x', 'z' and blank ALL parse to null, never 0, with the symbol
//    preserved as a flag (cell = { v: number|null, f?: 'low'|'x'|'z' }).
//    'x' = not available, 'z' = not applicable, 'low' = rounds to 0 but is not 0.
//  - Term is first-class: every figure is a single term-point or a series of
//    distinct term-points. Counts/rates/percentages are NEVER summed or averaged
//    across terms.
//  - Rates and percentages are as-published; never recomputed across geographies
//    or terms. Only counts are summed (across LAs within one period).
//  - Footprint pooled rate = sum(count) / sum(count / rate * 100) * 100, the
//    population back-out identity, never a mean of LA rates. Series starts
//    2023/24 Autumn (2022/23 excluded: Cornwall suppressed).
//  - LA names contain quoted commas ("Bournemouth, Christchurch and Poole"):
//    papaparse handles the quoting; never split naively.

import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Papa from 'papaparse'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'data')
const OUT = join(ROOT, 'public', 'processed')
const GEO = join(ROOT, 'public', 'geo', 'ctyua_2023_buc.geojson')

// ----- constants -----------------------------------------------------------

const ENGLAND_CODE = 'E92000001'
const SW_REGION_CODE = 'E12000009'

// Footprint LAs (name -> new_la_code). Cornwall + Plymouth + Devon.
const FOOTPRINT = {
  Cornwall: 'E06000052',
  Plymouth: 'E06000026',
  Devon: 'E10000008',
}
const FOOTPRINT_ORDER = ['Cornwall', 'Plymouth', 'Devon']

// Benchmarks shown as plain reference series in the footprint view.
const BENCHMARKS = {
  Torbay: 'E06000027',
  Somerset: 'E06000066',
  Dorset: 'E06000059',
}

// Every LA that appears in flows.json / footprint.json by name.
const FLOW_LA_CODES = { ...FOOTPRINT, ...BENCHMARKS }

const TERM_ORDER = { Autumn: 0, Spring: 1, Summer: 2 }

const REASON_ORDER = [
  'Mental health',
  'Physical health',
  'Health concerns related to COVID19',
  'School dissatisfaction general',
  'School dissatisfaction SEND',
  'School dissatisfaction bullying',
  'Lifestyle',
  'Philosophical or preferential',
  'Religious',
  'Risk of school exclusion',
  'Permanent exclusion',
  'Did not get school preference',
  'Difficulty accessing suitable school place',
  'Offered school place but not yet accepted',
  'Did not apply for school place at compulsory school age',
  'School suggestion',
  'Other',
  'No reason given',
  'Unknown',
]
const YEAR_GROUP_ORDER = [
  'Reception',
  'Year 1',
  'Year 2',
  'Year 3',
  'Year 4',
  'Year 5',
  'Year 6',
  'Year 7',
  'Year 8',
  'Year 9',
  'Year 10',
  'Year 11',
  'Unknown',
]
const SEX_ORDER = ['Female', 'Male', 'Unknown']

// Prior-school-type columns in the academic-year file: count key -> display label.
const SCHTYPE = [
  ['ehe_schtype_lamain', 'LA-maintained school'],
  ['ehe_schtype_acad', 'Academy'],
  ['ehe_schtype_free', 'Free school'],
  ['ehe_schtype_ind', 'Independent school'],
  ['ehe_schtype_spec', 'Special school'],
  ['ehe_schtype_ap', 'Alternative provision'],
  ['ehe_schtype_pru', 'Pupil referral unit'],
  ['ehe_schtype_ey', 'Early years'],
  ['ehe_schtype_ehe', 'Already home educated'],
  ['ehe_schtype_none', 'Not previously in school'],
  ['ehe_schtype_else_unk', 'Other / unknown'],
]

// ----- helpers -------------------------------------------------------------

// The one place the suppression rule lives. Returns a cell:
//   live:       { v: 5 }
//   suppressed: { v: null, f: 'x' }   (or 'z' / 'low')
//   blank:      { v: null }
// NEVER returns { v: 0 } for a suppressed symbol.
function cell(raw) {
  if (raw == null) return { v: null }
  const s = String(raw).trim()
  if (s === '') return { v: null }
  if (s === 'low' || s === 'x' || s === 'z') return { v: null, f: s }
  const n = Number(s)
  return Number.isFinite(n) ? { v: n } : { v: null }
}

function round(x, dp) {
  if (x == null || !Number.isFinite(x)) return null
  const f = 10 ** dp
  return Math.round(x * f) / f
}

// Population back-out from a count and its as-published rate per 100.
// pop = count / rate * 100. Null if either input is null or rate is 0.
function backoutPop(count, rate) {
  if (count == null || rate == null || rate === 0) return null
  return round((count / rate) * 100, 0)
}

function yearLabel(timePeriod) {
  const s = String(timePeriod)
  return `${s.slice(0, 4)}/${s.slice(4)}` // 202526 -> 2025/26
}
function startYear(timePeriod) {
  return Number(String(timePeriod).slice(0, 4))
}
function termName(timeIdentifier) {
  return String(timeIdentifier).replace(' term', '').trim() // 'Autumn term' -> 'Autumn'
}
function periodKey(timePeriod, term) {
  return `${timePeriod}-${term}`
}
function periodSort(timePeriod, term) {
  return startYear(timePeriod) * 3 + (TERM_ORDER[term] ?? 9)
}

function geoOf(r) {
  const level = r.geographic_level
  if (level === 'National') {
    return { level, code: r.country_code || ENGLAND_CODE, name: r.country_name || 'England', region_code: null, region_name: null }
  }
  if (level === 'Regional') {
    return { level, code: r.region_code, name: r.region_name, region_code: null, region_name: r.region_name }
  }
  if (level === 'Local authority') {
    return { level, code: r.new_la_code, name: r.la_name, region_code: r.region_code || null, region_name: r.region_name || null }
  }
  return null
}

function streamCsv(path, onRow) {
  return new Promise((resolve, reject) => {
    Papa.parse(createReadStream(path, { encoding: 'utf-8' }), {
      header: true,
      skipEmptyLines: true,
      step: (res) => onRow(res.data),
      complete: resolve,
      error: reject,
    })
  })
}

function writeJson(name, data) {
  const json = JSON.stringify(data)
  writeFileSync(join(OUT, name), json)
  const kb = (Buffer.byteLength(json) / 1024).toFixed(1)
  console.log(`  wrote ${name} (${kb} KB)`)
}

// ----- accumulators --------------------------------------------------------

const periodsMap = new Map() // key -> { key, year, term, timePeriod, sort }
function notePeriod(timePeriod, term) {
  const key = periodKey(timePeriod, term)
  if (!periodsMap.has(key)) {
    periodsMap.set(key, { key, year: yearLabel(timePeriod), term, timePeriod: String(timePeriod), sort: periodSort(timePeriod, term) })
  }
  return key
}

// Total-topic rows: geoKey -> { level, code, name, region_code, region_name, series: {periodKey -> {count, rate, percent, pop}} }
const totals = new Map()
// Breakdown rows (Sex / Year group / Reason). Keep National+Regional and LA separately.
// key: `${level}|${code}|${topic}|${breakdown}` -> { level, code, name, region_code, region_name, topic, breakdown, series: {periodKey -> {count, percent}} }
const bdNatReg = new Map()
const bdLa = new Map()

function totalKey(g) {
  return `${g.level}|${g.code}`
}
function bdRecKey(g, topic, breakdown) {
  return `${g.level}|${g.code}|${topic}|${breakdown}`
}

// ----- pass 1: census (stock) ----------------------------------------------

async function passCensus() {
  const path = join(DATA, 'ehe_census.csv')
  console.log('reading', path)
  await streamCsv(path, (r) => {
    censusRowCount++
    const g = geoOf(r)
    if (!g || !g.code) return
    const term = termName(r.time_identifier)
    const pk = notePeriod(r.time_period, term)
    const topic = r.breakdown_topic

    if (topic === 'Total') {
      const rec =
        totals.get(totalKey(g)) ||
        { level: g.level, code: g.code, name: g.name, region_code: g.region_code, region_name: g.region_name, series: {} }
      const count = cell(r.child_count)
      const rate = cell(r.rate_per_100)
      const percent = cell(r.child_percent)
      rec.series[pk] = { count, rate, percent, pop: backoutPop(count.v, rate.v) }
      totals.set(totalKey(g), rec)
      return
    }

    if (topic === 'Sex' || topic === 'Year group' || topic === 'Reason') {
      const store = g.level === 'Local authority' ? bdLa : bdNatReg
      const k = bdRecKey(g, topic, r.breakdown)
      const rec =
        store.get(k) ||
        {
          level: g.level, code: g.code, name: g.name,
          region_code: g.region_code, region_name: g.region_name,
          topic, breakdown: r.breakdown, series: {},
        }
      rec.series[pk] = { count: cell(r.child_count), percent: cell(r.child_percent) }
      store.set(k, rec)
    }
  })
}

// ----- pass 2: academic year (flows) ---------------------------------------

// flows[geoKey] -> { level, code, name, region_code, series: {yearKey -> {measure -> cell}}, schtype: {yearKey -> {label -> {count, pct}}} }
const flows = new Map()
const flowYears = new Map() // timePeriod -> label
const FLOW_MEASURES = [
  ['anytime', 'ehe_anytime_full_year'],
  ['starts', 'ehe_starts_full_year'],
  ['returns', 'ehe_returns_full_year'],
  ['leave', 'ehe_leave'],
  ['s437', 'ehe_section_437_full_year'],
  ['sao_issued', 'ehe_sao_issued_full_year'],
  ['sao_revoked', 'ehe_sao_revoked_full_year'],
]

function wantFlowGeo(g) {
  if (g.level === 'National') return true
  if (g.level === 'Regional' && g.code === SW_REGION_CODE) return true
  if (g.level === 'Local authority' && Object.values(FLOW_LA_CODES).includes(g.code)) return true
  return false
}

async function passAcademic() {
  const path = join(DATA, 'ehe_academic_year.csv')
  console.log('reading', path)
  await streamCsv(path, (r) => {
    academicRowCount++
    const g = geoOf(r)
    if (!g || !g.code || !wantFlowGeo(g)) return
    const yk = String(r.time_period)
    flowYears.set(yk, yearLabel(yk))
    const rec =
      flows.get(totalKey(g)) ||
      { level: g.level, code: g.code, name: g.name, region_code: g.region_code, series: {}, schtype: {} }
    const m = {}
    for (const [label, col] of FLOW_MEASURES) m[label] = cell(r[col])
    rec.series[yk] = m
    const st = {}
    for (const [col, label] of SCHTYPE) {
      st[label] = { count: cell(r[col]), pct: cell(r[`${col}_pc`]) }
    }
    rec.schtype[yk] = st
    flows.set(totalKey(g), rec)
  })
}

// ----- derived structures --------------------------------------------------

function orderedPeriods() {
  return [...periodsMap.values()].sort((a, b) => a.sort - b.sort)
}
function orderedFlowYears() {
  return [...flowYears.keys()].sort().map((k) => ({ key: k, label: flowYears.get(k) }))
}

// A period-keyed lookup into the Total series for a given LA/geo code.
function totalCell(code, level, pk) {
  const rec = totals.get(`${level}|${code}`)
  return rec ? rec.series[pk] : undefined
}
function englandTotalAt(pk) {
  return totalCell(ENGLAND_CODE, 'National', pk)
}
function swTotalAt(pk) {
  return totalCell(SW_REGION_CODE, 'Regional', pk)
}

// Footprint pooled aggregate at a term-point. Sums LIVE counts and their
// back-out populations across Cornwall/Plymouth/Devon; pooled rate is the
// population-weighted identity. Returns null if no constituent is live.
function footprintAt(pk) {
  let sumN = 0
  let sumPop = 0
  const constituents = {}
  const suppressed = []
  let anyLive = false
  for (const name of FOOTPRINT_ORDER) {
    const code = FOOTPRINT[name]
    const c = totalCell(code, 'Local authority', pk)
    const count = c?.count?.v ?? null
    const rate = c?.rate?.v ?? null
    const pop = c?.pop ?? null
    constituents[name] = { code, count: count, rate: rate, pop: pop }
    if (count != null && pop != null) {
      sumN += count
      sumPop += pop
      anyLive = true
    } else {
      suppressed.push(name)
    }
  }
  if (!anyLive || sumPop === 0) return null
  return {
    count: sumN,
    pop: round(sumPop, 0),
    rate: round((sumN / sumPop) * 100, 2),
    constituents,
    suppressed,
  }
}

// ----- build: totals.json --------------------------------------------------

function buildTotals(periods) {
  const geographies = [...totals.values()].map((rec) => ({
    level: rec.level,
    code: rec.code,
    name: rec.name,
    region_code: rec.region_code,
    region_name: rec.region_name,
    series: rec.series,
  }))
  return { periods, geographies }
}

// ----- build: breakdowns.json / breakdowns-la.json -------------------------

function bdRecordsFrom(store) {
  return [...store.values()].map((rec) => ({
    level: rec.level,
    code: rec.code,
    name: rec.name,
    region_code: rec.region_code,
    region_name: rec.region_name,
    topic: rec.topic,
    breakdown: rec.breakdown,
    series: rec.series,
  }))
}

function buildBreakdowns(periods) {
  return {
    periods,
    reasonOrder: REASON_ORDER,
    yearGroupOrder: YEAR_GROUP_ORDER,
    sexOrder: SEX_ORDER,
    records: bdRecordsFrom(bdNatReg),
  }
}
// The LA breakdowns exceed ~4 MB combined, so they are split into one file per
// topic (spec 3.3 item 3). Each carries only the order list it needs.
function buildBreakdownsLaByTopic(periods) {
  const all = bdRecordsFrom(bdLa)
  const pick = (topic) => all.filter((r) => r.topic === topic)
  return {
    'breakdowns-la-reason.json': { periods, topic: 'Reason', reasonOrder: REASON_ORDER, records: pick('Reason') },
    'breakdowns-la-yeargroup.json': { periods, topic: 'Year group', yearGroupOrder: YEAR_GROUP_ORDER, records: pick('Year group') },
    'breakdowns-la-sex.json': { periods, topic: 'Sex', sexOrder: SEX_ORDER, records: pick('Sex') },
  }
}

// ----- build: footprint.json -----------------------------------------------

function buildFootprint(periods) {
  // Footprint series starts 2023/24 Autumn (2022/23 excluded: Cornwall
  // suppressed, so no aggregate row can exist).
  const START_SORT = periodSort('202324', 'Autumn')
  const fpPeriods = periods.filter((p) => p.sort >= START_SORT)

  const series = fpPeriods
    .map((p) => {
      const agg = footprintAt(p.key)
      if (!agg) return null
      const eng = englandTotalAt(p.key)
      const sw = swTotalAt(p.key)
      const englandRate = eng?.rate?.v ?? null
      const expected = englandRate != null && agg.pop != null ? (agg.pop * englandRate) / 100 : null
      return {
        key: p.key,
        year: p.year,
        term: p.term,
        sort: p.sort,
        count: agg.count,
        rate: agg.rate,
        pop: agg.pop,
        constituents: agg.constituents,
        suppressed: agg.suppressed,
        england: { count: eng?.count?.v ?? null, rate: englandRate },
        sw: { count: sw?.count?.v ?? null, rate: sw?.rate?.v ?? null },
        excessVsEngland: {
          multiple: englandRate ? round(agg.rate / englandRate, 2) : null,
          excessChildren: expected != null ? round(agg.count - expected, 0) : null,
          expectedAtEnglandRate: expected != null ? round(expected, 0) : null,
        },
      }
    })
    .filter(Boolean)

  // Benchmarks as plain series over the same footprint periods.
  const benchmarks = {}
  for (const [name, code] of Object.entries(BENCHMARKS)) {
    const s = {}
    for (const p of fpPeriods) {
      const c = totalCell(code, 'Local authority', p.key)
      if (c) s[p.key] = { count: c.count, rate: c.rate }
    }
    benchmarks[name] = { code, series: s }
  }

  // Footprint year-group aggregate for the latest footprint period: sum of LIVE
  // constituent counts per year group, with a suppressed-cells-excluded note.
  const latest = fpPeriods[fpPeriods.length - 1]
  const yearGroupLatest = { period: latest ? { key: latest.key, year: latest.year, term: latest.term } : null, order: YEAR_GROUP_ORDER, groups: [] }
  if (latest) {
    for (const yg of YEAR_GROUP_ORDER) {
      let sum = 0
      let anyLive = false
      const suppressedConstituents = []
      for (const name of FOOTPRINT_ORDER) {
        const code = FOOTPRINT[name]
        const rec = bdLa.get(`Local authority|${code}|Year group|${yg}`)
        const c = rec?.series?.[latest.key]?.count
        if (c && c.v != null) {
          sum += c.v
          anyLive = true
        } else {
          suppressedConstituents.push(name)
        }
      }
      yearGroupLatest.groups.push({ breakdown: yg, count: anyLive ? sum : null, suppressedConstituents })
    }
    yearGroupLatest.note = 'Summed live constituent counts; excludes suppressed small cells.'
  }

  return {
    periods: fpPeriods,
    constituentOrder: FOOTPRINT_ORDER,
    constituentCodes: FOOTPRINT,
    benchmarkCodes: BENCHMARKS,
    excludedYear: '2022/23',
    excludedReason: 'Cornwall suppressed in 2022/23; no pooled aggregate row exists.',
    series,
    benchmarks,
    yearGroupLatest,
  }
}

// ----- build: flows.json ---------------------------------------------------

function buildFlows(years) {
  const records = [...flows.values()].map((rec) => ({
    level: rec.level,
    code: rec.code,
    name: rec.name,
    region_code: rec.region_code,
    series: rec.series,
  }))
  // Prior-school-type mix, national only (LA/regional counts largely suppressed).
  const nat = flows.get(`National|${ENGLAND_CODE}`)
  const priorSchoolTypeNational = { order: SCHTYPE.map(([, label]) => label), series: nat ? nat.schtype : {} }
  return {
    years,
    measures: FLOW_MEASURES.map(([label]) => label),
    records,
    priorSchoolTypeNational,
  }
}

// ----- build: map-la.json --------------------------------------------------

function buildMapLa(periods) {
  const autumns = periods.filter((p) => p.term === 'Autumn')
  const latest = autumns[autumns.length - 1]
  // Boundary codes present in the ONS CTYUA geojson (join target).
  let boundaryCodes = new Set()
  try {
    const geo = JSON.parse(readFileSync(GEO, 'utf-8'))
    boundaryCodes = new Set(geo.features.map((f) => f.properties.code))
  } catch (e) {
    console.warn('  map-la: could not read geojson, missingCodes will be empty:', e.message)
  }

  const las = []
  const missingCodes = []
  for (const rec of totals.values()) {
    if (rec.level !== 'Local authority') continue
    // missingCodes is surfaced (never silently dropped, spec 3.3(6)) for any LA
    // code absent from the December 2023 boundary vintage, including abolished
    // pre-April-2023 county codes that only carry historical data.
    if (!boundaryCodes.has(rec.code)) missingCodes.push({ code: rec.code, la_name: rec.name })
    const c = rec.series[latest.key]
    // An LA with no series entry for the latest autumn is not part of the
    // current geography (e.g. the pre-LGR county codes E10000006 Cumbria,
    // E10000023 North Yorkshire, E10000027 Somerset, abolished April 2023). It
    // is surfaced in missingCodes above but excluded from the ranked table so it
    // does not appear as a phantom 'n/a' row duplicating its live successor.
    if (!c) continue
    las.push({
      code: rec.code,
      la_name: rec.name,
      region_name: rec.region_name,
      rate: c.rate,
      count: c.count,
    })
  }
  las.sort((a, b) => (b.rate.v ?? -1) - (a.rate.v ?? -1))
  return {
    period: { key: latest.key, year: latest.year, term: latest.term },
    join: 'properties.code === las[].code',
    las,
    missingCodes,
  }
}

// ----- build: headlines.json -----------------------------------------------

function autumnSeriesFor(code, level) {
  const rec = totals.get(`${level}|${code}`)
  if (!rec) return []
  return orderedPeriods()
    .filter((p) => p.term === 'Autumn')
    .map((p) => ({ period: { key: p.key, year: p.year, term: p.term }, count: rec.series[p.key]?.count ?? { v: null }, rate: rec.series[p.key]?.rate ?? { v: null } }))
}

function bdSeries(store, level, code, topic, breakdown, field) {
  const rec = store.get(`${level}|${code}|${topic}|${breakdown}`)
  if (!rec) return {}
  return rec.series
}

function buildHeadlines(periods) {
  const autumns = periods.filter((p) => p.term === 'Autumn')
  const latestAutumn = autumns[autumns.length - 1]
  const pk = latestAutumn.key

  const eng = englandTotalAt(pk)
  const sw = swTotalAt(pk)
  const englandRate = eng?.rate?.v ?? null

  // SW rank among the 10 regions (by rate), latest autumn.
  const regionRates = [...totals.values()]
    .filter((r) => r.level === 'Regional')
    .map((r) => ({ name: r.name, rate: r.series[pk]?.rate?.v ?? null }))
    .filter((r) => r.rate != null)
    .sort((a, b) => b.rate - a.rate)
  const swRank = regionRates.findIndex((r) => r.name === 'South West') + 1

  const fp = footprintAt(pk)
  const fpExpected = englandRate != null && fp?.pop != null ? (fp.pop * englandRate) / 100 : null

  // Plymouth rate doubled: earliest live footprint-era Plymouth rate vs latest.
  const plymCode = FOOTPRINT.Plymouth
  const plymAutumns = autumns
    .map((p) => ({ p, rate: totalCell(plymCode, 'Local authority', p.key)?.rate?.v ?? null }))
    .filter((x) => x.rate != null)
  const plymFirst = plymAutumns[0]
  const plymLast = plymAutumns[plymAutumns.length - 1]

  // Plymouth Y10 + Y11 share, latest autumn.
  const plymY10 = bdLa.get(`Local authority|${plymCode}|Year group|Year 10`)?.series?.[pk]?.percent?.v ?? null
  const plymY11 = bdLa.get(`Local authority|${plymCode}|Year group|Year 11`)?.series?.[pk]?.percent?.v ?? null

  // England Y10 + Y11 counts and share.
  const engY10 = bdNatReg.get(`National|${ENGLAND_CODE}|Year group|Year 10`)?.series?.[pk]?.count?.v ?? null
  const engY11 = bdNatReg.get(`National|${ENGLAND_CODE}|Year group|Year 11`)?.series?.[pk]?.count?.v ?? null
  const engY10Y11Share = engY10 != null && engY11 != null && eng?.count?.v ? round(((engY10 + engY11) / eng.count.v) * 100, 1) : null

  // Reasons shift (national, autumn series).
  const mhSeries = autumns.map((p) => ({ period: p.year, pct: bdNatReg.get(`National|${ENGLAND_CODE}|Reason|Mental health`)?.series?.[p.key]?.percent ?? { v: null } }))
  const philSeries = autumns.map((p) => ({ period: p.year, pct: bdNatReg.get(`National|${ENGLAND_CODE}|Reason|Philosophical or preferential`)?.series?.[p.key]?.percent ?? { v: null } }))
  const unknownPct = bdNatReg.get(`National|${ENGLAND_CODE}|Reason|Unknown`)?.series?.[pk]?.percent?.v ?? null

  // Sex, latest autumn.
  const femaleRec = bdNatReg.get(`National|${ENGLAND_CODE}|Sex|Female`)?.series?.[pk]
  const maleRec = bdNatReg.get(`National|${ENGLAND_CODE}|Sex|Male`)?.series?.[pk]

  // Flows, latest academic year.
  const flowYearsSorted = [...flowYears.keys()].sort()
  const latestFlowYear = flowYearsSorted[flowYearsSorted.length - 1]
  const prevFlowYear = flowYearsSorted[flowYearsSorted.length - 2]
  const natFlow = flows.get(`National|${ENGLAND_CODE}`)
  const fv = (yr, m) => natFlow?.series?.[yr]?.[m]?.v ?? null

  return {
    england: {
      period: { key: pk, year: latestAutumn.year, term: latestAutumn.term },
      count: eng?.count ?? { v: null },
      rate: eng?.rate ?? { v: null },
      popBackout: eng?.pop ?? null,
    },
    englandAutumnSeries: autumnSeriesFor(ENGLAND_CODE, 'National'),
    sw: {
      period: { key: pk, year: latestAutumn.year, term: latestAutumn.term },
      count: sw?.count ?? { v: null },
      rate: sw?.rate ?? { v: null },
      rank: swRank,
      ofRegions: regionRates.length,
      multipleVsEngland: englandRate ? round((sw?.rate?.v ?? 0) / englandRate, 2) : null,
      autumnRateSeries: autumnSeriesFor(SW_REGION_CODE, 'Regional'),
    },
    footprint: {
      period: { key: pk, year: latestAutumn.year, term: latestAutumn.term },
      count: fp?.count ?? null,
      rate: fp?.rate ?? null,
      pop: fp?.pop ?? null,
      multipleVsEngland: englandRate && fp?.rate != null ? round(fp.rate / englandRate, 2) : null,
      excessChildren: fpExpected != null && fp?.count != null ? round(fp.count - fpExpected, 0) : null,
      constituents: fp?.constituents ?? null,
      suppressed: fp?.suppressed ?? [],
      plymouthRateDoubled: plymFirst && plymLast ? { from: plymFirst.rate, to: plymLast.rate, fromYear: plymFirst.p.year, toYear: plymLast.p.year, multiple: plymFirst.rate ? round(plymLast.rate / plymFirst.rate, 2) : null } : null,
    },
    plymouthY10Y11: {
      period: { key: pk, year: latestAutumn.year, term: latestAutumn.term },
      y10pct: plymY10,
      y11pct: plymY11,
      sharePct: plymY10 != null && plymY11 != null ? plymY10 + plymY11 : null,
      englandSharePct: engY10Y11Share,
    },
    reasonsShift: {
      period: { key: pk, year: latestAutumn.year, term: latestAutumn.term },
      mentalHealthPct: bdNatReg.get(`National|${ENGLAND_CODE}|Reason|Mental health`)?.series?.[pk]?.percent?.v ?? null,
      philosophicalPct: bdNatReg.get(`National|${ENGLAND_CODE}|Reason|Philosophical or preferential`)?.series?.[pk]?.percent?.v ?? null,
      unknownPct,
      mentalHealthSeries: mhSeries,
      philosophicalSeries: philSeries,
    },
    sex: {
      period: { key: pk, year: latestAutumn.year, term: latestAutumn.term },
      female: { count: femaleRec?.count ?? { v: null }, pct: femaleRec?.percent ?? { v: null } },
      male: { count: maleRec?.count ?? { v: null }, pct: maleRec?.percent ?? { v: null } },
    },
    yearGroups: {
      period: { key: pk, year: latestAutumn.year, term: latestAutumn.term },
      y10Count: engY10,
      y11Count: engY11,
      y10y11Share: engY10Y11Share,
    },
    flows: {
      year: latestFlowYear ? yearLabel(latestFlowYear) : null,
      prevYear: prevFlowYear ? yearLabel(prevFlowYear) : null,
      anytime: fv(latestFlowYear, 'anytime'),
      anytimePrev: fv(prevFlowYear, 'anytime'),
      starts: fv(latestFlowYear, 'starts'),
      returns: fv(latestFlowYear, 'returns'),
      leave: fv(latestFlowYear, 'leave'),
      s437: fv(latestFlowYear, 's437'),
      saoIssued: fv(latestFlowYear, 'sao_issued'),
      saoRevoked: fv(latestFlowYear, 'sao_revoked'),
    },
    source: 'DfE Elective home education, Autumn term 2025/26',
    caveats: {
      footprintProxy: 'Footprint figures are LA-area children (Cornwall, Plymouth, Devon), not WeST pupils.',
      collectionMaturity: 'Voluntary collection from autumn 2022, mandatory from autumn 2024; part of the apparent growth is improved coverage. Official statistics in development.',
      stockVsFlow: 'Census-date stock (termly) and at-any-point flow (annual, one year behind) are different measures and are never reconciled arithmetically.',
    },
  }
}

// ----- build: metadata.json ------------------------------------------------

function buildMetadata(periods, years) {
  const laCodes = new Set()
  const laNames = new Set()
  for (const rec of totals.values()) {
    if (rec.level === 'Local authority') {
      laCodes.add(rec.code)
      laNames.add(rec.name)
    }
  }
  const regions = [...totals.values()].filter((r) => r.level === 'Regional').map((r) => r.name).sort()
  return {
    generated_at: new Date().toISOString(),
    release: 'Autumn term 2025/26',
    source: 'DfE Elective home education, Autumn term 2025/26',
    source_url: 'https://explore-education-statistics.service.gov.uk/find-statistics/elective-home-education/2025-26-autumn-term',
    licence: 'Open Government Licence v3.0',
    status: 'Official statistics in development',
    census: {
      file: 'ehe_census.csv',
      measure: 'Census-date stock (termly)',
      periods: periods.map((p) => ({ key: p.key, year: p.year, term: p.term })),
      period_count: periods.length,
      rows: censusRowCount,
    },
    academic_year: {
      file: 'ehe_academic_year.csv',
      measure: 'At-any-point flow (annual, one year behind the census file)',
      years: years.map((y) => y.label),
      rows: academicRowCount,
    },
    regions,
    region_count: regions.length,
    distinct_la_codes: laCodes.size,
    distinct_la_names: laNames.size,
    footprint_las: FOOTPRINT,
    footprint_series_starts: '2023/24 Autumn',
    footprint_excludes: '2022/23 (Cornwall suppressed)',
    benchmark_las: BENCHMARKS,
    suppression: { x: 'not available', z: 'not applicable', low: 'rounds to 0 but is not 0', blank: 'no data' },
  }
}

// ----- main ----------------------------------------------------------------

let censusRowCount = 0
let academicRowCount = 0

async function main() {
  mkdirSync(OUT, { recursive: true })
  console.log('Preprocessing DfE Elective Home Education data ->', OUT)

  await passCensus()
  await passAcademic()

  const periods = orderedPeriods().map((p) => ({ key: p.key, year: p.year, term: p.term, sort: p.sort }))
  const years = orderedFlowYears()

  console.log('building outputs')
  writeJson('totals.json', buildTotals(periods))
  writeJson('breakdowns.json', buildBreakdowns(periods))
  for (const [name, payload] of Object.entries(buildBreakdownsLaByTopic(periods))) writeJson(name, payload)
  writeJson('footprint.json', buildFootprint(periods))
  writeJson('flows.json', buildFlows(years))
  writeJson('map-la.json', buildMapLa(periods))
  writeJson('headlines.json', buildHeadlines(periods))

  // metadata.json written LAST: its presence gates the tests and dataService.
  writeJson('metadata.json', buildMetadata(periods, years))

  console.log(
    `done. periods: ${periods.length}; flow years: ${years.length}; ` +
      `LA codes: ${new Set([...totals.values()].filter((r) => r.level === 'Local authority').map((r) => r.code)).size}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

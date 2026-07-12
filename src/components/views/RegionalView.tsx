import { useEffect, useMemo, useState } from 'react'
import { ChartCard } from '../ChartCard'
import { KpiCard } from '../KpiCard'
import { BarChart, type Bar, type RefLine } from '../charts/BarChart'
import { LineChart, type LineSeries } from '../charts/LineChart'
import { ScatterChart, type ScatterPoint } from '../charts/ScatterChart'
import { loadProcessed } from '../../services/dataService'
import { getGeoColor, type GeoRole } from '../../utils/colors'
import { formatRate, FLAG_MEANING, NA } from '../../utils/formatting'
import type { Cell, SuppressFlag } from '../../types'

// View-local data shapes, matching scripts/DATA_SHAPES.md sections 1 (totals.json)
// and 2 (breakdowns.json). Defined here (not imported from ../../types) because
// the shared Period type there differs in field names from the actual processed
// JSON (key/sort vs sortKey); this view builds directly against the documented
// JSON contract instead.
interface TermPeriod {
  key: string
  year: string
  term: 'Autumn' | 'Spring' | 'Summer'
  sort: number
}

interface TotalsSeriesEntry {
  count: Cell
  rate: Cell
  percent: Cell
  pop: number | null
}

interface TotalsGeography {
  level: 'National' | 'Regional' | 'Local authority'
  code: string
  name: string
  region_code: string | null
  region_name: string | null
  series: Record<string, TotalsSeriesEntry>
}

interface Totals {
  periods: TermPeriod[]
  geographies: TotalsGeography[]
}

interface BreakdownSeriesEntry {
  count: Cell
  percent: Cell
}

interface BreakdownRecord {
  level: 'National' | 'Regional'
  code: string
  name: string
  region_code: string | null
  region_name: string | null
  topic: 'Sex' | 'Year group' | 'Reason'
  breakdown: string
  series: Record<string, BreakdownSeriesEntry>
}

interface Breakdowns {
  periods: TermPeriod[]
  reasonOrder: string[]
  yearGroupOrder: string[]
  sexOrder: string[]
  records: BreakdownRecord[]
}

// Footprint LAs get their fixed dashboard colour everywhere else in the app;
// the named benchmarks get the muted benchmark grey; every other South West LA
// is the low-emphasis "other" grey (spec section 7: one fixed colour per place).
const FOOTPRINT_LA_ROLE: Record<string, GeoRole> = {
  Cornwall: 'cornwall',
  Plymouth: 'plymouth',
  Devon: 'devon',
}
const BENCHMARK_LAS = new Set(['Torbay', 'Somerset', 'Dorset'])

function laRole(name: string): GeoRole {
  return FOOTPRINT_LA_ROLE[name] ?? (BENCHMARK_LAS.has(name) ? 'benchmark' : 'other')
}

// A ratio of two already-published rates, never a recomputed rate itself (spec
// 4.2); used only for the SW-vs-England multiple panel.
function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null
  return numerator / denominator
}

function pctGrowth(from: number | null, to: number | null): number | null {
  if (from == null || to == null || from === 0) return null
  return ((to - from) / from) * 100
}

// Deltas and relative changes are colour-neutral with an explicit sign (spec
// section 7: rising EHE is neither good nor bad).
function signedPct(v: number | null): string {
  if (v == null || Number.isNaN(v)) return NA
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(0)}%`
}

function findGeo(totals: Totals, level: TotalsGeography['level'], name: string): TotalsGeography | undefined {
  return totals.geographies.find((g) => g.level === level && g.name === name)
}

function bkPct(
  breakdowns: Breakdowns,
  level: 'National' | 'Regional',
  name: string,
  topic: BreakdownRecord['topic'],
  breakdown: string,
  periodKey: string,
): number | null {
  const rec = breakdowns.records.find(
    (r) => r.level === level && r.name === name && r.topic === topic && r.breakdown === breakdown,
  )
  return rec?.series[periodKey]?.percent.v ?? null
}

// Sex and year-group scatter colours encode "which breakdown", not a
// geography, so they are deliberately outside the GeoRole palette to avoid
// implying a place-colour meaning they do not carry here.
const SCATTER_COLOR = { yearGroup: '#0e7490', sex: '#b45309' }

export function RegionalView() {
  // undefined = still loading; null = fetch failed (distinct from not-yet-loaded)
  const [totals, setTotals] = useState<Totals | null | undefined>(undefined)
  const [breakdowns, setBreakdowns] = useState<Breakdowns | null>(null)

  useEffect(() => {
    let alive = true
    void loadProcessed<Totals>('totals.json').then((d) => {
      if (alive) setTotals(d)
    })
    void loadProcessed<Breakdowns>('breakdowns.json').then((d) => {
      if (alive) setBreakdowns(d)
    })
    return () => {
      alive = false
    }
  }, [])

  const model = useMemo(() => {
    if (!totals) return null

    const autumnPeriods = totals.periods.filter((p) => p.term === 'Autumn').sort((a, b) => a.sort - b.sort)
    const latest = autumnPeriods[autumnPeriods.length - 1]
    if (!latest) return null

    const england = findGeo(totals, 'National', 'England')
    const sw = findGeo(totals, 'Regional', 'South West')
    const englandLatest = england?.series[latest.key]
    const swLatest = sw?.series[latest.key]

    // --- Chart 1: all 10 regions ranked on the published rate ---------------
    const regions = totals.geographies
      .filter((g) => g.level === 'Regional')
      .map((g) => ({ name: g.name, rate: g.series[latest.key]?.rate.v ?? null }))
      .filter((r): r is { name: string; rate: number } => r.rate != null)
      .sort((a, b) => b.rate - a.rate)

    const regionBars: Bar[] = regions.map((r) => ({
      id: r.name,
      label: r.name,
      value: r.rate,
      role: r.name === 'South West' ? 'southWest' : 'other',
      highlight: r.name === 'South West',
    }))
    const regionRefLines: RefLine[] =
      englandLatest?.rate.v != null
        ? [{ value: englandLatest.rate.v, label: 'England', color: getGeoColor('england') }]
        : []
    const swRank = regions.findIndex((r) => r.name === 'South West') + 1

    // --- Chart 2: SW vs England autumn-to-autumn trend + ratio panel --------
    // Autumn-only by construction (spec 4.4: year-on-year is autumn-to-autumn
    // only); this never mixes in spring/summer within-year build-up figures.
    const englandTrend = autumnPeriods.map((p) => england?.series[p.key]?.rate.v ?? null)
    const swTrend = autumnPeriods.map((p) => sw?.series[p.key]?.rate.v ?? null)
    // Proportional growth is computed on the published COUNTS (the population),
    // not the rates: England count grows +56% and South West count +56% over the
    // three autumns, so the "essentially the same proportional growth" claim holds
    // (spec 5.3). Rate growth would be +50% vs +33%, a divergence the ratio panel
    // already captures; using it here would contradict that panel.
    const englandCountTrend = autumnPeriods.map((p) => england?.series[p.key]?.count.v ?? null)
    const swCountTrend = autumnPeriods.map((p) => sw?.series[p.key]?.count.v ?? null)
    const trendSeries: LineSeries[] = [
      {
        id: 'England',
        role: 'england',
        dashed: true,
        data: autumnPeriods.map((_, i) => ({ x: i, y: englandTrend[i] ?? null })),
      },
      {
        id: 'South West',
        role: 'southWest',
        width: 3,
        data: autumnPeriods.map((_, i) => ({ x: i, y: swTrend[i] ?? null })),
      },
    ]
    const ratioRows = autumnPeriods.map((p, i) => ({
      year: p.year,
      value: ratio(swTrend[i], englandTrend[i]),
    }))
    const ratioValues = ratioRows.map((r) => r.value).filter((v): v is number => v != null)
    const ratioMin = ratioValues.length ? Math.min(...ratioValues) : null
    const ratioMax = ratioValues.length ? Math.max(...ratioValues) : null
    const englandGrowth = pctGrowth(
      englandCountTrend[0] ?? null,
      englandCountTrend[englandCountTrend.length - 1] ?? null,
    )
    const swGrowth = pctGrowth(swCountTrend[0] ?? null, swCountTrend[swCountTrend.length - 1] ?? null)

    // --- Chart 3: within-South-West LA ranking ------------------------------
    const swLaRows = totals.geographies
      .filter((g) => g.level === 'Local authority' && g.region_name === 'South West')
      .map((g) => ({ name: g.name, entry: g.series[latest.key] }))
      .filter((r): r is { name: string; entry: TotalsSeriesEntry } => r.entry != null)
      .map((r) => ({ name: r.name, rate: r.entry.rate.v, count: r.entry.count }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))
    const laBars: Bar[] = swLaRows.map((r) => ({
      id: r.name,
      label: r.name,
      value: r.rate,
      role: laRole(r.name),
      highlight: laRole(r.name) !== 'other',
    }))
    const laRefLines: RefLine[] =
      englandLatest?.rate.v != null
        ? [{ value: englandLatest.rate.v, label: 'England', color: getGeoColor('england') }]
        : []
    const suppressedLas = swLaRows.filter((r) => r.count.v == null && r.count.f)
    const suppressionSymbols = [
      ...new Set(suppressedLas.map((l) => l.count.f).filter((v): v is SuppressFlag => Boolean(v))),
    ]

    // --- Chart 4: sex and year-group "no difference" scatter ---------------
    let scatterPoints: ScatterPoint[] = []
    if (breakdowns) {
      const ygPoints = breakdowns.yearGroupOrder
        .map((name): ScatterPoint | null => {
          const eng = bkPct(breakdowns, 'National', 'England', 'Year group', name, latest.key)
          const sww = bkPct(breakdowns, 'Regional', 'South West', 'Year group', name, latest.key)
          if (eng == null || sww == null) return null
          return { id: `yg-${name}`, label: name, x: eng, y: sww, color: SCATTER_COLOR.yearGroup }
        })
        .filter((p): p is ScatterPoint => p != null)
      const sexPoints = breakdowns.sexOrder
        .filter((s) => s !== 'Unknown')
        .map((name): ScatterPoint | null => {
          const eng = bkPct(breakdowns, 'National', 'England', 'Sex', name, latest.key)
          const sww = bkPct(breakdowns, 'Regional', 'South West', 'Sex', name, latest.key)
          if (eng == null || sww == null) return null
          return { id: `sex-${name}`, label: name, x: eng, y: sww, color: SCATTER_COLOR.sex }
        })
        .filter((p): p is ScatterPoint => p != null)
      scatterPoints = [...ygPoints, ...sexPoints]
    }

    return {
      latest,
      englandLatest,
      swLatest,
      regionBars,
      regionRefLines,
      swRank,
      regionsCount: regions.length,
      trendSeries,
      autumnPeriods,
      ratioRows,
      ratioMin,
      ratioMax,
      englandGrowth,
      swGrowth,
      laBars,
      laRefLines,
      suppressedLas,
      suppressionSymbols,
      scatterPoints,
    }
  }, [totals, breakdowns])

  if (totals === null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        No processed data found. Run <code>npm run preprocess</code> first.
      </div>
    )
  }
  if (!model) return <div className="p-8 text-sm text-slate-500">Loading data...</div>

  const {
    latest,
    englandLatest,
    swLatest,
    regionBars,
    regionRefLines,
    swRank,
    regionsCount,
    trendSeries,
    autumnPeriods,
    ratioRows,
    ratioMin,
    ratioMax,
    englandGrowth,
    swGrowth,
    laBars,
    laRefLines,
    suppressedLas,
    suppressionSymbols,
    scatterPoints,
  } = model

  const swMultiple = ratio(swLatest?.rate.v ?? null, englandLatest?.rate.v ?? null)
  const firstAutumnYear = autumnPeriods[0]?.year ?? ''

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label={`SOUTH WEST, AUTUMN ${latest.year}`}
          value={formatRate(swLatest?.rate.v)}
          accent={getGeoColor('southWest')}
          sub={`Rank ${swRank} of ${regionsCount} regions; England ${formatRate(englandLatest?.rate.v)}`}
        />
        <KpiCard
          label="SW vs ENGLAND MULTIPLE"
          value={swMultiple != null ? `${swMultiple.toFixed(2)}x` : NA}
          accent="#64748b"
          sub="Ratio of two published rates; not a new statistic"
        />
        <KpiCard
          label="RANGE WITHIN SOUTH WEST"
          value={laBars.length ? `${formatRate(laBars[laBars.length - 1].value)} to ${formatRate(laBars[0].value)}` : NA}
          accent="#94a3b8"
          sub={`Lowest to highest LA rate, autumn ${latest.year}`}
        />
      </div>

      <ChartCard
        title={`EHE rate by region, autumn ${latest.year}`}
        subtitle="Published rate per 100 (ages 5 to 16 population basis); all 10 regions"
        downloadName={`regional-rate-by-region-${latest.key}`}
        legend={[
          { role: 'southWest', label: 'South West' },
          { role: 'other', label: 'Other regions' },
          { role: 'england', label: 'England', dashed: true },
        ]}
        footnote={
          <>
            Rank claims are always &ldquo;of {regionsCount} regions&rdquo;: London is published as Inner London
            and Outer London separately, so there is no combined &ldquo;London&rdquo; row to rank. South West
            has held the highest rate of all {regionsCount} regions in every one of the 10 term-points
            published since collection began, not only in autumn terms.
          </>
        }
      >
        <BarChart bars={regionBars} refLines={regionRefLines} labelWidth={140} />
      </ChartCard>

      <ChartCard
        title="South West vs England, autumn to autumn"
        subtitle={`Census-date rate per 100, autumn terms only (${firstAutumnYear} to ${latest.year}); year-on-year comparisons are always autumn-to-autumn`}
        downloadName={`regional-sw-vs-england-trend-${latest.key}`}
        legend={[
          { role: 'southWest', label: 'South West' },
          { role: 'england', label: 'England', dashed: true },
        ]}
        footnote={
          <>
            Collection was voluntary from autumn 2022 (93 to 100% LA response) and became mandatory from
            autumn 2024; part of the rise in both lines reflects improved coverage, not only more children
            becoming electively home educated. This is why the gap below is read as a ratio, not as a
            difference in growth rate.
          </>
        }
      >
        <LineChart
          series={trendSeries}
          yLabel="Rate per 100"
          xTickLabel={(x) => autumnPeriods[x]?.year ?? String(x)}
          valueFormat={(v) => (v == null ? NA : v.toFixed(1))}
        />
        <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            South West rate &divide; England rate, each autumn
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
            {ratioRows.map((r) => (
              <span key={r.year}>
                <span className="text-slate-400">{r.year}:</span>{' '}
                <span className="font-semibold">{r.value != null ? `${r.value.toFixed(2)}x` : NA}</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {ratioMin != null && ratioMax != null
              ? `The multiple has stayed in a narrow ${ratioMin.toFixed(2)} to ${ratioMax.toFixed(2)}x band across all four autumns: a persistent level difference, not South West accelerating away from England. `
              : null}
            Over the same period the England EHE population grew {signedPct(englandGrowth)} ({firstAutumnYear} to{' '}
            {latest.year}) and South West grew {signedPct(swGrowth)}: essentially the same proportional growth in
            numbers, carried at a higher rate throughout.
          </p>
        </div>
      </ChartCard>

      <ChartCard
        title={`EHE rate by South West local authority, autumn ${latest.year}`}
        subtitle="Published rate per 100; footprint LAs (Cornwall, Plymouth, Devon) and benchmark LAs (Torbay, Somerset, Dorset) highlighted"
        downloadName={`regional-sw-la-ranking-${latest.key}`}
        legend={[
          { role: 'cornwall', label: 'Cornwall' },
          { role: 'plymouth', label: 'Plymouth' },
          { role: 'devon', label: 'Devon' },
          { role: 'benchmark', label: 'Benchmark LAs' },
          { role: 'other', label: 'Other South West LAs' },
          { role: 'england', label: 'England', dashed: true },
        ]}
        footnote={
          <>
            The South West's own internal range spans coastal and rural authorities (Cornwall, Somerset,
            Torbay and Devon, each at or above 2.7) down to more urban authorities (down to around 1.0), against an
            England rate of {formatRate(englandLatest?.rate.v)}. The South West-wide rate is a single figure;
            the local authorities inside it are far from uniform.{' '}
            {suppressedLas.length > 0 && (
              <>
                {suppressedLas.map((l) => l.name).join(', ')}&rsquo;s count is suppressed (
                {suppressionSymbols.map((s) => `${s}: ${FLAG_MEANING[s]}`).join('; ')}) owing to its small
                population; the rate shown is still published as-is.
              </>
            )}
          </>
        }
      >
        <BarChart bars={laBars} refLines={laRefLines} labelWidth={220} rowHeight={24} />
      </ChartCard>

      <ChartCard
        title="Does South West's mix look different from England's?"
        subtitle={`Sex and year-group profile, percent of the total, autumn ${latest.year}`}
        downloadName={`regional-sw-profile-scatter-${latest.key}`}
        legend={[
          { color: SCATTER_COLOR.yearGroup, label: 'Year group' },
          { color: SCATTER_COLOR.sex, label: 'Sex' },
          { color: '#64748b', label: 'y = x (no difference from England)', dashed: true },
        ]}
        footnote={
          <>
            Each point is one category (a year group or a sex); its position is (England %, South West %).
            Points on the diagonal mean South West's share of that category matches England's exactly.
            Categories where either England's or South West's published percentage is suppressed (rounds to
            zero, &ldquo;low&rdquo;) are excluded, which is why Unknown sex and the Reception/Unknown year
            groups do not appear. This chart is about composition, not level: South West's overall rate is
            higher than England's (charts above), but who is home-educated, by sex and by year group, is a
            close like-for-like match.
          </>
        }
      >
        <ScatterChart
          points={scatterPoints}
          xLabel="England, %"
          yLabel="South West, %"
          fit={{ slope: 1, intercept: 0 }}
          xSuffix="%"
          ySuffix="%"
        />
      </ChartCard>
    </div>
  )
}

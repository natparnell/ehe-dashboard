import { useEffect, useState } from 'react'
import { ChartCard } from '../ChartCard'
import { KpiCard } from '../KpiCard'
import { LineChart, type LineSeries } from '../charts/LineChart'
import { loadProcessed } from '../../services/dataService'
import {
  formatCount,
  formatRate,
  formatSignedCount,
  formatSignedRate,
  formatPercent,
} from '../../utils/formatting'
import type { Cell } from '../../types'

// This view owns exactly this file (spec section 8 step 4). Data is loaded
// only via the dataService generic loader; shapes per scripts/DATA_SHAPES.md.
// Local types below describe only the slices of totals.json / breakdowns.json
// this view reads.

interface TotalsPeriod {
  key: string
  year: string
  term: 'Autumn' | 'Spring' | 'Summer'
  sort: number
}

interface TotalsSeriesPoint {
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
  series: Record<string, TotalsSeriesPoint>
}

interface Totals {
  periods: TotalsPeriod[]
  geographies: TotalsGeography[]
}

interface BreakdownSeriesPoint {
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
  series: Record<string, BreakdownSeriesPoint>
}

interface Breakdowns {
  periods: TotalsPeriod[]
  reasonOrder: string[]
  yearGroupOrder: string[]
  sexOrder: string[]
  records: BreakdownRecord[]
}

// Short period label for chart x-ticks, e.g. "Aut 22/23".
function shortLabel(p: TotalsPeriod): string {
  const termAbbrev = p.term === 'Autumn' ? 'Aut' : p.term === 'Spring' ? 'Spr' : 'Sum'
  const yy = p.year.split('/').map((s) => s.slice(-2)).join('/')
  return `${termAbbrev} ${yy}`
}

export function NationalView() {
  const [totals, setTotals] = useState<Totals | null | undefined>(undefined)
  const [breakdowns, setBreakdowns] = useState<Breakdowns | null | undefined>(undefined)

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

  if (totals === undefined || breakdowns === undefined) {
    return <div className="p-8 text-sm text-slate-500">Loading data.</div>
  }
  if (totals === null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        No processed data found. Run <code>npm run preprocess</code> first.
      </div>
    )
  }

  const england = totals.geographies.find(
    (g) => g.level === 'National' && g.code === 'E92000001',
  )
  const periods = [...totals.periods].sort((a, b) => a.sort - b.sort)

  if (!england) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        England row not found in totals.json.
      </div>
    )
  }

  // ----- sawtooth (count) and rate series, all 10 term-points ---------------
  const countPoints = periods.map((p, i) => ({
    x: i,
    y: england.series[p.key]?.count.v ?? null,
  }))
  const countSeries: LineSeries[] = [
    { id: 'England', role: 'england', dashed: true, width: 2.5, data: countPoints },
  ]

  const autumnPeriods = periods.filter((p) => p.term === 'Autumn')
  const autumnRatePoints = autumnPeriods.map((p) => ({
    x: p.sort,
    y: england.series[p.key]?.rate.v ?? null,
  }))
  const rateSeries: LineSeries[] = [
    { id: 'England (autumn)', role: 'england', dashed: true, width: 2.5, data: autumnRatePoints },
  ]
  const autumnXTick = (x: number) => {
    const p = autumnPeriods.find((pp) => pp.sort === x)
    return p ? p.year : String(x)
  }

  // ----- within-year gains (Autumn -> Summer) and September resets ----------
  // Rule 4.4: year-on-year comparisons are autumn-to-autumn only; a September
  // reset is a term-structure artefact of the sawtooth, not a decline. Both
  // figures below are computed from the loaded data, not hardcoded.
  const years = ['2022/23', '2023/24', '2024/25']
  const gains = years.map((year) => {
    const aut = england.series[`${year.replace('/', '')}-Autumn`]?.count.v ?? null
    const sum = england.series[`${year.replace('/', '')}-Summer`]?.count.v ?? null
    return {
      year,
      delta: aut != null && sum != null ? sum - aut : null,
    }
  })
  const yearPairs: [string, string][] = [
    ['2022/23', '2023/24'],
    ['2023/24', '2024/25'],
    ['2024/25', '2025/26'],
  ]
  const resets = yearPairs.map(([fromYear, toYear]) => {
    const sum = england.series[`${fromYear.replace('/', '')}-Summer`]?.count.v ?? null
    const aut = england.series[`${toYear.replace('/', '')}-Autumn`]?.count.v ?? null
    return {
      fromYear,
      toYear,
      delta: sum != null && aut != null ? aut - sum : null,
    }
  })

  // ----- autumn-to-autumn KPI row --------------------------------------------
  const latestAutumn = autumnPeriods[autumnPeriods.length - 1]
  const prevAutumn = autumnPeriods[autumnPeriods.length - 2]
  const firstAutumn = autumnPeriods[0]
  const latestCount = england.series[latestAutumn.key]?.count.v ?? null
  const prevCount = prevAutumn ? england.series[prevAutumn.key]?.count.v ?? null : null
  const firstCount = england.series[firstAutumn.key]?.count.v ?? null
  const latestRate = england.series[latestAutumn.key]?.rate.v ?? null
  const prevRate = prevAutumn ? england.series[prevAutumn.key]?.rate.v ?? null : null
  const firstRate = england.series[firstAutumn.key]?.rate.v ?? null

  // ----- collection-maturity panel: falling Unknown reason share -------------
  // Spec 4.10: response rate 93% to 100% is a fixed methodology fact (not a
  // JSON figure); the falling Unknown share IS computed from breakdowns.json.
  let unknownTrend: { year: string; pct: number | null }[] = []
  if (breakdowns) {
    const unknownRow = breakdowns.records.find(
      (r) => r.level === 'National' && r.topic === 'Reason' && r.breakdown === 'Unknown',
    )
    if (unknownRow) {
      unknownTrend = autumnPeriods.map((p) => ({
        year: p.year,
        pct: unknownRow.series[p.key]?.percent.v ?? null,
      }))
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Census-date stock (termly), counted on one day each term. This is a different measure from
        the annual at-any-point flow figure shown in Stocks, Flows and Enforcement, and the two are
        never reconciled against each other. Year-on-year comparisons on this page are made
        autumn-to-autumn only: the within-year rise and September reset are a feature of the
        collection design, not a decline.
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label={`England, autumn ${latestAutumn.year}`}
          value={formatCount(latestCount)}
          accent="#475569"
          delta={
            prevCount != null && latestCount != null
              ? `${formatSignedCount(latestCount - prevCount)} vs autumn ${prevAutumn?.year}`
              : undefined
          }
          sub="Census-date stock, England"
        />
        <KpiCard
          label={`Rate per 100, autumn ${latestAutumn.year}`}
          value={formatRate(latestRate)}
          accent="#475569"
          delta={
            prevRate != null && latestRate != null
              ? `${formatSignedRate(latestRate - prevRate)} vs autumn ${prevAutumn?.year}`
              : undefined
          }
          sub="Rate per 100 of the 5-16 population"
        />
        <KpiCard
          label={`Change since autumn ${firstAutumn.year}`}
          value={
            latestCount != null && firstCount != null
              ? formatSignedCount(latestCount - firstCount)
              : null
          }
          accent="#475569"
          sub={`${formatCount(firstCount)} to ${formatCount(latestCount)}, four autumns`}
        />
        <KpiCard
          label={`Rate change since autumn ${firstAutumn.year}`}
          value={
            latestRate != null && firstRate != null ? formatSignedRate(latestRate - firstRate) : null
          }
          accent="#475569"
          sub={`${formatRate(firstRate)} to ${formatRate(latestRate)} per 100`}
        />
      </div>

      <ChartCard
        title="England, EHE census-date stock, all 10 term-points"
        subtitle="Count of children recorded as electively home educated on census day, autumn 2022/23 to autumn 2025/26"
        downloadName="national-sawtooth"
        legend={[{ role: 'england', label: 'England', dashed: true }]}
        footnote="The rise within each academic year (Autumn to Spring to Summer) and the fall each September are a term-structure sawtooth, not evidence of decline: the count resets because the population re-bases at the start of each school year, not because children have stopped being electively home educated. Only counts (never rates or percentages) may be compared across terms this way."
      >
        <LineChart
          series={countSeries}
          yLabel="children (count)"
          xTickLabel={(x) => shortLabel(periods[x])}
          valueFormat={(v) => (v == null ? 'n/a' : formatCount(Math.round(v)))}
        />
      </ChartCard>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:break-inside-avoid">
          <h3 className="text-sm font-semibold text-slate-800">Within-year gains (Autumn to Summer)</h3>
          <p className="mt-1 text-xs text-slate-500">
            The full climb from the autumn census point to the following summer, within one academic
            year.
          </p>
          <div className="mt-3 space-y-2">
            {gains.map((g) => (
              <div
                key={g.year}
                className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm"
              >
                <span className="text-slate-600">{g.year}, Autumn to Summer</span>
                <span className="font-semibold" style={{ color: '#475569' }}>
                  {formatSignedCount(g.delta)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:break-inside-avoid">
          <h3 className="text-sm font-semibold text-slate-800">September resets</h3>
          <p className="mt-1 text-xs text-slate-500">
            The fall from summer of one year to autumn of the next, when the population re-bases at
            the start of the school year. Read as a reset, never as children leaving EHE.
          </p>
          <div className="mt-3 space-y-2">
            {resets.map((r) => (
              <div
                key={r.fromYear}
                className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-1.5 text-sm"
              >
                <span className="text-slate-600">
                  Summer {r.fromYear} to autumn {r.toYear}
                </span>
                <span className="font-semibold" style={{ color: '#475569' }}>
                  {formatSignedCount(r.delta)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ChartCard
        title="England, rate per 100, autumn term only"
        subtitle="Autumn-to-autumn comparison (spec rule: rates and percentages are never averaged or summed across terms; only autumn points are compared year-on-year)"
        downloadName="national-rate-autumn"
        legend={[{ role: 'england', label: 'England, autumn rate', dashed: true }]}
        footnote="Rate per 100 of the ONS mid-year 5-16 population, as published (never recomputed). Rises from 1.0 in autumn 2022/23 to 1.5 in autumn 2025/26."
      >
        <LineChart
          series={rateSeries}
          yLabel="rate per 100"
          xTickLabel={autumnXTick}
          valueFormat={(v) => (v == null ? 'n/a' : formatRate(v))}
        />
      </ChartCard>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:break-inside-avoid">
        <h3 className="text-sm font-semibold text-slate-800">Collection maturity caveat</h3>
        <p className="mt-2 text-sm text-slate-600">
          This collection was voluntary for local authorities from autumn 2022, with response rates
          ranging from 93% to 100% of LAs by term, before becoming a mandatory return from autumn
          2024. National and regional totals are uprated to account for non-responding LAs in the
          voluntary period. This means part of the rise shown above is improved coverage of an
          existing population, not only more children being electively home educated; the two effects
          cannot be separated in the published figures. The whole dashboard is badged official
          statistics in development on that basis.
        </p>
        {unknownTrend.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-500">
              One supporting signal: the share of reasons recorded as Unknown has fallen as the
              collection matured (a recording-quality improvement, not a change in why children are
              educated at home):
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {unknownTrend.map((u) => (
                <div
                  key={u.year}
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                >
                  <span className="text-slate-500">Autumn {u.year}: </span>
                  <span className="font-semibold text-slate-800">{formatPercent(u.pct)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

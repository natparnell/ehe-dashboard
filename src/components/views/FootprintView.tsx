import { useEffect, useMemo, useRef, useState, useLayoutEffect, type ReactNode } from 'react'
import { getView } from '../../views'
import { loadProcessed } from '../../services/dataService'
import { ChartCard } from '../ChartCard'
import { KpiCard } from '../KpiCard'
import { LineChart, type LineSeries } from '../charts/LineChart'
import { BarChart, type Bar } from '../charts/BarChart'
import { getGeoColor } from '../../utils/colors'
import { formatCount, formatRate, formatSignedCount, formatSignedRate, NA } from '../../utils/formatting'
import type { Cell } from '../../types'

// ---------------------------------------------------------------------------
// Local shape for footprint.json (contract: scripts/DATA_SHAPES.md section 4).
// The footprint is the pooled Cornwall + Plymouth + Devon aggregate from
// 2023/24 Autumn onward; 2022/23 is excluded because Cornwall was suppressed
// that year, so no pooled row exists. Pooled rate is the population-weighted
// back-out identity sum(count) / sum(pop) * 100, never a mean of LA rates
// (spec section 4 rule 3). Every figure here is an LA-area proxy, not WeST
// pupils (spec section 4 rule 9).
// ---------------------------------------------------------------------------

interface Constituent {
  code: string
  count: number | null
  rate: number | null
  pop: number | null
}

interface SeriesEntry {
  key: string
  year: string
  term: string
  sort: number
  count: number
  rate: number
  pop: number
  constituents: Record<string, Constituent>
  suppressed: string[]
  england: { count: number | null; rate: number | null }
  sw: { count: number | null; rate: number | null }
  excessVsEngland: {
    multiple: number | null
    excessChildren: number | null
    expectedAtEnglandRate: number | null
  }
}

interface BenchmarkEntry {
  code: string
  series: Record<string, { count: Cell; rate: Cell }>
}

interface FootprintData {
  periods: { key: string; year: string; term: string; sort: number }[]
  constituentOrder: string[]
  constituentCodes: Record<string, string>
  benchmarkCodes: Record<string, string>
  excludedYear: string
  excludedReason: string
  series: SeriesEntry[]
  benchmarks: Record<string, BenchmarkEntry>
  yearGroupLatest: unknown
}

// ---------------------------------------------------------------------------
// View-local helpers
// ---------------------------------------------------------------------------

const CONSTITUENT_ROLE: Record<string, 'cornwall' | 'plymouth' | 'devon'> = {
  Cornwall: 'cornwall',
  Plymouth: 'plymouth',
  Devon: 'devon',
}

function termShort(term: string): string {
  if (term === 'Autumn') return 'Aut'
  if (term === 'Spring') return 'Spr'
  return 'Sum'
}

// e.g. "Aut '23" for the census term-point of academic year 2023/24.
function periodLabel(year: string, term: string): string {
  return `${termShort(term)} '${year.slice(2, 4)}`
}

// A prominent standing caveat block. Rendered in a neutral amber tone so it
// reads as context, not alarm.
function CaveatNote({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="font-semibold">{title}</div>
      <div className="mt-1 leading-snug text-amber-800">{children}</div>
    </div>
  )
}

// A horizontal stacked-count bar chart (one row per census term-point, segments
// for the three constituent LAs). Built locally because the shared BarChart is
// a single-value ranked chart. Only counts are summed (spec rule 2); each LA
// count is published rounded to the nearest 10, so a stacked total may differ
// slightly from the pooled published count.
function StackedCountBars({
  rows,
  constituentOrder,
}: {
  rows: { label: string; total: number; segments: { name: string; value: number | null }[] }[]
  constituentOrder: string[]
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((e) => {
      const w = e[0]?.contentRect.width
      if (w) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const labelW = 96
  const valueW = 64
  const rowH = 40
  const gap = 12
  const plotW = Math.max(width - labelW - valueW, 40)
  const maxTotal = Math.max(1, ...rows.map((r) => r.total))
  const sx = (v: number) => (v / maxTotal) * plotW
  const height = rows.length * (rowH + gap)

  return (
    <div ref={wrapRef}>
      <svg width={width} height={height} role="img" aria-label="footprint count growth, stacked by local authority">
        {rows.map((r, ri) => {
          const y = ri * (rowH + gap)
          let cursor = labelW
          return (
            <g key={r.label}>
              <text
                x={labelW - 8}
                y={y + rowH / 2}
                dy="0.32em"
                textAnchor="end"
                fontSize="11"
                fill="#475569"
              >
                {r.label}
              </text>
              {constituentOrder.map((name) => {
                const seg = r.segments.find((s) => s.name === name)
                const v = seg?.value ?? null
                if (v == null || v <= 0) return null
                const w = Math.max(sx(v), 0)
                const rect = (
                  <rect
                    key={`${r.label}-${name}`}
                    x={cursor}
                    y={y}
                    width={w}
                    height={rowH}
                    fill={getGeoColor(CONSTITUENT_ROLE[name] ?? 'other')}
                    opacity={0.88}
                  >
                    <title>{`${name}: ${formatCount(v)}`}</title>
                  </rect>
                )
                cursor += w
                return rect
              })}
              <text
                x={cursor + 8}
                y={y + rowH / 2}
                dy="0.32em"
                textAnchor="start"
                fontSize="12"
                fontWeight={700}
                fill="#0f172a"
              >
                {formatCount(r.total)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function FootprintView() {
  const meta = getView('footprint')
  // undefined = still loading; null = fetch failed (distinct from not-yet-loaded)
  const [data, setData] = useState<FootprintData | null | undefined>(undefined)
  const [termMode, setTermMode] = useState<'autumn' | 'all'>('autumn')

  useEffect(() => {
    let live = true
    loadProcessed<FootprintData>('footprint.json').then((d) => {
      if (live) setData(d)
    })
    return () => {
      live = false
    }
  }, [])

  const model = useMemo(() => {
    if (!data) return null
    const series = [...data.series].sort((a, b) => a.sort - b.sort)
    const autumn = series.filter((s) => s.term === 'Autumn')
    const latest = series[series.length - 1] ?? null
    const latestAutumn = autumn[autumn.length - 1] ?? null
    const prevAutumn = autumn.length >= 2 ? autumn[autumn.length - 2] : null
    const firstAutumn = autumn[0] ?? null
    const sortToLabel: Record<number, string> = {}
    for (const p of series) sortToLabel[p.sort] = periodLabel(p.year, p.term)
    const latestKey = latest?.key ?? ''
    return { series, autumn, latest, latestAutumn, prevAutumn, firstAutumn, sortToLabel, latestKey }
  }, [data])

  if (data === null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        No processed data found. Run <code>npm run preprocess</code> first.
      </div>
    )
  }
  if (!data || !model) {
    return <div className="p-8 text-sm text-slate-500">Loading data...</div>
  }

  const { series, autumn, latest, prevAutumn, firstAutumn, sortToLabel, latestKey } = model
  const chartSeries = termMode === 'autumn' ? autumn : series

  // KPI deltas (autumn-to-autumn only, spec rule 4).
  const countDelta =
    latest && prevAutumn ? latest.count - prevAutumn.count : null
  const rateDelta = latest && prevAutumn ? latest.rate - prevAutumn.rate : null

  // Plymouth: rate roughly doubled across the two autumns on record.
  const plyLatest = latest?.constituents['Plymouth'] ?? null
  const plyFirst = firstAutumn?.constituents['Plymouth'] ?? null
  const plyRateDelta =
    plyLatest?.rate != null && plyFirst?.rate != null ? plyLatest.rate - plyFirst.rate : null

  // ----- trajectory: constituent LAs + pooled footprint vs SW and England ----
  const lineSeries: LineSeries[] = [
    ...data.constituentOrder.map((name) => ({
      id: name,
      role: CONSTITUENT_ROLE[name] ?? ('other' as const),
      data: chartSeries.map((s) => ({ x: s.sort, y: s.constituents[name]?.rate ?? null })),
    })),
    {
      id: 'WeST footprint (pooled)',
      role: 'footprint' as const,
      width: 3,
      data: chartSeries.map((s) => ({ x: s.sort, y: s.rate })),
    },
    {
      id: 'South West',
      role: 'southWest' as const,
      data: chartSeries.map((s) => ({ x: s.sort, y: s.sw.rate })),
    },
    {
      id: 'England',
      role: 'england' as const,
      dashed: true,
      data: chartSeries.map((s) => ({ x: s.sort, y: s.england.rate })),
    },
  ]

  // ----- stacked count growth (autumn-to-autumn, spec rule 4) ----------------
  const stackedRows = autumn.map((s) => ({
    label: s.year,
    total: s.count,
    segments: data.constituentOrder.map((name) => ({
      name,
      value: s.constituents[name]?.count ?? null,
    })),
  }))

  // ----- benchmark panel: peninsula peers and the rural contrast -------------
  const benchmarkBars: Bar[] = [
    ...(latest
      ? [
          {
            id: 'footprint',
            label: 'WeST footprint',
            value: latest.rate,
            role: 'footprint' as const,
            highlight: true,
          },
        ]
      : []),
    ...Object.keys(data.benchmarks).map((name) => {
      const cell = data.benchmarks[name].series[latestKey]?.rate
      return {
        id: name,
        label: name,
        value: cell?.v ?? null,
        role: 'benchmark' as const,
      }
    }),
  ].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))

  const englandRate = latest?.england.rate ?? null
  const swRate = latest?.sw.rate ?? null

  // ----- illustrative excess-vs-England --------------------------------------
  const excess = latest?.excessVsEngland ?? null

  const latestPeriodProse = latest ? `autumn ${latest.year}` : 'the latest autumn'
  const prevAutumnProse = prevAutumn ? `autumn ${prevAutumn.year}` : 'the prior autumn'
  const firstAutumnProse = firstAutumn ? `autumn ${firstAutumn.year}` : 'the first autumn'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{meta.label}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cornwall, Plymouth and Devon pooled, {latestPeriodProse} unless stated. Census-date stock.
        </p>
      </div>

      {/* Proxy caveat: rendered prominently on every footprint figure (rule 9). */}
      <CaveatNote title="What the footprint is, and is not">
        These figures count children electively home educated across the whole of the Cornwall,
        Plymouth and Devon local-authority areas. They are an area proxy for the WeST footprint, not
        a count of WeST pupils, and cannot be attributed to any school or trust. The pooled rate is
        population-weighted from the three LA counts and back-out populations
        (sum of counts divided by sum of populations), never an average of the three published rates.
      </CaveatNote>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={`Footprint EHE children, ${latestPeriodProse}`}
          value={latest ? formatCount(latest.count) : null}
          accent={getGeoColor('footprint')}
          delta={countDelta != null ? `${formatSignedCount(countDelta)} vs ${prevAutumnProse}` : undefined}
          sub="Cornwall + Plymouth + Devon (area proxy)"
        />
        <KpiCard
          label={`Pooled rate per 100, ${latestPeriodProse}`}
          value={latest ? formatRate(latest.rate, 2) : null}
          accent={getGeoColor('footprint')}
          delta={rateDelta != null ? `${formatSignedRate(rateDelta, 2)} vs ${prevAutumnProse}` : undefined}
          sub={`England ${formatRate(englandRate)}, South West ${formatRate(swRate)}`}
        />
        <KpiCard
          label="Multiple of the England rate"
          value={excess?.multiple != null ? `${excess.multiple.toFixed(2)}x` : null}
          accent={getGeoColor('footprint')}
          sub={`Rate ${latest ? formatRate(latest.rate, 2) : NA} vs England ${formatRate(englandRate)}`}
        />
        <KpiCard
          label={`Plymouth rate, ${latestPeriodProse}`}
          value={plyLatest?.rate != null ? formatRate(plyLatest.rate) : null}
          accent={getGeoColor('plymouth')}
          delta={
            plyRateDelta != null ? `${formatSignedRate(plyRateDelta)} vs ${firstAutumnProse}` : undefined
          }
          sub="Roughly doubled across the two autumns on record"
        />
      </div>

      {/* Trajectory: constituents + pooled footprint vs references */}
      <ChartCard
        title="EHE rate trajectory: footprint LAs against South West and England"
        subtitle={
          termMode === 'autumn'
            ? 'Census-date rate per 100, autumn term-points, 2023/24 onward'
            : 'Census-date rate per 100, all term-points, 2023/24 onward'
        }
        downloadName={`footprint-trajectory-${termMode}`}
        legend={[
          { role: 'cornwall', label: 'Cornwall' },
          { role: 'plymouth', label: 'Plymouth' },
          { role: 'devon', label: 'Devon' },
          { role: 'footprint', label: 'Footprint (pooled)' },
          { role: 'southWest', label: 'South West' },
          { role: 'england', label: 'England', dashed: true },
        ]}
        footnote={
          <div className="space-y-1">
            <div>
              Rates are as published (never recomputed across LAs or terms); the pooled footprint
              line is population-weighted. Rate-rounding on the back-out means the pooled rate carries
              roughly a plus or minus 0.05 uncertainty.
            </div>
            {termMode === 'all' && (
              <div>
                The census-date stock rises within each academic year and resets every September, so
                the summer-to-autumn falls are the annual reset, not a decline. Compare like term with
                like term (autumn to autumn) only.
              </div>
            )}
            <div>
              Part of the apparent rise reflects improving coverage: the census was voluntary from
              autumn 2022 and mandatory from autumn 2024. Official statistics in development.
            </div>
          </div>
        }
      >
        <div className="mb-2 flex items-center gap-1 text-xs print:hidden">
          <span className="text-slate-500">View:</span>
          <button
            type="button"
            onClick={() => setTermMode('autumn')}
            aria-pressed={termMode === 'autumn'}
            className={`rounded px-2 py-1 ${termMode === 'autumn' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            Autumn only
          </button>
          <button
            type="button"
            onClick={() => setTermMode('all')}
            aria-pressed={termMode === 'all'}
            className={`rounded px-2 py-1 ${termMode === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            All terms (sawtooth)
          </button>
        </div>
        <LineChart
          series={lineSeries}
          yLabel="Rate per 100 (5 to 16 population)"
          valueSuffix=""
          xTickLabel={(x) => sortToLabel[x] ?? String(x)}
          valueFormat={(v) => (v == null ? NA : v.toFixed(2))}
        />
      </ChartCard>

      {/* Stacked count growth */}
      <ChartCard
        title="Footprint count growth, autumn to autumn"
        subtitle="Census-date EHE children, summed across the three LAs, autumn term-points"
        downloadName="footprint-count-growth"
        legend={[
          { role: 'devon', label: 'Devon' },
          { role: 'cornwall', label: 'Cornwall' },
          { role: 'plymouth', label: 'Plymouth' },
        ]}
        footnote={
          <span>
            Only counts are summed (rates and percentages are never added). Each LA count is published
            rounded to the nearest 10, so a stacked total can differ slightly from the pooled published
            figure. 2022/23 is excluded: {data.excludedReason}
          </span>
        }
      >
        <StackedCountBars rows={stackedRows} constituentOrder={data.constituentOrder} />
      </ChartCard>

      {/* Benchmark panel + illustrative excess */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Peninsula peers and a rural contrast"
          subtitle={`Census-date rate per 100, ${latestPeriodProse}`}
          downloadName="footprint-benchmarks"
          footnote={
            <span>
              Torbay and Somerset sit at the same peninsula level as the footprint; Dorset is the
              deliberate rural contrast, materially lower despite a similar settlement pattern. Rates
              are as published; the dashed markers are the England and South West datums.
            </span>
          }
        >
          <BarChart
            bars={benchmarkBars}
            valueSuffix=""
            valueDp={2}
            labelWidth={120}
            refLines={[
              ...(englandRate != null
                ? [{ value: englandRate, label: 'England', color: getGeoColor('england') }]
                : []),
              ...(swRate != null
                ? [{ value: swRate, label: 'South West', color: getGeoColor('southWest') }]
                : []),
            ]}
          />
        </ChartCard>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:break-inside-avoid">
          <h2 className="text-sm font-semibold text-slate-800">
            Illustrative excess over the England rate
          </h2>
          <p className="text-xs text-slate-500">{`Census-date stock, ${latestPeriodProse}`}</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl font-bold" style={{ color: getGeoColor('footprint') }}>
              {excess?.excessChildren != null ? `~${formatCount(Math.round(excess.excessChildren / 10) * 10)}` : NA}
            </span>
            <span className="text-sm text-slate-500">more children than the England rate implies</span>
          </div>
          <dl className="mt-3 space-y-1 text-sm text-slate-600">
            <div className="flex justify-between">
              <dt>At the England rate ({formatRate(englandRate)} per 100)</dt>
              <dd className="font-medium text-slate-900">
                {excess?.expectedAtEnglandRate != null ? formatCount(Math.round(excess.expectedAtEnglandRate)) : NA}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Observed footprint count</dt>
              <dd className="font-medium text-slate-900">{latest ? formatCount(latest.count) : NA}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-1">
              <dt>Illustrative difference</dt>
              <dd className="font-medium text-slate-900">
                {excess?.excessChildren != null ? formatSignedCount(Math.round(excess.excessChildren)) : NA}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-snug text-slate-400">
            Illustrative only. It assumes the footprint would otherwise sit exactly at the England
            rate, which ignores the South West's structurally higher rate ({formatRate(swRate)} per
            100) and local composition. It is a scale-of-difference figure, not a target or a count of
            avoidable cases.
          </p>
        </div>
      </div>

      {/* Plymouth callout */}
      <div className="rounded-lg border-l-4 bg-white p-4 shadow-sm" style={{ borderLeftColor: getGeoColor('plymouth') }}>
        <h2 className="text-sm font-semibold text-slate-800">Plymouth: the fastest mover</h2>
        <p className="mt-1 text-sm text-slate-600">
          Plymouth's census-date rate rose from {formatRate(plyFirst?.rate)} per 100 in {firstAutumnProse} to{' '}
          {formatRate(plyLatest?.rate)} in {latestPeriodProse}, roughly doubling in two years, while its
          count moved from {formatCount(plyFirst?.count)} to {formatCount(plyLatest?.count)} children. It
          remains the lowest-rate LA of the three, closest to the South West level rather than the rural
          peaks of Cornwall and Devon. Plymouth's urban statistical neighbours differ, so read this as a
          local trajectory rather than a settled urban pattern.
        </p>
      </div>

      {/* Standing maturity caveat */}
      <CaveatNote title="Reading the trend">
        These are official statistics in development. Collection was voluntary from autumn 2022 (with a
        93 to 100 per cent response rate) and mandatory only from autumn 2024, and national and regional
        totals are uprated for non-response. Some of the apparent growth is improved coverage rather than
        a real rise, and comparisons are only made autumn to autumn. The footprint aggregate begins in
        2023/24 because Cornwall was suppressed in 2022/23.
      </CaveatNote>
    </div>
  )
}

// Year Groups view (spec section 5.7): the age gradient. National EHE counts
// climb from Reception to Year 11, footprint LAs skew even further toward the
// GCSE years than England does, and the smaller LAs vary widely in how
// concentrated their EHE population is in Years 10-11.
//
// Data via dataService only (breakdowns.json, breakdowns-la-yeargroup.json,
// footprint.json). Every derived figure (the two Y10+Y11 shares, the steepest
// step, the per-LA tiles) is computed here from those files, never hardcoded,
// per spec section 3.3/headlines convention. This file owns no shared
// component: the two vertical bar charts below are view-local because the
// shared BarChart is horizontal-only and cannot express a categorical age
// gradient with mixed live/suppressed ("low") cells.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { loadProcessed } from '../../services/dataService'
import { ChartCard } from '../ChartCard'
import { KpiCard } from '../KpiCard'
import { LineChart, type LineSeries } from '../charts/LineChart'
import { getGeoColor, type GeoRole } from '../../utils/colors'
import {
  formatCount,
  formatPercent,
  formatSignedCount,
  formatSignedPp,
  formatCell,
  NA,
} from '../../utils/formatting'
import { niceTicks } from '../../utils/ticks'
import type { Cell } from '../../types'

// ----- local shapes, per scripts/DATA_SHAPES.md -----------------------------

interface PeriodKey {
  key: string
  year: string
  term: string
  sort: number
}

interface BreakdownSeriesCell {
  count: Cell
  percent: Cell
}

interface BreakdownRecord {
  level: 'National' | 'Regional' | 'Local authority'
  code: string
  name: string
  region_code: string | null
  region_name: string | null
  topic: 'Sex' | 'Year group' | 'Reason'
  breakdown: string
  series: Record<string, BreakdownSeriesCell>
}

interface BreakdownsFile {
  periods: PeriodKey[]
  yearGroupOrder: string[]
  records: BreakdownRecord[]
}

interface LaBreakdownRecord {
  level: 'Local authority'
  code: string
  name: string
  region_code: string | null
  region_name: string | null
  topic: 'Sex' | 'Year group' | 'Reason'
  breakdown: string
  series: Record<string, BreakdownSeriesCell>
}

interface BreakdownsLaYearGroupFile {
  periods: PeriodKey[]
  yearGroupOrder: string[]
  records: LaBreakdownRecord[]
}

interface FootprintYearGroupGroup {
  breakdown: string
  count: number | null
  suppressedConstituents: string[]
}

interface FootprintFile {
  yearGroupLatest: {
    period: { key: string; year: string; term: string } | null
    order: string[]
    groups: FootprintYearGroupGroup[]
    note: string
  }
}

// ----- view-local vertical gradient chart -----------------------------------
// Renders one or two series of Cell values against a fixed category axis
// (year groups). A `low`-flagged cell (rounds to zero, is not zero) draws a
// minimal hatched nub with a "low" label rather than a gap; a genuinely
// missing cell (x/z, or no data) draws no bar at all. An optional `annotate`
// prop draws a bracket between two adjacent categories (used for the
// Year 8-to-9 step).

interface GradientSeriesSpec {
  id: string
  color: string
  cells: Cell[] // aligned to `categories`
  format: (v: number) => string
}

interface AnnotateSpec {
  fromIndex: number
  toIndex: number
  seriesId: string
  label: string
}

function GradientChart({
  categories,
  series,
  height = 300,
  yLabel,
  annotate,
}: {
  categories: string[]
  series: GradientSeriesSpec[]
  height?: number
  yLabel?: string
  annotate?: AnnotateSpec
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const hatchId = useId()

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const M = { top: 26, right: 16, bottom: 58, left: 52 }
  const innerW = Math.max(width - M.left - M.right, 10)
  const innerH = Math.max(height - M.top - M.bottom, 10)

  const liveMax = Math.max(
    1,
    ...series.flatMap((s) => s.cells.map((c) => (c.v != null ? c.v : 0))),
  )
  const domainMax = liveMax * 1.18
  const lowEpsilon = domainMax * 0.018

  // Height to plot: a live value plots as-is; a `low` cell gets a small nub so
  // it is visible but reads as near-zero; a genuinely missing cell is a gap
  // (returns null, no bar drawn).
  function barHeight(cell: Cell): number | null {
    if (cell.v != null) return cell.v
    if (cell.f === 'low') return lowEpsilon
    return null
  }

  const catWidth = innerW / categories.length
  const barPad = catWidth * 0.14
  const usable = catWidth - barPad * 2
  const bw = (usable / series.length) * 0.84

  function catLeft(i: number) {
    return M.left + i * catWidth
  }
  function barX(i: number, j: number) {
    const slotW = usable / series.length
    return catLeft(i) + barPad + j * slotW + (slotW - bw) / 2
  }
  function sy(v: number) {
    return M.top + innerH * (1 - v / domainMax)
  }

  const yticks = niceTicks(0, domainMax, 5)

  const annotateSeries = annotate ? series.find((s) => s.id === annotate.seriesId) : undefined
  const annotateFromH = annotate && annotateSeries ? barHeight(annotateSeries.cells[annotate.fromIndex]) : null
  const annotateToH = annotate && annotateSeries ? barHeight(annotateSeries.cells[annotate.toIndex]) : null
  const annotateSeriesIdx = annotateSeries ? series.findIndex((s) => s.id === annotateSeries.id) : -1

  return (
    <div ref={wrapRef}>
      <svg width={width} height={height} role="img" aria-label={yLabel ?? 'year group chart'}>
        <defs>
          <pattern id={hatchId} width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="#f1f5f9" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="#cbd5e1" strokeWidth="1.4" />
          </pattern>
        </defs>
        {yticks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke="#eef2f6" />
            <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="#94a3b8">
              {t.toLocaleString('en-GB')}
            </text>
          </g>
        ))}
        {yLabel && (
          <text
            x={14}
            y={M.top + innerH / 2}
            fontSize="10"
            fill="#64748b"
            transform={`rotate(-90 14 ${M.top + innerH / 2})`}
            textAnchor="middle"
          >
            {yLabel}
          </text>
        )}
        {categories.map((cat, i) => {
          const cx = catLeft(i) + catWidth / 2
          const cy = height - M.bottom + 12
          return (
            <text
              key={`cat-${cat}`}
              x={cx}
              y={cy}
              fontSize="10"
              fill="#475569"
              textAnchor="end"
              transform={`rotate(-40 ${cx} ${cy})`}
            >
              {cat}
            </text>
          )
        })}
        {series.map((s, j) =>
          categories.map((_cat, i) => {
            const cell = s.cells[i]
            const h = barHeight(cell)
            const isLow = cell.v == null && cell.f === 'low'
            const missing = h == null
            const x = barX(i, j)
            const top = missing ? sy(0) : sy(h as number)
            const barH = missing ? 0 : Math.max(sy(0) - top, isLow ? 3 : 1)
            const label = formatCell(cell, s.format)
            return (
              <g key={`bar-${s.id}-${i}`}>
                {!missing && (
                  <rect
                    x={x}
                    y={top}
                    width={bw}
                    height={barH}
                    rx={1.5}
                    fill={isLow ? `url(#${hatchId})` : s.color}
                    stroke={isLow ? '#94a3b8' : 'none'}
                    strokeWidth={isLow ? 1 : 0}
                    opacity={isLow ? 1 : 0.88}
                  />
                )}
                <text
                  x={x + bw / 2}
                  y={missing ? sy(0) - 4 : top - 4}
                  fontSize={series.length > 1 ? 8 : 9.5}
                  textAnchor="middle"
                  fill={missing ? '#cbd5e1' : '#475569'}
                >
                  {missing ? NA : label}
                </text>
              </g>
            )
          }),
        )}
        {annotate && annotateFromH != null && annotateToH != null && annotateSeriesIdx >= 0 && (
          <g>
            {(() => {
              const xFrom = barX(annotate.fromIndex, annotateSeriesIdx) + bw / 2
              const xTo = barX(annotate.toIndex, annotateSeriesIdx) + bw / 2
              const yLine = Math.min(sy(annotateFromH), sy(annotateToH)) - 20
              return (
                <>
                  <line x1={xFrom} x2={xTo} y1={yLine} y2={yLine} stroke="#0f172a" strokeWidth={1.2} />
                  <line x1={xFrom} x2={xFrom} y1={yLine} y2={sy(annotateFromH) - 6} stroke="#0f172a" strokeWidth={1} />
                  <line x1={xTo} x2={xTo} y1={yLine} y2={sy(annotateToH) - 6} stroke="#0f172a" strokeWidth={1} />
                  <text x={(xFrom + xTo) / 2} y={yLine - 5} fontSize="10" fontWeight={600} textAnchor="middle" fill="#0f172a">
                    {annotate.label}
                  </text>
                </>
              )
            })()}
          </g>
        )}
      </svg>
    </div>
  )
}

// ----- helpers ---------------------------------------------------------------

function seriesFor(records: BreakdownRecord[] | LaBreakdownRecord[], name: string): Record<string, BreakdownSeriesCell> | null {
  const rec = records.find((r) => r.breakdown === name)
  return rec ? rec.series : null
}

function pctOrNull(series: Record<string, BreakdownSeriesCell> | null, key: string): Cell {
  if (!series) return { v: null, f: 'x' }
  return series[key]?.percent ?? { v: null, f: 'x' }
}

function countOrNull(series: Record<string, BreakdownSeriesCell> | null, key: string): Cell {
  if (!series) return { v: null, f: 'x' }
  return series[key]?.count ?? { v: null, f: 'x' }
}

const FOOTPRINT_LA_ROLE: Record<string, GeoRole> = {
  Plymouth: 'plymouth',
  Cornwall: 'cornwall',
  Devon: 'devon',
  Torbay: 'benchmark',
}

export function YearGroupsView() {
  const [breakdowns, setBreakdowns] = useState<BreakdownsFile | null>(null)
  const [laYearGroup, setLaYearGroup] = useState<BreakdownsLaYearGroupFile | null>(null)
  const [footprint, setFootprint] = useState<FootprintFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([
      loadProcessed<BreakdownsFile>('breakdowns.json'),
      loadProcessed<BreakdownsLaYearGroupFile>('breakdowns-la-yeargroup.json'),
      loadProcessed<FootprintFile>('footprint.json'),
    ])
      .then(([b, la, f]) => {
        if (!alive) return
        setBreakdowns(b)
        setLaYearGroup(la)
        setFootprint(f)
        setError(!b || !f)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setError(true)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading year group data...</div>
  if (error || !breakdowns || !footprint) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
        Year group data is not available. Run the preprocess build to generate{' '}
        <code>public/processed/</code>.
      </div>
    )
  }

  const latestPeriod = breakdowns.periods[breakdowns.periods.length - 1]
  const latestKey = latestPeriod.key
  const periodLabel = `${latestPeriod.year} ${latestPeriod.term}`

  // Year-group categories in age order, excluding Unknown (that is a data
  // quality bucket, not a point on the age gradient; its size is noted below).
  const allOrder = breakdowns.yearGroupOrder
  const categories = allOrder.filter((c) => c !== 'Unknown')

  const nationalYg = breakdowns.records.filter((r) => r.topic === 'Year group' && r.level === 'National')
  const countCells: Cell[] = categories.map((c) => countOrNull(seriesFor(nationalYg, c), latestKey))
  const percentCells: Cell[] = categories.map((c) => pctOrNull(seriesFor(nationalYg, c), latestKey))

  const unknownSeries = seriesFor(nationalYg, 'Unknown')
  const unknownCount = countOrNull(unknownSeries, latestKey)
  const receptionSeries = seriesFor(nationalYg, 'Reception')
  const receptionCount = countOrNull(receptionSeries, latestKey)

  // Steepest step between adjacent year groups (data-driven, not hardcoded to
  // "Year 8 to 9" even though that is what the current release shows).
  let stepIdx = -1
  let stepDelta = -Infinity
  let stepPpDelta: number | null = null
  for (let i = 0; i < categories.length - 1; i++) {
    const a = countCells[i].v
    const b = countCells[i + 1].v
    if (a != null && b != null && b - a > stepDelta) {
      stepDelta = b - a
      stepIdx = i
      const pa = percentCells[i].v
      const pb = percentCells[i + 1].v
      stepPpDelta = pa != null && pb != null ? pb - pa : null
    }
  }
  const stepFrom = stepIdx >= 0 ? categories[stepIdx] : null
  const stepTo = stepIdx >= 0 ? categories[stepIdx + 1] : null

  // England Years 10-11 share: sum of the two published whole-number
  // percentages for the same geography and period (a valid combination of two
  // categories of the same partition, not a recomputation of either
  // percentage itself; spec 5.7 quotes this as "36%").
  const y10PctEng = pctOrNull(seriesFor(nationalYg, 'Year 10'), latestKey)
  const y11PctEng = pctOrNull(seriesFor(nationalYg, 'Year 11'), latestKey)
  const englandShare = y10PctEng.v != null && y11PctEng.v != null ? y10PctEng.v + y11PctEng.v : null
  const y11Count = countOrNull(seriesFor(nationalYg, 'Year 11'), latestKey)

  // Two-point count trend (autumn only; counts exist from 2024/25 autumn on).
  const autumnPeriods = breakdowns.periods.filter((p) => p.term === 'Autumn')
  const y10Series = seriesFor(nationalYg, 'Year 10')
  const y11Series = seriesFor(nationalYg, 'Year 11')
  const trendPoints = autumnPeriods
    .map((p, idx) => ({
      idx,
      period: p,
      y10: y10Series?.[p.key]?.count ?? { v: null },
      y11: y11Series?.[p.key]?.count ?? { v: null },
    }))
    .filter((p) => p.y10.v != null || p.y11.v != null)

  const trendSeries: LineSeries[] = [
    {
      id: 'Year 10',
      role: 'other',
      color: '#0d9488',
      width: 2.5,
      data: trendPoints.map((p) => ({ x: p.idx, y: p.y10.v })),
    },
    {
      id: 'Year 11',
      role: 'other',
      color: '#7c3aed',
      width: 2.5,
      data: trendPoints.map((p) => ({ x: p.idx, y: p.y11.v })),
    },
  ]
  const trendTickLabel = (x: number) => trendPoints.find((p) => p.idx === x)?.period.year ?? String(x)

  // Footprint year-group profile: derive a share-of-total from the summed LA
  // counts (the same methodology as the pooled footprint rate: sum counts
  // first, never average published percentages).
  const fgByName = new Map(footprint.yearGroupLatest.groups.map((g) => [g.breakdown, g]))
  const footprintTotal = footprint.yearGroupLatest.groups.reduce((sum, g) => sum + (g.count ?? 0), 0)
  const footprintCells: Cell[] = categories.map((c) => {
    const g = fgByName.get(c)
    if (!g || g.count == null || footprintTotal <= 0) return { v: null, f: 'x' }
    const share = (g.count / footprintTotal) * 100
    // A partially-suppressed aggregate whose live sum rounds to zero must not
    // read as a genuine zero (spec rule 6): the suppressed constituents
    // contribute an unknown amount, so hatch it (rounds to zero but is not
    // zero) rather than drawing a solid 0.0% bar.
    if (g.suppressedConstituents.length > 0 && share < 0.05) return { v: null, f: 'low' }
    return { v: share }
  })
  const footprintY10 = fgByName.get('Year 10')?.count ?? null
  const footprintY11 = fgByName.get('Year 11')?.count ?? null
  const footprintShare =
    footprintY10 != null && footprintY11 != null && footprintTotal > 0
      ? ((footprintY10 + footprintY11) / footprintTotal) * 100
      : null
  const footprintPeriodLabel = footprint.yearGroupLatest.period
    ? `${footprint.yearGroupLatest.period.year} ${footprint.yearGroupLatest.period.term}`
    : periodLabel
  const anySuppressedConstituents = footprint.yearGroupLatest.groups.some(
    (g) => g.suppressedConstituents.length > 0,
  )

  // Per-LA Years 10-11 tiles (published percentages, summed).
  const laNames = ['Plymouth', 'Cornwall', 'Devon', 'Torbay']
  const laTiles = laNames.map((name) => {
    const recs = (laYearGroup?.records ?? []).filter((r) => r.name === name && r.topic === 'Year group')
    const y10c = recs.find((r) => r.breakdown === 'Year 10')?.series[latestKey]?.percent ?? { v: null, f: 'x' }
    const y11c = recs.find((r) => r.breakdown === 'Year 11')?.series[latestKey]?.percent ?? { v: null, f: 'x' }
    const share = y10c.v != null && y11c.v != null ? y10c.v + y11c.v : null
    return { name, y10: y10c, y11: y11c, share }
  })

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
        <p>
          EHE is not evenly spread across school years: nationally it rises steadily from Reception
          to Year 11, and the WeST footprint LAs (Cornwall, Plymouth, Devon) skew further toward the
          GCSE years than England as a whole. All figures below are census-date counts and
          percentages for {periodLabel}, as published; only counts are summed (never
          percentages/rates averaged across geographies).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={`England, Years 10-11, ${periodLabel}`}
          value={englandShare != null ? formatPercent(englandShare, 0) : NA}
          accent={getGeoColor('england')}
          sub="Sum of the published Year 10 and Year 11 percentages"
        />
        <KpiCard
          label={`Footprint, Years 10-11, ${footprintPeriodLabel}`}
          value={footprintShare != null ? formatPercent(footprintShare, 1) : NA}
          accent={getGeoColor('footprint')}
          delta={
            footprintShare != null && englandShare != null
              ? `${formatSignedPp(footprintShare - englandShare, 1)} vs England`
              : undefined
          }
          sub="LA-area children (Cornwall, Plymouth, Devon), not WeST pupils"
        />
        <KpiCard
          label={`Largest year-on-year jump, ${periodLabel}`}
          value={stepDelta > -Infinity ? formatSignedCount(stepDelta) : NA}
          accent="#475569"
          sub={
            stepFrom && stepTo
              ? `${stepFrom} to ${stepTo}${stepPpDelta != null ? ` (${formatSignedPp(stepPpDelta, 0)})` : ''}`
              : 'Not derivable this period'
          }
        />
        <KpiCard
          label={`England, Year 11, ${periodLabel}`}
          value={formatCell(y11Count, formatCount)}
          accent={getGeoColor('england')}
          sub={`${formatCell(y11PctEng, (v) => formatPercent(v, 0))} of all EHE children nationally, the single largest year group`}
        />
      </div>

      <ChartCard
        title={`National EHE age gradient, ${periodLabel}`}
        subtitle="Census-date counts by year group (percentage of all EHE children shown below each bar)"
        downloadName="yeargroups-national-gradient"
        footnote={
          <>
            Reception and Unknown are each below 1% of the national EHE population ({formatCell(receptionCount, formatCount)}{' '}
            and {formatCell(unknownCount, formatCount)} children respectively) and are omitted from this
            gradient for readability. The Year 11 census-date count falls away every September as
            pupils age out of compulsory school age at the end of Year 11: read any autumn-to-summer
            fall in Year 11 alongside the wider sawtooth reset, not as families returning to school.
          </>
        }
      >
        <GradientChart
          categories={categories}
          yLabel="Children"
          series={[
            {
              id: 'England',
              color: getGeoColor('england'),
              cells: countCells,
              format: formatCount,
            },
          ]}
          annotate={
            stepIdx >= 0
              ? {
                  fromIndex: stepIdx,
                  toIndex: stepIdx + 1,
                  seriesId: 'England',
                  label: `Steepest step: +${stepDelta.toLocaleString('en-GB')}`,
                }
              : undefined
          }
        />
      </ChartCard>

      <ChartCard
        title="Years 10 and 11 counts, autumn to autumn"
        subtitle="National census-date counts; only two autumns are available because year-group counts were first published for 2024/25 (percent-only before)"
        downloadName="yeargroups-y10-y11-trend"
        legend={[
          { color: '#0d9488', label: 'Year 10' },
          { color: '#7c3aed', label: 'Year 11' },
        ]}
        footnote="Both points fall after collection became mandatory (autumn 2024), but response rates were still converging toward 100% during this window, so part of any rise here can reflect improving coverage rather than only genuine growth. Autumn-to-autumn only: no within-year comparison is implied."
      >
        {trendPoints.length >= 2 ? (
          <LineChart series={trendSeries} height={220} yLabel="Children" xTickLabel={trendTickLabel} />
        ) : (
          <div className="p-6 text-sm text-slate-400">Not enough count-bearing autumns to plot a trend.</div>
        )}
      </ChartCard>

      <ChartCard
        title={`Footprint age profile vs England, ${footprintPeriodLabel}`}
        subtitle="Share of each geography's own EHE cohort by year group (England: published percentages; footprint: derived from summed LA counts)"
        downloadName="yeargroups-footprint-overlay"
        legend={[
          { role: 'england', label: 'England', dashed: true },
          { role: 'footprint', label: 'WeST footprint' },
        ]}
        footnote={
          <>
            Footprint proxy caveat: Cornwall, Plymouth and Devon are LA areas, not WeST pupils.
            Footprint shares are derived from summed live LA cells ({footprintTotal.toLocaleString('en-GB')}{' '}
            children this period, {footprint.yearGroupLatest.note.toLowerCase()}); this can differ
            slightly from the separately-published pooled footprint total due to independent
            per-cell rounding.{' '}
            {anySuppressedConstituents &&
              'Hatched bars mark year groups where at least one constituent LA cell was suppressed (rounds to zero) and excluded from the sum.'}
          </>
        }
      >
        <GradientChart
          categories={categories}
          yLabel="% of cohort"
          series={[
            { id: 'England', color: getGeoColor('england'), cells: percentCells, format: (v) => formatPercent(v, 0) },
            { id: 'Footprint', color: getGeoColor('footprint'), cells: footprintCells, format: (v) => formatPercent(v, 1) },
          ]}
        />
      </ChartCard>

      <ChartCard
        title={`Years 10-11 share by local authority, ${periodLabel}`}
        subtitle="Published percentages, summed (Year 10 % + Year 11 %); footprint LAs plus the Torbay benchmark"
        downloadName="yeargroups-la-tiles"
        footnote="Footprint proxy caveat: these are LA-area children, not WeST pupils. Devon sits close to the England share; Cornwall and Torbay run somewhat above it; Plymouth is the outlier, with roughly half of its EHE cohort in the GCSE years."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {laTiles.map((t) => (
            <KpiCard
              key={t.name}
              label={t.name}
              value={t.share != null ? formatPercent(t.share, 0) : NA}
              accent={getGeoColor(FOOTPRINT_LA_ROLE[t.name] ?? 'benchmark')}
              delta={
                t.share != null && englandShare != null
                  ? `${formatSignedPp(t.share - englandShare, 0)} vs England`
                  : undefined
              }
              sub={`Year 10 ${formatCell(t.y10, (v) => formatPercent(v, 0))}, Year 11 ${formatCell(t.y11, (v) => formatPercent(v, 0))}`}
            />
          ))}
        </div>
      </ChartCard>
    </div>
  )
}

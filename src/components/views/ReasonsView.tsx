import { useEffect, useState, type ReactNode } from 'react'
import { ChartCard, type LegendItem } from '../ChartCard'
import { BarChart, type Bar } from '../charts/BarChart'
import { LineChart, type LineSeries, type LinePoint } from '../charts/LineChart'
import { ScatterChart, type ScatterPoint } from '../charts/ScatterChart'
import { loadProcessed } from '../../services/dataService'
import { KpiCard } from '../KpiCard'
import { formatPercent } from '../../utils/formatting'
import {
  getReasonColor,
  getReasonFamily,
  getGeoColor,
  REASON_FAMILY_COLORS,
  REASON_FAMILY_LABEL,
  type ReasonFamily,
} from '../../utils/colors'
import type { Cell } from '../../types'

// ----- local shapes (scripts/DATA_SHAPES.md sections 2 and 3) --------------
// This view owns only this file, so the JSON contract it reads is modelled
// locally rather than imported from a shared types module.
interface PeriodPoint {
  key: string
  year: string
  term: 'Autumn' | 'Spring' | 'Summer'
  sort: number
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
  periods: PeriodPoint[]
  reasonOrder: string[]
  yearGroupOrder: string[]
  sexOrder: string[]
  records: BreakdownRecord[]
}

interface LaBreakdownRecord {
  level: 'Local authority'
  code: string
  name: string
  region_code: string | null
  region_name: string | null
  topic: 'Reason'
  breakdown: string
  series: Record<string, BreakdownSeriesEntry>
}

interface BreakdownsLaReason {
  periods: PeriodPoint[]
  topic: 'Reason'
  reasonOrder: string[]
  records: LaBreakdownRecord[]
}

// The two reason categories the autumn-2025/26 collection added (spec 5.8
// "New-categories-autumn-2025 note"; data/README.md). Every earlier period has
// no data at all for these, national/regional/LA alike; they are not merely
// suppressed, they did not exist as a collectable category before.
const NEW_REASONS_2025 = [
  'Offered school place but not yet accepted',
  'Did not apply for school place at compulsory school age',
]

const FOOTPRINT_LAS = ['Cornwall', 'Plymouth', 'Devon'] as const

const SUBSTANTIVE_COLOR = '#64748b' // slate: "all named, non-data-quality reasons" bucket

function cellPct(entry: BreakdownSeriesEntry | undefined): number | null {
  return entry?.percent?.v ?? null
}

// Ordinary least squares fit for the regional honesty scatter. Returns null
// when fewer than two points or a degenerate (zero-variance) x.
function linearFit(pts: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  const n = pts.length
  if (n < 2) return null
  const meanX = pts.reduce((a, p) => a + p.x, 0) / n
  const meanY = pts.reduce((a, p) => a + p.y, 0) / n
  let num = 0
  let den = 0
  for (const p of pts) {
    num += (p.x - meanX) * (p.y - meanY)
    den += (p.x - meanX) ** 2
  }
  if (den === 0) return null
  const slope = num / den
  return { slope, intercept: meanY - slope * meanX }
}

// ----- small local presentational helpers -----------------------------------

function Callout({ tone, children }: { tone: 'amber' | 'slate'; children: ReactNode }) {
  const cls =
    tone === 'amber'
      ? 'border-amber-300 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-600'
  return <div className={`rounded-md border px-3 py-2 text-xs leading-snug ${cls}`}>{children}</div>
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors print:hidden ${
        active
          ? 'border-slate-700 bg-slate-700 text-white'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

interface StackSegment {
  label: string
  pct: number
  color: string
}

// A percentage-width stacked row (flex divs, not SVG): each footprint LA's
// reason-recording mix for one autumn. Segments below ~6% skip their inline
// number to avoid unreadable overlap; the full value is always in the title
// attribute for hover/accessibility.
function StackRow({ periodLabel, segments }: { periodLabel: string; segments: StackSegment[] }) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[11px] font-medium text-slate-500">{periodLabel}</div>
      <div className="flex h-6 w-full overflow-hidden rounded-md border border-slate-200">
        {segments.map((s) =>
          s.pct <= 0 ? null : (
            <div
              key={s.label}
              className="flex items-center justify-center text-[9px] font-medium text-white"
              style={{ width: `${s.pct}%`, background: s.color }}
              title={`${s.label}: ${formatPercent(s.pct)}`}
            >
              {s.pct >= 7 ? Math.round(s.pct) : ''}
            </div>
          ),
        )}
      </div>
    </div>
  )
}

function SuppressedRow({ periodLabel }: { periodLabel: string }) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[11px] font-medium text-slate-500">{periodLabel}</div>
      <div
        className="h-6 w-full rounded-md border border-dashed border-slate-300 bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_6px,#e2e8f0_6px,#e2e8f0_12px)]"
        title="Cannot be disaggregated this period: Unknown or Other itself is suppressed"
        aria-label="Suppressed: cannot be disaggregated this period"
      />
    </div>
  )
}

export function ReasonsView() {
  // undefined = still loading; null = fetch failed (distinct from not-yet-loaded)
  const [breakdowns, setBreakdowns] = useState<Breakdowns | null | undefined>(undefined)
  const [laReason, setLaReason] = useState<BreakdownsLaReason | null>(null)
  const [renorm, setRenorm] = useState(false)

  useEffect(() => {
    let alive = true
    void loadProcessed<Breakdowns>('breakdowns.json').then((d) => {
      if (alive) setBreakdowns(d)
    })
    void loadProcessed<BreakdownsLaReason>('breakdowns-la-reason.json').then((d) => {
      if (alive) setLaReason(d)
    })
    return () => {
      alive = false
    }
  }, [])

  if (breakdowns === undefined) {
    return <div className="p-8 text-sm text-slate-500">Loading reasons data.</div>
  }
  if (breakdowns === null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        No processed data found. Run <code>npm run preprocess</code> first.
      </div>
    )
  }

  const autumns = breakdowns.periods.filter((p) => p.term === 'Autumn')
  const latest = autumns[autumns.length - 1]
  const nationalReasons = breakdowns.records.filter((r) => r.level === 'National' && r.topic === 'Reason')
  const regionalReasons = breakdowns.records.filter((r) => r.level === 'Regional' && r.topic === 'Reason')

  if (!latest) {
    return <div className="p-8 text-sm text-slate-500">No autumn reason data available.</div>
  }

  // ----- 1. national ranked bar, with the renormalised "known substantive
  // reasons" toggle (spec 4.8, 5.8) -----------------------------------------
  const reasonItems = breakdowns.reasonOrder.map((name) => {
    const rec = nationalReasons.find((r) => r.breakdown === name)
    const entry = rec?.series[latest.key]
    return { name, pct: cellPct(entry), family: getReasonFamily(name) }
  })
  const substantiveItems = [...reasonItems]
    .filter((i) => i.family !== 'dataQuality')
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
  const dataQualityItems = [...reasonItems]
    .filter((i) => i.family === 'dataQuality')
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
  const substantiveSum = substantiveItems.reduce((a, i) => a + (i.pct ?? 0), 0)
  const suppressedSubstantive = substantiveItems.filter((i) => i.pct == null)

  function substantiveBar(i: (typeof reasonItems)[number]): Bar {
    const value = renorm
      ? substantiveSum > 0 && i.pct != null
        ? (i.pct / substantiveSum) * 100
        : null
      : i.pct
    return { id: i.name, label: i.name, value, color: getReasonColor(i.name) }
  }
  const dataQualityBars: Bar[] = dataQualityItems.map((i) => ({
    id: i.name,
    label: i.name,
    value: i.pct,
    color: getReasonColor(i.name),
  }))

  const familyLegend: LegendItem[] = (
    Object.entries(REASON_FAMILY_COLORS) as [ReasonFamily, string][]
  ).map(([family, color]) => ({ label: REASON_FAMILY_LABEL[family], color, band: true }))

  // ----- 2. crossover slopegraph: mental health vs philosophical/preferential
  const mhRec = nationalReasons.find((r) => r.breakdown === 'Mental health')
  const philRec = nationalReasons.find((r) => r.breakdown === 'Philosophical or preferential')
  const yearByKey = new Map(autumns.map((p) => [p.sort, p.year]))
  function toPoints(rec: BreakdownRecord | undefined): LinePoint[] {
    return autumns.map((p) => ({ x: p.sort, y: cellPct(rec?.series[p.key]) }))
  }
  const mhSeries: LineSeries = {
    id: 'Mental health',
    role: 'other',
    color: getReasonColor('Mental health'),
    width: 3,
    data: toPoints(mhRec),
  }
  const philSeries: LineSeries = {
    id: 'Philosophical or preferential',
    role: 'other',
    color: getReasonColor('Philosophical or preferential'),
    width: 3,
    data: toPoints(philRec),
  }
  let crossoverSort: number | undefined
  for (let idx = 1; idx < autumns.length; idx++) {
    const prevMh = cellPct(mhRec?.series[autumns[idx - 1].key])
    const prevPhil = cellPct(philRec?.series[autumns[idx - 1].key])
    const mh = cellPct(mhRec?.series[autumns[idx].key])
    const phil = cellPct(philRec?.series[autumns[idx].key])
    if (prevMh != null && prevPhil != null && mh != null && phil != null && prevMh < prevPhil && mh >= phil) {
      crossoverSort = autumns[idx].sort
      break
    }
  }

  // ----- 3. regional honesty scatter: x = Unknown%, y = Mental health% ------
  const unknownByRegion = regionalReasons.filter((r) => r.breakdown === 'Unknown')
  const regionPoints: ScatterPoint[] = unknownByRegion
    .map((unkRec): ScatterPoint | null => {
      const mh = regionalReasons.find((r) => r.name === unkRec.name && r.breakdown === 'Mental health')
      const x = cellPct(unkRec.series[latest.key])
      const y = cellPct(mh?.series[latest.key])
      if (x == null || y == null) return null
      const isSw = unkRec.name === 'South West'
      return {
        id: unkRec.code,
        label: unkRec.name,
        x,
        y,
        highlight: isSw,
        color: isSw ? getGeoColor('southWest') : '#94a3b8',
      }
    })
    .filter((p): p is ScatterPoint => p != null)
  const fit = linearFit(regionPoints.map((p) => ({ x: p.x, y: p.y })))
  const unknownVals = regionPoints.map((p) => p.x)
  const minUnknown = unknownVals.length ? Math.min(...unknownVals) : null
  const maxUnknown = unknownVals.length ? Math.max(...unknownVals) : null
  const swPoint = regionPoints.find((p) => p.label === 'South West')

  // ----- 4. footprint recording-gap stacked bars -----------------------------
  // Three autumns only (2023/24 onward): Cornwall's 2022/23 Total is
  // suppressed, matching the footprint series convention used elsewhere.
  const footprintAutumns = autumns.filter((p) => p.year !== '2022/23')

  function laPct(la: string, reason: string, periodKey: string): number | null {
    const rec = laReason?.records.find((r) => r.name === la && r.breakdown === reason)
    return cellPct(rec?.series[periodKey])
  }

  // "No reason given" is frequently suppressed (published "low") at LA grain
  // for Devon and Plymouth, even in periods where Unknown and Other are both
  // live. Rather than hatch out most of the footprint (the substantive figure
  // would need it to net against 100), it is folded into the Unknown segment
  // (both are non-informative reason codes, unlike the genuine catch-all
  // "Other"), which keeps this a 3-segment chart matching spec 5.8. Where it
  // is suppressed for a given LA/period, that small cell is simply excluded
  // from the total (the "excludes suppressed small cells" convention used
  // elsewhere in this dashboard, e.g. footprint.json's year-group aggregate),
  // and the period is listed in the footnote below.
  function segmentsFor(la: string, periodKey: string): StackSegment[] | null {
    const unk = laPct(la, 'Unknown', periodKey)
    const other = laPct(la, 'Other', periodKey)
    if (unk == null || other == null) return null
    const noReason = laPct(la, 'No reason given', periodKey)
    const combinedUnknown = unk + (noReason ?? 0)
    const substantive = Math.max(0, 100 - combinedUnknown - other)
    return [
      { label: 'Substantive reasons (all named, non-data-quality)', pct: substantive, color: SUBSTANTIVE_COLOR },
      { label: 'Unknown / no reason given', pct: combinedUnknown, color: getReasonColor('Unknown') },
      { label: 'Other', pct: other, color: getReasonColor('Other') },
    ]
  }

  const noReasonGivenSuppressedPeriods = FOOTPRINT_LAS.flatMap((la) =>
    footprintAutumns
      .filter((p) => laPct(la, 'No reason given', p.key) == null && laPct(la, 'Unknown', p.key) != null)
      .map((p) => `${la} ${p.year}`),
  )

  const cornwallOtherLatest = laPct('Cornwall', 'Other', latest.key)
  const devonUnknownTrend = footprintAutumns.map((p) => ({
    year: p.year,
    pct: laPct('Devon', 'Unknown', p.key),
  }))

  return (
    <div className="space-y-4">
      <Callout tone="slate">
        Above Local Authority level, reason <em>counts</em> are structurally suppressed by the DfE (spec
        rule 4.12): every chart on this view uses published percentages, never a reconstructed count.
        Reason data is also affected by the standing collection-maturity caveat: the census became
        mandatory from autumn 2024 having been voluntary from autumn 2022 (93 to 100% response), and
        national/regional figures are uprated for non-response, so part of any change in the reason mix,
        including the falling national Unknown share (21% in autumn 2022/23 to 17% in autumn{' '}
        {latest.year}), is improved recording rather than a change in why children are being
        home-educated.
      </Callout>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label={`England, autumn ${latest.year}`}
          value={formatPercent(mhRec ? cellPct(mhRec.series[latest.key]) : null)}
          accent={getReasonColor('Mental health')}
          sub="Mental health, the top named reason nationally"
        />
        <KpiCard
          label={`England, autumn ${latest.year}`}
          value={formatPercent(philRec ? cellPct(philRec.series[latest.key]) : null)}
          accent={getReasonColor('Philosophical or preferential')}
          sub="Philosophical or preferential, now second"
        />
        <KpiCard
          label={`England, autumn ${latest.year}`}
          value={formatPercent(dataQualityItems.find((i) => i.name === 'Unknown')?.pct ?? null)}
          accent={getReasonColor('Unknown')}
          sub="Reason recorded as Unknown, roughly 3 in 10 reasons once No reason given is added"
        />
      </div>

      <ChartCard
        title={`National reasons for EHE, autumn ${latest.year}`}
        subtitle={
          renorm
            ? 'Renormalised: substantive (named, non-data-quality) reasons only, rescaled to sum to 100% of known substantive reasons'
            : 'Percentage of all EHE children, as published. Unknown, No reason given and Other are shown separately as a data-quality group, not a reason'
        }
        downloadName={`reasons-national-${latest.key}`}
        legend={familyLegend}
        footnote={
          <>
            {renorm ? (
              <>
                Approximate: inputs are integer-rounded published percentages and the low-suppressed
                substantive categories (marked n/a below) are excluded from the rescaling, so this cut
                understates the true denominator slightly.{' '}
              </>
            ) : null}
            Bars marked n/a (Permanent exclusion, Offered school place but not yet accepted, Did not
            apply for school place at compulsory school age, School suggestion) round to zero but are
            not zero (published as &quot;low&quot;). National reason <em>counts</em> are suppressed
            everywhere; only the percentage is published.
          </>
        }
      >
        <div className="mb-3 flex items-center gap-2">
          <ToggleButton active={!renorm} onClick={() => setRenorm(false)}>
            % of all reasons (as published)
          </ToggleButton>
          <ToggleButton active={renorm} onClick={() => setRenorm(true)}>
            % of known substantive reasons (renormalised)
          </ToggleButton>
        </div>
        <BarChart
          bars={substantiveItems.map(substantiveBar)}
          valueSuffix="%"
          valueDp={renorm ? 1 : 0}
          labelWidth={230}
          rowHeight={22}
        />
        {!renorm && (
          <>
            <div className="mb-1 mt-4 text-xs font-semibold text-slate-500">
              Data quality (not a reason): Unknown, No reason given, Other
            </div>
            <BarChart bars={dataQualityBars} valueSuffix="%" valueDp={0} labelWidth={230} rowHeight={22} />
          </>
        )}
        {suppressedSubstantive.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-400">
            Suppressed this period ({suppressedSubstantive.length} categor
            {suppressedSubstantive.length === 1 ? 'y' : 'ies'}, published as &quot;low&quot;):{' '}
            {suppressedSubstantive.map((i) => i.name).join(', ')}.
          </p>
        )}
      </ChartCard>

      <ChartCard
        title="The reasons crossover: mental health overtakes philosophical or preferential"
        subtitle="National reason percentages, autumn term each year"
        downloadName="reasons-crossover-slopegraph"
        legend={[
          { label: 'Mental health', color: getReasonColor('Mental health'), band: true },
          { label: 'Philosophical or preferential', color: getReasonColor('Philosophical or preferential'), band: true },
        ]}
        footnote="Both series are the published national reason percentage for that autumn; they are not adjusted for the falling Unknown share, so part of every named reason's rise, including mental health's, is partly the shrinking pool of Unknown/No reason given responses becoming named reasons instead."
      >
        <LineChart
          series={[mhSeries, philSeries]}
          yLabel="% of reasons"
          valueSuffix="%"
          yMin={0}
          yMax={20}
          xTickLabel={(x) => yearByKey.get(x) ?? String(x)}
          markerX={crossoverSort}
          markerLabel="Crossover"
        />
      </ChartCard>

      <ChartCard
        title="Regional honesty check: does a high Unknown share inflate named reasons?"
        subtitle={`x = Unknown %, y = Mental health %, all 10 regions, autumn ${latest.year} (Inner and Outer London shown separately)`}
        downloadName="reasons-regional-honesty-scatter"
        legend={[
          { label: 'South West', color: getGeoColor('southWest'), band: true },
          { label: 'Other regions', color: '#94a3b8', band: true },
        ]}
        footnote={
          <>
            Mechanical dilution, not causation: Unknown reason share varies from{' '}
            {minUnknown != null ? formatPercent(minUnknown) : 'n/a'} to{' '}
            {maxUnknown != null ? formatPercent(maxUnknown) : 'n/a'} by region, and every named reason's
            percentage is diluted (or inflated) by how much of the total sits in Unknown / No reason
            given / Other for that region, before any real difference in why families choose EHE. South
            West sits at{' '}
            {swPoint
              ? `${formatPercent(swPoint.x)} Unknown, ${formatPercent(swPoint.y)} Mental health`
              : 'n/a'}
            . The dashed line is an ordinary-least-squares fit across the 10 regions, shown to illustrate
            the association, not to claim a causal effect.
          </>
        }
      >
        <ScatterChart
          points={regionPoints}
          xLabel="Unknown reason, % of EHE children"
          yLabel="Mental health reason, % of EHE children"
          fit={fit}
          xSuffix="%"
          ySuffix="%"
        />
      </ChartCard>

      <ChartCard
        title="Footprint recording gap: Cornwall, Plymouth and Devon"
        subtitle="Reason mix by autumn: substantive (named) reasons vs Unknown/no reason given vs Other"
        downloadName="reasons-footprint-recording-gap"
        legend={[
          { label: 'Substantive reasons', color: SUBSTANTIVE_COLOR, band: true },
          { label: 'Unknown / no reason given', color: getReasonColor('Unknown'), band: true },
          { label: 'Other', color: getReasonColor('Other'), band: true },
        ]}
        footnote={
          <>
            WeST footprint proxy caveat: these are Cornwall, Plymouth and Devon as LA areas, not WeST
            pupils. The suppression at LA level will not bear a school-driven-vs-lifestyle split; this
            chart only separates named (substantive) reasons in aggregate from the data-quality group, it
            does not say which named reasons those are. The Unknown segment combines the published
            Unknown and No reason given percentages (both are non-informative reason codes, unlike the
            catch-all Other); No reason given itself was suppressed (published &quot;low&quot;, rounds to
            zero but is not zero) and so excluded from the total, in{' '}
            {noReasonGivenSuppressedPeriods.length > 0 ? noReasonGivenSuppressedPeriods.join(', ') : 'no periods shown'}
            . Hatched rows would mean Unknown or Other itself was suppressed that period (none are, at
            this release).
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FOOTPRINT_LAS.map((la) => (
            <div key={la}>
              <div className="mb-1 text-xs font-semibold text-slate-700">{la}</div>
              {footprintAutumns.map((p) => {
                const segs = segmentsFor(la, p.key)
                return segs ? (
                  <StackRow key={p.key} periodLabel={p.year} segments={segs} />
                ) : (
                  <SuppressedRow key={p.key} periodLabel={p.year} />
                )
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1 text-[11px] text-slate-500">
          <p>
            Cornwall&apos;s Other reason share is an anomaly at the latest autumn:{' '}
            {cornwallOtherLatest != null ? formatPercent(cornwallOtherLatest) : 'n/a'} of Cornwall&apos;s
            EHE children in autumn {latest.year}, well above Plymouth&apos;s and Devon&apos;s Other
            shares in the same period; it is presented as-published, not smoothed away.
          </p>
          <p>
            Devon&apos;s Unknown share has been rising, not falling, across the three footprint autumns:{' '}
            {devonUnknownTrend
              .map((d) => `${d.year} ${d.pct != null ? formatPercent(d.pct) : 'n/a'}`)
              .join(', then ')}
            . That runs against the national direction (Unknown falling as collection matures), so it
            reads as a recording-practice difference at Devon specifically, not a national pattern.
          </p>
        </div>
      </ChartCard>

      <Callout tone="amber">
        New categories, autumn {latest.year}: &quot;{NEW_REASONS_2025[0]}&quot; and &quot;
        {NEW_REASONS_2025[1]}&quot; have no data in any earlier period at any geography, national,
        regional or LA. They are new reason categories added in the autumn 2025 collection, not
        previously-suppressed ones becoming visible. Both are currently published as &quot;low&quot;
        (rounds to zero but is not zero) nationally, so their effect on the totals above is negligible
        at this release, but any future autumn-on-autumn comparison spanning autumn {latest.year} should
        note that the set of reason categories itself changed, not only the children choosing them.
      </Callout>
    </div>
  )
}

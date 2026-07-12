import { useEffect, useState, type ReactNode } from 'react'
import { ChartCard } from '../ChartCard'
import { KpiCard } from '../KpiCard'
import { BarChart, type Bar } from '../charts/BarChart'
import { loadProcessed } from '../../services/dataService'
import {
  formatCount,
  formatRate,
  formatPercent,
  formatSignedRate,
  formatBuildStamp,
  NA,
} from '../../utils/formatting'
import { getGeoColor, REASON_FAMILY_LABEL, REASON_FAMILY_COLORS, type ReasonFamily } from '../../utils/colors'
import { DFE_RELEASE_URL, OFFICIAL_STATS_BADGE } from '../../constants'
import type { Cell } from '../../types'

// This view owns exactly this file (spec section 8 step 4). Data is loaded
// only via the dataService generic loader; every shape below is a local slice
// of the file documented in scripts/DATA_SHAPES.md, matching the pattern used
// by the other view agents (no shared types beyond Cell are relied on).
//
// This is the spec section 5.10 reference view: the maths and definitions
// behind every other view, so every worked number here is pulled live from the
// processed JSON rather than copied from the spec text, and is recomputed if
// the underlying release changes.

// ----- local file shapes (scripts/DATA_SHAPES.md) ---------------------------

interface PeriodLabel {
  key: string
  year: string
  term: string
}

interface MetadataFile {
  generated_at: string
  release: string
  source: string
  source_url: string
  licence: string
  status: string
  census: { file: string; measure: string; periods: PeriodLabel[]; period_count: number; rows: number }
  academic_year: { file: string; measure: string; years: string[]; rows: number }
  regions: string[]
  region_count: number
  distinct_la_codes: number
  distinct_la_names: number
  footprint_las: Record<string, string>
  footprint_series_starts: string
  footprint_excludes: string
  benchmark_las: Record<string, string>
  suppression: { x: string; z: string; low: string; blank: string }
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
  series: Record<string, TotalsSeriesPoint>
}

interface TotalsFile {
  periods: { key: string; year: string; term: string; sort: number }[]
  geographies: TotalsGeography[]
}

interface FootprintConstituent {
  code: string
  count: number | null
  rate: number | null
  pop: number | null
}

interface FootprintSeriesPoint {
  key: string
  year: string
  term: string
  sort: number
  count: number
  rate: number
  pop: number
  constituents: Record<string, FootprintConstituent>
  suppressed: string[]
}

interface FootprintFile {
  periods: { key: string; year: string; term: string; sort: number }[]
  constituentOrder: string[]
  excludedYear: string
  excludedReason: string
  series: FootprintSeriesPoint[]
}

interface FlowRecord {
  level: 'National' | 'Regional' | 'Local authority'
  code: string
  name: string
  series: Record<string, Record<string, Cell>>
}

interface FlowsFile {
  years: { key: string; label: string }[]
  records: FlowRecord[]
}

interface BreakdownRecord {
  level: 'National' | 'Regional'
  code: string
  name: string
  topic: 'Sex' | 'Year group' | 'Reason'
  breakdown: string
  series: Record<string, { count: Cell; percent: Cell }>
}

interface BreakdownsFile {
  periods: { key: string; year: string; term: string; sort: number }[]
  records: BreakdownRecord[]
}

// ----- small local building blocks (view-local, per spec section 8) --------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:break-inside-avoid">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            {head.map((h) => (
              <th key={h} scope="col" className="px-2 py-1 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1 text-slate-700">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Suppression is rendered as a hatch in tables and the map (spec section 7);
// this is the same visual convention, reproduced locally so the definition and
// the picture sit next to each other. A distinct pattern id keeps it from
// colliding with MapView's own hatch def in the DOM.
function SuppressionSwatch() {
  return (
    <svg width="48" height="20" role="img" aria-label="suppressed cell hatch pattern" className="shrink-0">
      <defs>
        <pattern
          id="ehe-methodology-hatch"
          width="6"
          height="6"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="6" height="6" fill="#f1f5f9" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#cbd5e1" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="48" height="20" rx="3" fill="url(#ehe-methodology-hatch)" stroke="#cbd5e1" />
    </svg>
  )
}

// First-order rounding-error propagation for the back-out population identity
// (pop = count / rate * 100). A rate published to 1 dp has a true value
// somewhere in [rate-0.05, rate+0.05); because pop is inversely proportional
// to rate, the relative error in pop is approximately equal to the relative
// error in rate: about 0.05 / rate. This is computed here, not copied from the
// spec, so it tracks whatever the current release's constituent rates are.
function backoutSensitivity(rate: number, count: number) {
  const lowRate = rate - 0.05
  const highRate = rate + 0.05
  const popAtHigh = (count / highRate) * 100 // smaller population (rate read as higher)
  const popAtLow = lowRate > 0 ? (count / lowRate) * 100 : null // larger population (rate read as lower)
  const published = (count / rate) * 100
  const halfRangePct = popAtLow != null ? ((popAtLow - popAtHigh) / 2 / published) * 100 : null
  return { popAtLow, popAtHigh, published, halfRangePct }
}

export function MethodologyView() {
  const [metadata, setMetadata] = useState<MetadataFile | null | undefined>(undefined)
  const [totals, setTotals] = useState<TotalsFile | null | undefined>(undefined)
  const [footprint, setFootprint] = useState<FootprintFile | null | undefined>(undefined)
  const [flows, setFlows] = useState<FlowsFile | null | undefined>(undefined)
  const [breakdowns, setBreakdowns] = useState<BreakdownsFile | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void loadProcessed<MetadataFile>('metadata.json').then((d) => alive && setMetadata(d))
    void loadProcessed<TotalsFile>('totals.json').then((d) => alive && setTotals(d))
    void loadProcessed<FootprintFile>('footprint.json').then((d) => alive && setFootprint(d))
    void loadProcessed<FlowsFile>('flows.json').then((d) => alive && setFlows(d))
    void loadProcessed<BreakdownsFile>('breakdowns.json').then((d) => alive && setBreakdowns(d))
    return () => {
      alive = false
    }
  }, [])

  if (metadata === undefined) {
    return <div className="p-8 text-sm text-slate-400">Loading data.</div>
  }
  if (metadata === null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        No processed data found. Run <code>npm run preprocess</code> first.
      </div>
    )
  }

  // ----- census vs at-any-point anchors (rule 4.5) --------------------------
  const england = totals?.geographies.find((g) => g.level === 'National' && g.code === 'E92000001')
  const latestCensusPeriod = metadata.census.periods[metadata.census.periods.length - 1]
  const latestCensus = england?.series[latestCensusPeriod.key]
  const englandPop = latestCensus?.pop ?? null

  const nationalFlow = flows?.records.find((r) => r.level === 'National')
  const flowYears = flows?.years ?? []
  const latestFlowYear = flowYears[flowYears.length - 1]
  const prevFlowYear = flowYears[flowYears.length - 2]
  const latestAnytime = latestFlowYear ? nationalFlow?.series[latestFlowYear.key]?.anytime?.v ?? null : null
  const prevAnytime = prevFlowYear ? nationalFlow?.series[prevFlowYear.key]?.anytime?.v ?? null : null

  // ----- footprint pooled-rate worked example (rule 4.3) --------------------
  const footprintSeries = footprint?.series ?? []
  const constituentOrder = footprint?.constituentOrder ?? []
  const footprintExcludedReason = footprint?.excludedReason ?? metadata.footprint_excludes
  const latestFootprint: FootprintSeriesPoint | undefined =
    footprintSeries.length > 0 ? footprintSeries[footprintSeries.length - 1] : undefined
  const naiveMeanByPeriod = footprintSeries.map((s) => {
    const rates = Object.values(s.constituents)
      .map((c) => c.rate)
      .filter((r): r is number => r != null)
    const mean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null
    return { period: s, naiveMean: mean, pooled: s.rate }
  })
  const latestNaive = naiveMeanByPeriod.length > 0 ? naiveMeanByPeriod[naiveMeanByPeriod.length - 1] : null

  const sensitivityRows = latestFootprint
    ? Object.entries(latestFootprint.constituents)
        .filter(([, c]) => c.rate != null && c.count != null)
        .map(([name, c]) => ({ name, ...backoutSensitivity(c.rate as number, c.count as number) }))
    : []
  const mostSensitive = sensitivityRows.length
    ? sensitivityRows.reduce((a, b) => ((b.halfRangePct ?? 0) > (a.halfRangePct ?? 0) ? b : a))
    : null

  // Plymouth's own two most recent published autumn rates, for the
  // multi-year-averaging mitigation point (a single-period jump can be partly
  // rounding noise; a run of periods is more trustworthy than one delta).
  const plymouthAutumns = footprint?.series
    .filter((s) => s.term === 'Autumn')
    .map((s) => ({ year: s.year, rate: s.constituents['Plymouth']?.rate ?? null }))

  // ----- reason honesty: regional Unknown-share range (rule 4.8) -----------
  const unknownRegional = breakdowns?.records.filter(
    (r) => r.level === 'Regional' && r.topic === 'Reason' && r.breakdown === 'Unknown',
  )
  const latestReasonPeriod = breakdowns?.periods
    .filter((p) => p.term === 'Autumn')
    .sort((a, b) => b.sort - a.sort)[0]
  const unknownValues = latestReasonPeriod
    ? (unknownRegional
        ?.map((r) => r.series[latestReasonPeriod.key]?.percent?.v)
        .filter((v): v is number => v != null) ?? [])
    : []
  const unknownMin = unknownValues.length ? Math.min(...unknownValues) : null
  const unknownMax = unknownValues.length ? Math.max(...unknownValues) : null
  const unknownNational = breakdowns?.records.find(
    (r) => r.level === 'National' && r.topic === 'Reason' && r.breakdown === 'Unknown',
  )
  const nationalUnknownFirst =
    unknownNational && metadata.census.periods.length
      ? unknownNational.series[
          breakdowns?.periods.filter((p) => p.term === 'Autumn').sort((a, b) => a.sort - b.sort)[0]?.key ?? ''
        ]?.percent?.v ?? null
      : null
  const nationalUnknownLatest =
    unknownNational && latestReasonPeriod ? unknownNational.series[latestReasonPeriod.key]?.percent?.v ?? null : null

  const reasonFamilies = Object.entries(REASON_FAMILY_LABEL) as [ReasonFamily, string][]

  const naiveVsPooledBars: Bar[] = latestNaive
    ? [
        { id: 'naive', label: 'Naive mean of the 3 LA rates', value: latestNaive.naiveMean, color: '#94a3b8' },
        { id: 'pooled', label: 'Correct pooled rate (population-weighted)', value: latestNaive.pooled, color: getGeoColor('footprint') },
      ]
    : []

  return (
    <div className="space-y-4">
      <Section title="What this dashboard is, and is not">
        <p>
          This dashboard shows Elective Home Education (EHE) figures for England, its 10 regions,
          and every local authority, alongside a pooled &ldquo;WeST footprint&rdquo; built from the
          three local authorities WeST operates in: Cornwall, Plymouth and Devon. The finest grain in
          the source data is the local authority, so the footprint is an <strong>LA-area proxy</strong>
          {' '}(children resident in those three local authorities), <strong>not a count of WeST
          pupils</strong>. This caveat applies to every footprint figure on the dashboard.
        </p>
        <p>
          Source: {metadata.source} ({metadata.release}), published under the{' '}
          {metadata.licence}. Read the release at{' '}
          <a href={metadata.source_url || DFE_RELEASE_URL} className="text-primary-700 underline" target="_blank" rel="noreferrer">
            {metadata.source_url || DFE_RELEASE_URL}
          </a>
          . Status: <strong>{metadata.status || OFFICIAL_STATS_BADGE}</strong>: methodology,
          coverage and collection are still maturing release to release (see the collection maturity
          section below).
        </p>
      </Section>

      <Section title="Two different measures: census-date stock vs at-any-point flow">
        <p>
          The two source files measure genuinely different things, are on different reporting
          calendars, and are <strong>never arithmetically reconciled against each other</strong> in
          this dashboard:
        </p>
        <Table
          head={['Measure', 'What it counts', 'Calendar', 'Latest published figure (England)']}
          rows={[
            [
              'Census-date stock',
              metadata.census.measure,
              `Termly: ${metadata.census.periods[0]?.year} to ${latestCensusPeriod.year} (${metadata.census.period_count} term-points)`,
              latestCensus
                ? `${formatCount(latestCensus.count.v)} children, ${formatRate(latestCensus.rate.v)} per 100, ${latestCensusPeriod.term.toLowerCase()} ${latestCensusPeriod.year}`
                : NA,
            ],
            [
              'At-any-point flow',
              metadata.academic_year.measure,
              `Annual, one year behind the census file: ${metadata.academic_year.years[0]} to ${metadata.academic_year.years[metadata.academic_year.years.length - 1]}`,
              latestAnytime != null
                ? `${formatCount(latestAnytime)} children were EHE at some point in ${latestFlowYear?.label}${prevAnytime != null ? ` (up from ${formatCount(prevAnytime)} in ${prevFlowYear?.label})` : ''}`
                : NA,
            ],
          ]}
        />
        <p className="text-xs text-slate-500">
          The stock figure is a snapshot on one day each term; the flow figure counts anyone EHE at
          any point across a full year, so it is structurally larger and lags the census file by a
          year. A chart never plots both on the same reconciled axis: see Stocks, Flows and
          Enforcement, which frames the flow figures as a labelled schematic, not a reconciliation of
          the census stock.
        </p>
      </Section>

      <Section title="Term is first-class: the sawtooth and the autumn-to-autumn rule">
        <p>
          The census is taken three times a year (Autumn, Spring, Summer). Counts, rates and
          percentages are <strong>never summed or averaged across terms</strong>: a figure is always
          one term-point, or a series of distinct term-points shown side by side. Within an academic
          year the count typically rises from Autumn to Spring to Summer, then falls each September
          as the school-age population re-bases; this is a feature of the collection design (a
          sawtooth), not evidence that children have stopped being electively home educated. For that
          reason every year-on-year comparison on this dashboard is <strong>autumn-to-autumn only</strong>
          , and where the full sawtooth is shown (the National view), the September resets are
          annotated so they cannot be misread as decline.
        </p>
        <p>
          The one exception to &ldquo;never sum&rdquo;: <strong>counts</strong> (never rates, never
          percentages) may be summed across local authorities within a single period (to build a
          regional or footprint total), or differenced between two adjacent stocks of the same
          geography, which gives a <em>net</em> change in the population, not a count of who started
          or left (that is what the separate flow file is for).
        </p>
      </Section>

      <Section title="Rates and percentages are as-published">
        <p>
          Every rate and percentage on this dashboard is taken directly from the published DfE figure
          and is never recomputed, summed, or averaged across geographies or terms; the arithmetic
          this dashboard performs on rates is limited to the population-weighted pooling described
          below, which is explicitly built from counts, not from averaging the published rates
          themselves. Rounding as published: local authority and regional counts to the nearest 10,
          national counts to the nearest 100, percentages to the nearest whole number, and rates to 1
          decimal place. Because of this, totals shown in the data may not sum exactly.
        </p>
      </Section>

      <Section title="Suppression: symbols preserved, never zero">
        <p>
          Every numeric cell in the underlying files can be a real value or a suppression symbol. A
          suppressed cell is stored as &ldquo;not available&rdquo; and keeps its symbol; it is never
          treated as, or silently rendered as, zero:
        </p>
        <Table
          head={['Symbol', 'Meaning']}
          rows={[
            ['low', metadata.suppression.low],
            ['x', metadata.suppression.x],
            ['z', metadata.suppression.z],
            ['(blank)', metadata.suppression.blank],
          ]}
        />
        <div className="flex items-center gap-3">
          <SuppressionSwatch />
          <p className="text-xs text-slate-500">
            The same hatch pattern marks a suppressed cell everywhere on the dashboard: gaps in line
            charts, hatched cells in the ranked tables, and hatched local authorities on the map.
            Aggregates built over a period with some cells suppressed carry an &ldquo;excludes
            suppressed small cells&rdquo; footnote rather than silently treating the missing cell as
            zero.
          </p>
        </div>
      </Section>

      <Section title="The rate denominator: two different populations, do not conflate">
        <p>
          The published <strong>rate per 100</strong> uses the ONS mid-year estimate of the resident 5
          to 16 population as its denominator. This dashboard never recomputes that rate; where a
          population figure is shown it is <strong>backed out</strong> from the published count and
          rate (<code>population = count / rate * 100</code>), so it inherits the rounding of the
          published rate (see the worked failure-mode example below).{' '}
          {englandPop != null && (
            <>
              For England in {latestCensusPeriod.term.toLowerCase()} {latestCensusPeriod.year} this
              gives a back-out population of about {formatCount(englandPop)}, consistent with the ONS
              5 to 16 estimate for England of roughly 8.4 million.
            </>
          )}
        </p>
        <p>
          A <strong>separate</strong> population basis, &ldquo;year groups Reception to 11&rdquo;, is
          used only as the base for the non-response uprating applied to national and regional totals
          (below). It is not the rate denominator and the two must not be conflated: one is a mid-year
          demographic estimate, the other is a school-year-group population used purely to gross up
          for local authorities that did not respond in a given term.
        </p>
      </Section>

      <Section title="Collection maturity and non-response uprating">
        <p>
          The census was a <strong>voluntary</strong> return for local authorities from autumn 2022,
          with response rates ranging from 93% to 100% of LAs by term, becoming a{' '}
          <strong>mandatory</strong> return from autumn 2024. National and regional totals are uprated
          to account for non-responding local authorities in the voluntary period, so part of the
          apparent rise in EHE numbers over this period is improved coverage of an existing
          population, an effect that cannot be separated from genuine growth in the published figures.
          This is the basis for badging the whole dashboard &ldquo;{OFFICIAL_STATS_BADGE}&rdquo;.
        </p>
        {nationalUnknownFirst != null && nationalUnknownLatest != null && (
          <p className="text-xs text-slate-500">
            One supporting signal: the national share of reasons recorded as &ldquo;Unknown&rdquo;
            fell from {formatPercent(nationalUnknownFirst)} to {formatPercent(nationalUnknownLatest)}{' '}
            across the autumns in this release, consistent with recording quality improving as the
            collection matured, not a change in why children are electively home educated.
          </p>
        )}
      </Section>

      <Section title="The footprint pooled rate: the maths, worked out">
        <p>
          The footprint pools Cornwall, Plymouth and Devon into one figure per period, from 2023/24
          Autumn onward ({footprintExcludedReason}, so no aggregate
          exists for that year). The pooled rate is <strong>population-weighted</strong>, built from
          the back-out identity, never a plain average of the three published rates:
        </p>
        <p className="rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
          pooled rate = sum(constituent counts) / sum(constituent back-out populations) x 100
        </p>
        {latestFootprint && (
          <>
            <Table
              head={['Constituent', 'Published rate', 'Count', 'Back-out population (count / rate x 100)']}
              rows={[
                ...constituentOrder.map((name) => {
                  const c = latestFootprint.constituents[name]
                  return [name, formatRate(c?.rate ?? null), formatCount(c?.count ?? null), formatCount(c?.pop ?? null)]
                }),
                [
                  <strong key="tot-label">Footprint total</strong>,
                  <strong key="tot-rate">{formatRate(latestFootprint.rate)}</strong>,
                  <strong key="tot-count">{formatCount(latestFootprint.count)}</strong>,
                  <strong key="tot-pop">{formatCount(latestFootprint.pop)}</strong>,
                ],
              ]}
            />
            <p>
              A naive mean of the three published rates for {latestFootprint.year} {latestFootprint.term}{' '}
              would give {latestNaive?.naiveMean != null ? formatRate(latestNaive.naiveMean, 2) : NA}, against
              the correct population-weighted pooled rate of {formatRate(latestFootprint.rate, 2)}: a
              difference of{' '}
              {latestNaive?.naiveMean != null
                ? formatSignedRate(latestFootprint.rate - latestNaive.naiveMean, 2)
                : NA}
              . The naive mean understates the pooled rate here because Devon and Cornwall (the two
              largest constituent populations) both sit above Plymouth&rsquo;s rate, so weighting by
              population, correctly, pulls the pooled figure toward them.
            </p>
            {naiveVsPooledBars.length > 0 && (
              <ChartCard
                title="Naive mean of LA rates vs the correct pooled rate"
                subtitle={`Footprint, ${latestFootprint.term.toLowerCase()} ${latestFootprint.year}`}
                downloadName="methodology-naive-vs-pooled"
                footnote="Illustrative only: the naive mean is shown to demonstrate why it is the wrong method, not as a figure used anywhere else on this dashboard."
              >
                <BarChart bars={naiveVsPooledBars} valueDp={2} labelWidth={260} />
              </ChartCard>
            )}
            {naiveMeanByPeriod && naiveMeanByPeriod.length > 1 && (
              <>
                <p className="text-xs text-slate-500">
                  This is not a one-off artefact of the latest period: the naive mean differs from the
                  correct pooled rate in every footprint period published so far.
                </p>
                <Table
                  head={['Period', 'Naive mean of LA rates', 'Correct pooled rate', 'Difference']}
                  rows={naiveMeanByPeriod.map((n) => [
                    `${n.period.term} ${n.period.year}`,
                    n.naiveMean != null ? formatRate(n.naiveMean, 2) : NA,
                    formatRate(n.pooled, 2),
                    n.naiveMean != null ? formatSignedRate(n.pooled - n.naiveMean, 2) : NA,
                  ])}
                />
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Failure mode: rate-rounding error on the back-out population">
        <p>
          Because published rates are rounded to 1 decimal place, the true rate behind any published
          figure lies somewhere in a band half a tenth wide either side of the printed value. Since
          the back-out population is inversely proportional to the rate, the relative error this
          introduces into the back-out population is approximately equal to the relative rounding
          error in the rate itself, about <code>0.05 / rate</code>. This is <strong>largest for the
          constituent with the lowest published rate</strong>, not the smallest count:
        </p>
        {sensitivityRows.length > 0 && (
          <Table
            head={['Constituent', 'Published rate', 'Implied population range', 'Approx. error on the back-out']}
            rows={sensitivityRows.map((r) => [
              r.name,
              formatRate(latestFootprint?.constituents[r.name]?.rate ?? null),
              r.popAtLow != null ? `${formatCount(Math.round(r.popAtHigh))} to ${formatCount(Math.round(r.popAtLow))}` : NA,
              r.halfRangePct != null ? `about ±${r.halfRangePct.toFixed(1)}%` : NA,
            ])}
          />
        )}
        {mostSensitive && (
          <p>
            At this release that is {mostSensitive.name}, whose published rate of{' '}
            {formatRate(latestFootprint?.constituents[mostSensitive.name]?.rate ?? null)} carries an
            implied back-out population range of about &plusmn;
            {mostSensitive.halfRangePct?.toFixed(1)}%, the largest of the three constituents. This is
            a property of 1 decimal-place rounding at a low rate, not a data-quality problem specific
            to that local authority.
          </p>
        )}
        {plymouthAutumns && plymouthAutumns.length > 1 && (
          <p className="text-xs text-slate-500">
            Mitigation: this rounding noise is independent from period to period, so a single-period
            change should be read cautiously. For example Plymouth&rsquo;s published autumn rate moved
            from {formatRate(plymouthAutumns[plymouthAutumns.length - 2]?.rate ?? null)} (
            {plymouthAutumns[plymouthAutumns.length - 2]?.year}) to{' '}
            {formatRate(plymouthAutumns[plymouthAutumns.length - 1]?.rate ?? null)} (
            {plymouthAutumns[plymouthAutumns.length - 1]?.year}): looking at the run of periods (as the
            Footprint view does) rather than reading a single delta in isolation reduces the chance of
            mistaking a rounding step for a change in trend.
          </p>
        )}
      </Section>

      <Section title="Reason data: what can and cannot honestly be said">
        <p>
          Above local-authority level, reason <strong>counts</strong> are suppressed; only{' '}
          <strong>percentages</strong> are usable at national and regional level. &ldquo;Unknown&rdquo;,
          &ldquo;No reason given&rdquo; and &ldquo;Other&rdquo; are data-quality categories, not
          substantive reasons, and are visually kept apart from the substantive families everywhere on
          the dashboard:
        </p>
        <div className="flex flex-wrap gap-3">
          {reasonFamilies.map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: REASON_FAMILY_COLORS[key] }}
                aria-hidden="true"
              />
              {label}
            </span>
          ))}
        </div>
        <p>
          The Reasons view also offers a <strong>renormalised &ldquo;% of known substantive
          reasons&rdquo;</strong> cut, which excludes Unknown, No reason given and Other and rescales
          the remaining reasons to sum to 100%. This is labelled approximate for two reasons: the
          inputs are already integer-rounded percentages, so re-summing them compounds rounding error,
          and small substantive categories that are themselves &ldquo;low&rdquo;-suppressed drop out of
          the renormalised sum entirely, which understates the true denominator rather than
          overstating it.
        </p>
        <p>
          At local-authority level, the suppression pattern that hides counts above LA level does not
          go away; it is different local authorities that are affected, and small substantive
          categories are frequently suppressed. For that reason this dashboard never claims a
          school-driven-versus-lifestyle split for the footprint at LA level: the suppression will not
          bear that distinction.
        </p>
        {unknownMin != null && unknownMax != null && (
          <p className="text-xs text-slate-500">
            Regional Unknown-reason shares vary widely, from {formatPercent(unknownMin)} to{' '}
            {formatPercent(unknownMax)} across the 10 regions in{' '}
            {latestReasonPeriod ? `${latestReasonPeriod.term.toLowerCase()} ${latestReasonPeriod.year}` : 'the latest term'}
            . Any cross-region comparison of a named substantive reason carries this caveat: a region
            with a lower Unknown share mechanically has more of its children sorted into named reasons,
            which can inflate a named reason&rsquo;s apparent share relative to a region that leaves
            more cases Unknown. This is a recording-practice effect, not evidence of a real difference
            in cause.
          </p>
        )}
      </Section>

      <Section title="Sex splits">
        <p>
          The published sex split includes an &ldquo;Unknown&rdquo; category; where this dashboard
          reports a two-way Female/Male split it says so as &ldquo;of those with known sex&rdquo; rather
          than silently dropping Unknown from the denominator. Sex-specific <strong>rates</strong> are
          not published at all (suppressed everywhere in the source), so only counts and percentages
          are shown for sex.
        </p>
      </Section>

      <Section title="Region rank claims">
        <p>
          There are {metadata.region_count} regions in the published geography, because London is
          split into Inner London and Outer London; there is no combined &ldquo;London&rdquo; row. Any
          claim that a region ranks first, or Nth, on this dashboard says so explicitly against a base
          of {metadata.region_count} ({metadata.regions.join(', ')}), and never against the 9-region
          convention used elsewhere in official statistics that combines London into one row.
        </p>
      </Section>

      <Section title="Structural suppression: what this data can never show">
        <p>
          Two figures are structurally unavailable in the published data and are never promised on
          this dashboard: national reason <strong>counts</strong> (only percentages are published at
          national level) and reason rates <strong>broken down by year group</strong> at any
          geography. Where a figure is not derivable this dashboard says so rather than approximating
          it from adjacent numbers.
        </p>
      </Section>

      <Section title="Refresh path">
        <p>
          The next release is expected winter 2026. Refreshing this dashboard means re-running the
          preprocessing pipeline against the newly published census and academic-year files; the
          underlying dataset identifiers (GUIDs) on the DfE Explore Education Statistics platform are
          resolved fresh from the data catalogue at each release rather than hard-coded, because they
          are not guaranteed stable release to release. Every anchor figure in the reconciliation test
          suite is re-checked against the new release before any view is trusted.
        </p>
      </Section>

      <Section title="Source, licence and build">
        <p>
          {metadata.source}, {metadata.release}. Published under the {metadata.licence} by the
          Department for Education. Read the release at{' '}
          <a href={metadata.source_url || DFE_RELEASE_URL} className="text-primary-700 underline" target="_blank" rel="noreferrer">
            {metadata.source_url || DFE_RELEASE_URL}
          </a>
          .
        </p>
        <p className="text-xs text-slate-400">
          Data build {formatBuildStamp(metadata.generated_at)}. Census file: {metadata.census.rows.toLocaleString('en-GB')}{' '}
          rows across {metadata.census.period_count} term-points ({metadata.census.periods[0]?.year} to{' '}
          {latestCensusPeriod.year}). Academic-year file: {metadata.academic_year.rows.toLocaleString('en-GB')} rows across{' '}
          {metadata.academic_year.years.length} years ({metadata.academic_year.years[0]} to{' '}
          {metadata.academic_year.years[metadata.academic_year.years.length - 1]}).{' '}
          {metadata.distinct_la_codes} distinct local authority codes, {metadata.distinct_la_names} names.
        </p>
      </Section>

      <div className="grid gap-3 md:grid-cols-3 print:hidden">
        <KpiCard
          label="England back-out population"
          value={englandPop != null ? formatCount(englandPop) : NA}
          accent="#475569"
          sub="Derived from count / rate x 100; the ONS mid-year 5-16 estimate is not itself published in this file"
        />
        <KpiCard
          label="Footprint pooled rate, latest period"
          value={latestFootprint ? formatRate(latestFootprint.rate) : NA}
          accent={getGeoColor('footprint')}
          sub="Population-weighted, never a mean of the three LA rates"
        />
        <KpiCard
          label="Local authority geography"
          value={`${metadata.distinct_la_codes} codes`}
          accent="#475569"
          sub={`${metadata.distinct_la_names} distinct names, ${metadata.region_count} regions`}
        />
      </div>
    </div>
  )
}

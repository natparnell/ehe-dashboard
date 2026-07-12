import { useEffect, useState, type ReactNode } from 'react'
import { Printer, ExternalLink, Lightbulb, AlertTriangle } from 'lucide-react'
import { loadProcessed } from '../../services/dataService'
import { DFE_RELEASE_URL, OFFICIAL_STATS_BADGE } from '../../constants'
import type { Cell } from '../../types'
import { ChartCard } from '../ChartCard'
import { KpiCard } from '../KpiCard'
import { LineChart, type LineSeries } from '../charts/LineChart'
import { BarChart, type Bar } from '../charts/BarChart'
import {
  formatCount,
  formatRate,
  formatPercent,
  formatSignedCount,
  formatSignedRate,
} from '../../utils/formatting'
import { getGeoColor, getReasonColor } from '../../utils/colors'

// ---------------------------------------------------------------------------
// Local data shapes (subset of scripts/DATA_SHAPES.md that this view consumes).
// The view loads headlines.json (primary), totals.json (the England termly
// sawtooth) and breakdowns.json (the "No reason given" share) via the
// dataService generic loader only.
// ---------------------------------------------------------------------------

interface PeriodLabel {
  key: string
  year: string
  term: string
}

interface AutumnPoint {
  period: PeriodLabel
  count: Cell
  rate: Cell
}

interface Headlines {
  england: { period: PeriodLabel; count: Cell; rate: Cell; popBackout: number | null }
  englandAutumnSeries: AutumnPoint[]
  sw: {
    period: PeriodLabel
    count: Cell
    rate: Cell
    rank: number
    ofRegions: number
    multipleVsEngland: number | null
    autumnRateSeries: AutumnPoint[]
  }
  footprint: {
    period: PeriodLabel
    count: number | null
    rate: number | null
    pop: number | null
    multipleVsEngland: number | null
    excessChildren: number | null
    constituents: {
      [name: string]: { code: string; count: number | null; rate: number | null; pop: number | null }
    } | null
    suppressed: string[]
    plymouthRateDoubled: {
      from: number
      to: number
      fromYear: string
      toYear: string
      multiple: number | null
    } | null
  }
  plymouthY10Y11: {
    period: PeriodLabel
    y10pct: number | null
    y11pct: number | null
    sharePct: number | null
    englandSharePct: number | null
  }
  reasonsShift: {
    period: PeriodLabel
    mentalHealthPct: number | null
    philosophicalPct: number | null
    unknownPct: number | null
    mentalHealthSeries: { period: string; pct: Cell }[]
    philosophicalSeries: { period: string; pct: Cell }[]
  }
  sex: {
    period: PeriodLabel
    female: { count: Cell; pct: Cell }
    male: { count: Cell; pct: Cell }
  }
  yearGroups: {
    period: PeriodLabel
    y10Count: number | null
    y11Count: number | null
    y10y11Share: number | null
  }
  flows: {
    year: string | null
    prevYear: string | null
    anytime: number | null
    anytimePrev: number | null
    starts: number | null
    returns: number | null
    leave: number | null
    s437: number | null
    saoIssued: number | null
    saoRevoked: number | null
  }
  source: string
  caveats: { footprintProxy: string; collectionMaturity: string; stockVsFlow: string }
}

interface TotalsPeriod {
  key: string
  year: string
  term: 'Autumn' | 'Spring' | 'Summer'
  sort: number
}

interface TotalsGeography {
  level: string
  code: string
  name: string
  series: {
    [periodKey: string]: { count: Cell; rate: Cell; percent: Cell; pop: number | null }
  }
}

interface Totals {
  periods: TotalsPeriod[]
  geographies: TotalsGeography[]
}

interface BreakdownRecord {
  level: string
  code: string
  name: string
  topic: string
  breakdown: string
  series: { [periodKey: string]: { count: Cell; percent: Cell } }
}

interface Breakdowns {
  records: BreakdownRecord[]
}

// ---------------------------------------------------------------------------
// View-local helpers
// ---------------------------------------------------------------------------

const ENGLAND_CODE = 'E92000001'

// Abbreviate a term + academic-year into a compact axis tick, e.g. "Aut 22".
function termTick(term: string, year: string): string {
  const t = term.startsWith('Aut') ? 'Aut' : term.startsWith('Spr') ? 'Spr' : 'Sum'
  const yy = year.slice(0, 2) === '20' ? year.slice(2, 4) : year.slice(0, 2)
  return `${t} ${yy}`
}

// The narrative colour used for the mental-health / philosophical reason lines.
const MENTAL_HEALTH_COLOR = getReasonColor('Mental health')
const PHILOSOPHICAL_COLOR = getReasonColor('Philosophical or preferential')

function Finding({
  n,
  title,
  children,
}: {
  n: string
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3 print:break-inside-avoid">
      <div className="flex items-baseline gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
          {n}
        </span>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
      </div>
      {children}
    </section>
  )
}

// A short caveat strip rendered under each finding: the methodology honesty is
// part of the deliverable, not optional polish (spec section 4).
function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

function Prose({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-slate-600">{children}</p>
}

// A plain figure tile used inside a finding (distinct from the top KPI row).
function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div
      className="rounded-md border border-slate-200 bg-white px-3 py-2"
      style={accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : undefined}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------

export function HeadlinesView() {
  const [h, setH] = useState<Headlines | null>(null)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [breakdowns, setBreakdowns] = useState<Breakdowns | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([
      loadProcessed<Headlines>('headlines.json'),
      loadProcessed<Totals>('totals.json'),
      loadProcessed<Breakdowns>('breakdowns.json'),
    ]).then(([hl, tt, bd]) => {
      if (!alive) return
      setH(hl)
      setTotals(tt)
      setBreakdowns(bd)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!loaded) {
    return <div className="p-8 text-sm text-slate-500">Loading the headline figures...</div>
  }
  if (!h) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
        The headline data is not available. Run <code>npm run preprocess</code> to generate it.
      </div>
    )
  }

  const eng = h.england
  const engYear = eng.period.year
  // Autumn-to-autumn delta (spec 4.4: cross-year comparisons at unlike terms are
  // forbidden; the whole autumn series is autumn-only).
  const engAutumn = h.englandAutumnSeries
  const engPrev = engAutumn.length >= 2 ? engAutumn[engAutumn.length - 2] : null
  const countDelta =
    eng.count.v != null && engPrev?.count.v != null ? eng.count.v - engPrev.count.v : null
  const rateDelta =
    eng.rate.v != null && engPrev?.rate.v != null ? eng.rate.v - engPrev.rate.v : null

  // The England termly sawtooth (all 10 term-points) from totals.json; falls
  // back to the four-autumn count line if totals is unavailable.
  const engGeo = totals?.geographies.find((g) => g.code === ENGLAND_CODE) ?? null
  const sawtoothPeriods = totals ? [...totals.periods].sort((a, b) => a.sort - b.sort) : []
  const sawtoothData = engGeo
    ? sawtoothPeriods.map((p, i) => ({ x: i, y: engGeo.series[p.key]?.count.v ?? null }))
    : engAutumn.map((p, i) => ({ x: i, y: p.count.v }))
  const sawtoothTick = (x: number): string => {
    if (engGeo) {
      const p = sawtoothPeriods[x]
      return p ? termTick(p.term, p.year) : ''
    }
    const p = engAutumn[x]
    return p ? `Aut ${p.period.year.slice(2, 4)}` : ''
  }
  const sawtoothSeries: LineSeries[] = [
    { id: 'England', role: 'england', width: 2.5, data: sawtoothData },
  ]

  // South West vs England, autumn rate series (spec 4.2: as-published rates,
  // autumn-to-autumn only).
  const swSeries = h.sw.autumnRateSeries
  const swVsEngland: LineSeries[] = [
    {
      id: 'South West',
      role: 'southWest',
      width: 2.5,
      data: swSeries.map((p, i) => ({ x: i, y: p.rate.v })),
    },
    {
      id: 'England',
      role: 'england',
      dashed: true,
      data: engAutumn.map((p, i) => ({ x: i, y: p.rate.v })),
    },
  ]
  const swAutumnTick = (x: number): string => {
    const p = swSeries[x] ?? engAutumn[x]
    return p ? `Aut ${p.period.year.slice(2, 4)}` : ''
  }

  // Footprint constituents rate bars vs the England datum (spec 4.3: pooled rate
  // is population-weighted, shown alongside the constituent LA rates, never a
  // mean of LA rates).
  const fp = h.footprint
  const con = fp.constituents
  const footprintBars: Bar[] = [
    con?.Cornwall
      ? ({ id: 'cornwall', label: 'Cornwall', value: con.Cornwall.rate, role: 'cornwall' } as Bar)
      : null,
    con?.Devon ? ({ id: 'devon', label: 'Devon', value: con.Devon.rate, role: 'devon' } as Bar) : null,
    con?.Plymouth
      ? ({ id: 'plymouth', label: 'Plymouth', value: con.Plymouth.rate, role: 'plymouth' } as Bar)
      : null,
    {
      id: 'footprint',
      label: 'Footprint (pooled)',
      value: fp.rate,
      role: 'footprint',
      highlight: true,
    } as Bar,
  ].filter((b): b is Bar => b !== null)

  // Plymouth Year 10 + 11 share vs England (spec: the GCSE-phase signal).
  const py = h.plymouthY10Y11
  const y10y11Bars: Bar[] = [
    { id: 'plymouth', label: 'Plymouth', value: py.sharePct, role: 'plymouth', highlight: true },
    { id: 'england', label: 'England', value: py.englandSharePct, role: 'england' },
  ]

  // Reasons crossover: mental health overtaking philosophical / preferential
  // (spec 4.8: reason percentages, data-quality reasons set apart).
  const rs = h.reasonsShift
  const reasonYears = rs.mentalHealthSeries.map((p) => p.period)
  const reasonSeries: LineSeries[] = [
    {
      id: 'Mental health',
      role: 'other',
      color: MENTAL_HEALTH_COLOR,
      width: 2.5,
      data: rs.mentalHealthSeries.map((p, i) => ({ x: i, y: p.pct.v })),
    },
    {
      id: 'Philosophical or preferential',
      role: 'other',
      color: PHILOSOPHICAL_COLOR,
      width: 2.5,
      data: rs.philosophicalSeries.map((p, i) => ({ x: i, y: p.pct.v })),
    },
  ]
  const reasonTick = (x: number): string => reasonYears[x] ?? ''

  // "No substantive reason" share: Unknown + No reason given for England, latest
  // autumn (spec 4.8 honesty). Read from breakdowns.json where available.
  const latestKey = rs.period.key
  const noReasonGiven = breakdowns?.records.find(
    (r) => r.code === ENGLAND_CODE && r.topic === 'Reason' && r.breakdown === 'No reason given',
  )?.series[latestKey]?.percent.v
  const noSubstantivePct =
    rs.unknownPct != null && noReasonGiven != null ? rs.unknownPct + noReasonGiven : rs.unknownPct

  const flows = h.flows

  return (
    <div className="max-w-5xl space-y-6">
      {/* Print action */}
      <div className="flex justify-end print:hidden">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Printer size={15} aria-hidden="true" />
          Print
        </button>
      </div>

      {/* The short version */}
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <div className="flex items-center gap-2 text-sky-900">
          <Lightbulb size={18} aria-hidden="true" />
          <h2 className="text-sm font-semibold">The short version</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-sky-900">
          Elective home education (EHE) is rising across England, and it is rising fastest in the
          South West. On the {engYear} autumn census {formatCount(eng.count.v)} children were being
          educated at home, {formatRate(eng.rate.v)} in every 100. The South West has the highest
          rate of any English region, and the WeST footprint (Cornwall, Plymouth and Devon) sits
          higher still. The figures below are single census-date snapshots; rising EHE is presented
          as a neutral fact, not a good or bad outcome.
        </p>
        <a
          href={DFE_RELEASE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 underline hover:text-sky-900"
        >
          <ExternalLink size={14} aria-hidden="true" />
          View the full DfE release
        </a>
      </div>

      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label={`England, autumn ${engYear}`}
          value={formatCount(eng.count.v)}
          accent={getGeoColor('england')}
          delta={
            countDelta != null ? `${formatSignedCount(countDelta)} vs autumn ${engPrev?.period.year}` : undefined
          }
          sub={`${formatRate(eng.rate.v)} per 100 children`}
        />
        <KpiCard
          label={`South West, autumn ${engYear}`}
          value={`${formatRate(h.sw.rate.v)} per 100`}
          accent={getGeoColor('southWest')}
          sub={`Rank ${h.sw.rank} of ${h.sw.ofRegions} regions${h.sw.multipleVsEngland != null ? ` · ${h.sw.multipleVsEngland.toFixed(2)}x England` : ''}`}
        />
        <KpiCard
          label={`WeST footprint, autumn ${engYear}`}
          value={formatCount(fp.count)}
          accent={getGeoColor('footprint')}
          sub={`${fp.rate != null ? `${formatRate(fp.rate)} per 100` : 'n/a'}${fp.multipleVsEngland != null ? ` · ${fp.multipleVsEngland.toFixed(2)}x England` : ''} · LA-area proxy`}
        />
        <KpiCard
          label={`Plymouth Years 10 to 11, autumn ${engYear}`}
          value={formatPercent(py.sharePct)}
          accent={getGeoColor('plymouth')}
          sub={`England ${formatPercent(py.englandSharePct)} · the GCSE-phase signal`}
        />
        <KpiCard
          label={`Mental health reason, autumn ${engYear}`}
          value={formatPercent(rs.mentalHealthPct)}
          accent={MENTAL_HEALTH_COLOR}
          sub={`Now above philosophical or preferential ${formatPercent(rs.philosophicalPct)}`}
        />
        <KpiCard
          label={`EHE at any point, ${flows.year ?? 'latest year'}`}
          value={formatCount(flows.anytime)}
          accent="#475569"
          sub="Annual flow, a different measure from the census stock"
        />
      </div>

      {/* Finding (a) */}
      <Finding n="a" title="EHE keeps climbing: 126,000 children in England">
        <Prose>
          On the {engYear} autumn census {formatCount(eng.count.v)} children were electively home
          educated in England, {formatRate(eng.rate.v)} per 100. Across the four autumn censuses the
          count has risen {formatCount(engAutumn[0]?.count.v)} to {formatCount(eng.count.v)} and the
          rate {formatRate(engAutumn[0]?.rate.v)} to {formatRate(eng.rate.v)}
          {countDelta != null && (
            <>
              {' '}
              ({formatSignedCount(countDelta)}
              {rateDelta != null ? `, ${formatSignedRate(rateDelta)} on the rate` : ''} on the latest
              autumn-to-autumn step)
            </>
          )}
          . The census is a termly stock, so within each academic year the count builds and then
          resets every September; the sawtooth below shows that rhythm.
        </Prose>
        <ChartCard
          title="England EHE, every census term-point"
          subtitle={`Census-date count per term · ${sawtoothPeriods[0] ? `${sawtoothPeriods[0].year} to ${engYear}` : engYear}`}
          downloadName="headlines-england-sawtooth"
          legend={[{ role: 'england', label: 'England', dashed: false }]}
          footnote="Each September the census resets, so a term-to-term fall is the new-year reset, not a decline. Compare like term with like term (autumn to autumn). National counts are rounded to the nearest 100."
        >
          <LineChart
            series={sawtoothSeries}
            height={260}
            yLabel="children (count)"
            xTickLabel={sawtoothTick}
            valueFormat={(v) => (v == null ? 'n/a' : formatCount(Math.round(v)))}
          />
        </ChartCard>
        <Caveat>
          These are official statistics in development. The collection was voluntary from autumn 2022
          (93 to 100% local-authority response, national and regional figures uprated for
          non-response) and mandatory only from autumn 2024, so part of the apparent growth is
          improving coverage rather than more children.
        </Caveat>
      </Finding>

      {/* Finding (b) */}
      <Finding n="b" title="Stock and flow are different measures: 175,900 pass through in a year">
        <Prose>
          The {formatCount(eng.count.v)} figure is a single census-date snapshot (a stock). Over the
          whole of {flows.year} a much larger {formatCount(flows.anytime)} children were electively
          home educated at some point (a flow), up from {formatCount(flows.anytimePrev)} the year
          before, with {formatCount(flows.starts)} starting and {formatCount(flows.returns)} returning
          to school. The two measures are never added together or reconciled to each other.
        </Prose>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={`Census stock, autumn ${engYear}`}
            value={formatCount(eng.count.v)}
            sub="Termly snapshot"
            accent={getGeoColor('england')}
          />
          <Stat
            label={`At any point, ${flows.year}`}
            value={formatCount(flows.anytime)}
            sub={`From ${formatCount(flows.anytimePrev)} in ${flows.prevYear}`}
            accent="#475569"
          />
          <Stat label={`Starts, ${flows.year}`} value={formatCount(flows.starts)} sub="Into EHE" />
          <Stat
            label={`Returns, ${flows.year}`}
            value={formatCount(flows.returns)}
            sub="Back to school"
          />
        </div>
        <Caveat>
          Census-date stock (termly) and at-any-point flow (annual, one year behind the census) are
          different measures. They are labelled separately and never arithmetically reconciled to
          each other.
        </Caveat>
      </Finding>

      {/* Finding (c) */}
      <Finding n="c" title="The South West is the highest-rate region, every term">
        <Prose>
          The South West records {formatRate(h.sw.rate.v)} per 100 on the {engYear} autumn census,
          rank {h.sw.rank} of {h.sw.ofRegions} regions
          {h.sw.multipleVsEngland != null ? `, about ${h.sw.multipleVsEngland.toFixed(2)} times the England rate` : ''}. It
          has been the highest-rate region in every term since the collection began, and it has grown
          in step with England rather than pulling away: a persistently higher level, not faster
          growth.
        </Prose>
        <ChartCard
          title="South West vs England, autumn rate"
          subtitle="Rate per 100 children, autumn censuses (like term with like term)"
          downloadName="headlines-sw-vs-england"
          legend={[
            { role: 'southWest', label: 'South West' },
            { role: 'england', label: 'England', dashed: true },
          ]}
          footnote="Rates are as published and never averaged across regions or terms. The gap is a difference in level."
        >
          <LineChart
            series={swVsEngland}
            height={240}
            yMin="auto"
            yLabel="rate per 100"
            xTickLabel={swAutumnTick}
            valueFormat={(v) => (v == null ? 'n/a' : formatRate(v))}
          />
        </ChartCard>
        <Caveat>
          Region rank is 1 of {h.sw.ofRegions}. There are 10 regions because London is split into
          Inner London and Outer London in this collection; there is no single "London" row.
        </Caveat>
      </Finding>

      {/* Finding (d) */}
      <Finding n="d" title="The WeST footprint sits well above England">
        <Prose>
          Pooling Cornwall, Plymouth and Devon gives {formatCount(fp.count)} children on the{' '}
          {engYear} autumn census, a pooled rate of {fp.rate != null ? formatRate(fp.rate) : 'n/a'}{' '}
          per 100
          {fp.multipleVsEngland != null ? ` (about ${fp.multipleVsEngland.toFixed(2)} times England)` : ''}. The
          pooled rate is population-weighted from the constituent counts, not an average of the three
          LA rates.
          {fp.plymouthRateDoubled && (
            <>
              {' '}
              Plymouth's rate has doubled, from {formatRate(fp.plymouthRateDoubled.from)} in{' '}
              {fp.plymouthRateDoubled.fromYear} to {formatRate(fp.plymouthRateDoubled.to)} in{' '}
              {fp.plymouthRateDoubled.toYear}.
            </>
          )}
        </Prose>
        <ChartCard
          title="Footprint LAs and the pooled rate vs England"
          subtitle={`Rate per 100 children, autumn ${engYear}`}
          downloadName="headlines-footprint-rates"
          footnote="The pooled footprint rate is sum(count) / sum(back-out population) x 100, not a mean of LA rates. The England datum is the dashed reference."
        >
          <BarChart
            bars={footprintBars}
            valueSuffix=""
            valueDp={1}
            refLines={
              eng.rate.v != null
                ? [{ value: eng.rate.v, label: 'England', color: getGeoColor('england') }]
                : []
            }
          />
        </ChartCard>
        <Caveat>{h.caveats.footprintProxy}</Caveat>
      </Finding>

      {/* Finding (e) */}
      <Finding n="e" title="Plymouth's EHE is concentrated in the GCSE years">
        <Prose>
          In Plymouth, Years 10 and 11 make up {formatPercent(py.sharePct)} of home-educated children
          (Year 10 {formatPercent(py.y10pct)} plus Year 11 {formatPercent(py.y11pct)}) against{' '}
          {formatPercent(py.englandSharePct)} nationally. That GCSE-phase concentration is the signal
          worth watching: it points at exam-year pressures rather than a whole-childhood choice.
        </Prose>
        <ChartCard
          title="Years 10 and 11 as a share of EHE"
          subtitle={`Plymouth vs England, autumn ${engYear}`}
          downloadName="headlines-plymouth-y10-11"
          footnote="Year-group shares are as published. The Year 11 September age-out interacts with the census sawtooth."
        >
          <BarChart bars={y10y11Bars} valueSuffix="%" valueDp={0} labelWidth={110} />
        </ChartCard>
        <Caveat>{h.caveats.footprintProxy}</Caveat>
      </Finding>

      {/* Finding (f) */}
      <Finding n="f" title="Mental health has overtaken philosophical or preferential reasons">
        <Prose>
          Nationally, mental health is now the reason given for {formatPercent(rs.mentalHealthPct)} of
          home-educated children, above philosophical or preferential at {formatPercent(rs.philosophicalPct)}.
          Four autumns ago the order was reversed ({formatPercent(rs.mentalHealthSeries[0]?.pct.v)} vs{' '}
          {formatPercent(rs.philosophicalSeries[0]?.pct.v)}). But reason data is the weakest part of
          the collection: around {formatPercent(noSubstantivePct)} of records give no substantive
          reason (Unknown{noReasonGiven != null ? ' plus No reason given' : ''}).
        </Prose>
        <ChartCard
          title="Reason crossover: mental health vs philosophical or preferential"
          subtitle="Percentage of home-educated children, autumn censuses"
          downloadName="headlines-reason-crossover"
          legend={[
            { color: MENTAL_HEALTH_COLOR, label: 'Mental health' },
            { color: PHILOSOPHICAL_COLOR, label: 'Philosophical or preferential' },
          ]}
          footnote="Reason percentages are as published (counts are suppressed above LA level). Unknown and No reason given are data quality, not substantive reasons; the falling Unknown share partly reflects better recording, not only real change."
        >
          <LineChart
            series={reasonSeries}
            height={240}
            yMin="auto"
            yLabel="% of EHE children"
            valueSuffix="%"
            xTickLabel={reasonTick}
            valueFormat={(v) => (v == null ? 'n/a' : formatPercent(v))}
          />
        </ChartCard>
        <Caveat>
          Above LA level, reason counts are suppressed, so only percentages are shown. Around 3 in 10
          records carry no substantive reason, and the mix cannot support a school-driven versus
          lifestyle split, especially at LA level.
        </Caveat>
      </Finding>

      {/* Standing caveats + badge */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-500">
        <div className="mb-1 font-semibold text-slate-600">Reading this honestly</div>
        <ul className="list-inside list-disc space-y-1">
          <li>
            Term is treated as first-class: every figure is a single census term-point, and counts,
            rates and percentages are never summed or averaged across terms. Year-on-year comparisons
            are autumn-to-autumn only.
          </li>
          <li>{h.caveats.collectionMaturity}</li>
          <li>{h.caveats.footprintProxy}</li>
          <li>{h.caveats.stockVsFlow}</li>
        </ul>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-2">
          <span className="text-slate-400">{h.source}</span>
          <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold uppercase tracking-wide text-slate-600">
            {OFFICIAL_STATS_BADGE}
          </span>
        </div>
      </div>
    </div>
  )
}

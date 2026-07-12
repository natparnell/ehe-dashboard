import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeftRight, ArrowRightToLine, ArrowLeftFromLine, Info } from 'lucide-react'
import { ChartCard } from '../ChartCard'
import { KpiCard } from '../KpiCard'
import { BarChart, type Bar } from '../charts/BarChart'
import { LineChart, type LineSeries } from '../charts/LineChart'
import { loadProcessed } from '../../services/dataService'
import { getGeoColor, type GeoRole } from '../../utils/colors'
import {
  formatCount,
  formatSignedCount,
  formatCell,
  formatRate,
  FLAG_MEANING,
  NA,
} from '../../utils/formatting'
import type { Cell } from '../../types'

// FlowsView (spec 5.6): Stocks, Flows and Enforcement. Everything on this page
// is the ANNUAL at-any-point / flows collection (ehe_academic_year.csv), which
// is one year behind the termly census. The two measures are never reconciled
// to each other (hard rule 5): the census-date stock is a termly snapshot, the
// at-any-point count captures every child who was EHE at any moment in the year.
// This file is owned solely by the flows view agent; no shared files are edited.

// ----- local data shapes (scripts/DATA_SHAPES.md, files 5 and 7) -----------
interface FlowYear {
  key: string
  label: string
}
interface FlowRecord {
  level: 'National' | 'Regional' | 'Local authority'
  code: string
  name: string
  region_code: string | null
  series: { [yearKey: string]: { [measure: string]: Cell } }
}
interface Flows {
  years: FlowYear[]
  measures: string[]
  records: FlowRecord[]
  priorSchoolTypeNational: {
    order: string[]
    series: { [yearKey: string]: { [typeLabel: string]: { count: Cell; pct: Cell } } }
  }
}
interface HeadlinesSubset {
  england?: { period?: { year?: string; term?: string }; count?: Cell; rate?: Cell }
  caveats?: { footprintProxy?: string; collectionMaturity?: string; stockVsFlow?: string }
}

// ----- fixed geography roles for the footprint contrast --------------------
const LA_ROLE: Record<string, GeoRole> = {
  E06000052: 'cornwall',
  E06000026: 'plymouth',
  E10000008: 'devon',
}
const FOOTPRINT_CODES = new Set(['E06000052', 'E06000026', 'E10000008'])

// Measures in display order, with a fixed colour per measure (these are all
// England national series, so colour encodes the MEASURE, not a geography).
const FLOW_MEASURE_LABEL: Record<string, string> = {
  anytime: 'EHE at any point',
  starts: 'Starts',
  returns: 'Returns to school',
  leave: 'Left EHE (other)',
}
const FLOW_MEASURE_COLOR: Record<string, string> = {
  anytime: '#475569', // slate
  starts: '#1d4ed8', // blue
  returns: '#0d9488', // teal
  leave: '#94a3b8', // grey
}
const ENF_MEASURE_LABEL: Record<string, string> = {
  s437: 'Section 437 notices',
  sao_issued: 'School attendance orders issued',
  sao_revoked: 'Orders revoked',
}
const ENF_MEASURE_COLOR: Record<string, string> = {
  s437: '#9C27B0', // purple (enforcement family)
  sao_issued: '#7E57C2',
  sao_revoked: '#94a3b8',
}

function cellV(c: Cell | undefined): number | null {
  return c && c.v != null ? c.v : null
}

// The "official statistics in development" badge (spec 4.10).
function DevBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
      Official statistics in development
    </span>
  )
}

// A caveat panel with an info glyph, reused for the several mandatory notes.
function Caveat({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 print:break-inside-avoid">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      <div>
        <span className="font-semibold text-slate-700">{title}. </span>
        {children}
      </div>
    </div>
  )
}

export function FlowsView() {
  const [flows, setFlows] = useState<Flows | null>(null)
  const [headlines, setHeadlines] = useState<HeadlinesSubset | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void Promise.all([
      loadProcessed<Flows>('flows.json'),
      loadProcessed<HeadlinesSubset>('headlines.json'),
    ]).then(([f, h]) => {
      if (!live) return
      setFlows(f)
      setHeadlines(h)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [])

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
        Loading flows data...
      </div>
    )
  }
  if (!flows) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
        Flows data is unavailable. Run the preprocess step to generate
        <code className="mx-1 rounded bg-slate-100 px-1">public/processed/flows.json</code>.
      </div>
    )
  }

  const years = flows.years
  const latest = years[years.length - 1]
  const prev = years[years.length - 2]
  const national = flows.records.find((r) => r.level === 'National')
  const laRecords = flows.records.filter((r) => r.level === 'Local authority')

  const natLatest = national?.series[latest.key] ?? {}
  const natPrev = prev ? (national?.series[prev.key] ?? {}) : {}

  const val = (m: string, s: { [k: string]: Cell }): number | null => cellV(s[m])
  const delta = (m: string): number | null => {
    const a = val(m, natLatest)
    const b = val(m, natPrev)
    return a != null && b != null ? a - b : null
  }

  // Census-date stock (a DIFFERENT measure and year) for the stock-vs-flow
  // contrast tile. Never arithmetically combined with the flow figures.
  const censusCount = headlines?.england?.count ?? null
  const censusRate = headlines?.england?.rate ?? null
  const censusPeriod = headlines?.england?.period
  const censusLabel = censusPeriod
    ? `${censusPeriod.term ?? ''} ${censusPeriod.year ?? ''}`.trim()
    : 'latest autumn'

  const anytime = val('anytime', natLatest)
  const starts = val('starts', natLatest)
  const returns = val('returns', natLatest)
  const leave = val('leave', natLatest)

  // National flows trend: one line per measure, x = year index.
  const flowLineSeries: LineSeries[] = (['anytime', 'starts', 'returns', 'leave'] as const).map(
    (m) => ({
      id: FLOW_MEASURE_LABEL[m],
      role: 'england' as GeoRole,
      color: FLOW_MEASURE_COLOR[m],
      dashed: false,
      width: m === 'anytime' ? 3 : 2,
      data: years.map((y, i) => ({ x: i, y: val(m, national?.series[y.key] ?? {}) })),
    }),
  )

  // Enforcement trend: s437 / SAO issued / SAO revoked over the four years.
  const enfLineSeries: LineSeries[] = (['s437', 'sao_issued', 'sao_revoked'] as const).map((m) => ({
    id: ENF_MEASURE_LABEL[m],
    role: 'england' as GeoRole,
    color: ENF_MEASURE_COLOR[m],
    width: m === 's437' ? 3 : 2,
    data: years.map((y, i) => ({ x: i, y: val(m, national?.series[y.key] ?? {}) })),
  }))

  const yearTick = (x: number): string => years[Math.round(x)]?.label ?? ''

  // Footprint enforcement contrast: section 437 notices per 1,000 EHE children
  // (spec 5.6). Only computed where both cells are live; suppressed inputs give
  // an n/a bar, never a spurious zero.
  const enfBars: Bar[] = laRecords
    .map((r) => {
      const s = r.series[latest.key] ?? {}
      const notices = cellV(s.s437)
      const pool = cellV(s.anytime)
      const per1000 = notices != null && pool != null && pool > 0 ? (notices / pool) * 1000 : null
      const role = LA_ROLE[r.code]
      return {
        id: r.code,
        label: r.name,
        value: per1000,
        color: role ? getGeoColor(role) : getGeoColor('benchmark'),
        highlight: FOOTPRINT_CODES.has(r.code),
      }
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))

  // Raw enforcement table rows (footprint LAs + peninsula benchmarks), showing
  // suppression symbols as published.
  const enfRows = laRecords
    .map((r) => {
      const s = r.series[latest.key] ?? {}
      return {
        code: r.code,
        name: r.name,
        footprint: FOOTPRINT_CODES.has(r.code),
        anytime: s.anytime,
        s437: s.s437,
        sao_issued: s.sao_issued,
        sao_revoked: s.sao_revoked,
      }
    })
    .sort((a, b) => (cellV(b.anytime) ?? -1) - (cellV(a.anytime) ?? -1))

  // Prior-school-type mix (national, latest year): ranked by percentage.
  const pst = flows.priorSchoolTypeNational
  const pstLatest = pst.series[latest.key] ?? {}
  const pstBars: Bar[] = pst.order
    .map((t) => ({
      id: t,
      label: t,
      value: cellV(pstLatest[t]?.pct),
      color: '#64748b',
    }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))

  const stockVsFlowCaveat =
    headlines?.caveats?.stockVsFlow ??
    'The census-date stock and the at-any-point count are different measures and are never added, subtracted or reconciled to each other. The census counts children electively home educated on a single day each term; the at-any-point count captures every child who was EHE at any moment across the whole academic year, so it is always the larger of the two.'
  const maturityCaveat =
    headlines?.caveats?.collectionMaturity ??
    'The collection was voluntary from autumn 2022 (93 to 100 per cent response) and mandatory from autumn 2024. National figures are uprated for non-response, so part of the apparent growth reflects improving coverage rather than a real rise. Treat all trends as official statistics in development.'
  const footprintCaveat =
    headlines?.caveats?.footprintProxy ??
    'Footprint figures are LA-area children (Cornwall, Plymouth and Devon), not WeST pupils. The trust draws from these areas but the two populations are not the same.'

  return (
    <div className="space-y-6">
      {/* ---- header ---- */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6 text-slate-700" aria-hidden="true" />
            <h1 className="text-xl font-bold text-slate-900">Stocks, Flows and Enforcement</h1>
          </div>
          <DevBadge />
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
          Everything on this page comes from the annual academic-year collection, which measures how
          many children were electively home educated at any point across a full year and how many
          moved in and out. It is one year behind the termly census, so the latest year here is{' '}
          <span className="font-semibold text-slate-800">{latest.label}</span>, not the census-date{' '}
          {censusLabel}. The two are different measures and are never reconciled to each other.
        </p>
      </header>

      {/* ---- stock vs flow: two measures, side by side, explicitly distinct ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Two different measures
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <KpiCard
            label={`Census-date stock, ${censusLabel}`}
            value={formatCell(censusCount ?? undefined)}
            accent="#0d9488"
            sub={
              <>
                On a single day: {formatCell(censusRate ?? undefined, formatRate)} per 100 children
                aged 5 to 16. A termly snapshot.
              </>
            }
          />
          <KpiCard
            label={`At any point in the year, ${latest.label}`}
            value={formatCount(anytime)}
            accent="#475569"
            delta={`${formatSignedCount(delta('anytime'))} vs ${prev?.label ?? ''}`}
            sub="Every child EHE at any moment across the whole year. Always larger than the census snapshot."
          />
        </div>
        <Caveat title="Stock is not flow">{stockVsFlowCaveat}</Caveat>
      </section>

      {/* ---- flow schematic ---- */}
      <ChartCard
        title="How the at-any-point pool relates to flows (schematic)"
        subtitle={`National, ${latest.label} academic year`}
        downloadName={`ehe-flow-schematic-${latest.key}`}
        footnote={
          <>
            Schematic only, not an arithmetic reconciliation. The at-any-point pool includes children
            continuing from before plus new starts during the year; some returned to school and some
            left EHE for other reasons. These flows are never added to or subtracted from the
            census-date stock, which is a separate measure (see above).
          </>
        }
      >
        <div className="flex flex-col items-stretch gap-3 py-2 md:flex-row md:items-center">
          <div className="flex-1 rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              <ArrowRightToLine className="h-3.5 w-3.5" aria-hidden="true" /> Flowed in
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">{formatCount(starts)}</div>
            <div className="text-[11px] text-slate-500">new starts</div>
          </div>
          <div className="flex-[1.4] rounded-lg border-2 border-slate-300 bg-slate-50 p-3 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              EHE at any point, {latest.label}
            </div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{formatCount(anytime)}</div>
            <div className="text-[11px] text-slate-500">the annual pool</div>
          </div>
          <div className="flex-1 rounded-lg border border-teal-200 bg-teal-50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-teal-700">
              <ArrowLeftFromLine className="h-3.5 w-3.5" aria-hidden="true" /> Flowed out
            </div>
            <div className="mt-1 text-sm font-bold text-slate-900">
              {formatCount(returns)}{' '}
              <span className="text-[11px] font-normal text-slate-500">returned to school</span>
            </div>
            <div className="mt-0.5 text-sm font-bold text-slate-900">
              {formatCount(leave)}{' '}
              <span className="text-[11px] font-normal text-slate-500">left EHE (other)</span>
            </div>
          </div>
        </div>
      </ChartCard>

      {/* ---- national flow KPIs ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          National flows, {latest.label}{' '}
          <span className="font-normal normal-case text-slate-400">
            (change vs {prev?.label ?? 'prior year'})
          </span>
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Starts in year"
            value={formatCount(starts)}
            accent={FLOW_MEASURE_COLOR.starts}
            delta={formatSignedCount(delta('starts'))}
            sub="children moving into EHE"
          />
          <KpiCard
            label="Returns to school"
            value={formatCount(returns)}
            accent={FLOW_MEASURE_COLOR.returns}
            delta={formatSignedCount(delta('returns'))}
            sub="children moving back into school"
          />
          <KpiCard
            label="Left EHE (other)"
            value={formatCount(leave)}
            accent={FLOW_MEASURE_COLOR.leave}
            delta={formatSignedCount(delta('leave'))}
            sub="moved away, aged out or other"
          />
          <KpiCard
            label="At any point"
            value={formatCount(anytime)}
            accent={FLOW_MEASURE_COLOR.anytime}
            delta={formatSignedCount(delta('anytime'))}
            sub="the annual pool"
          />
        </div>
      </section>

      {/* ---- national flows trend ---- */}
      <ChartCard
        title="National flows trend"
        subtitle={`England, ${years[0]?.label} to ${latest.label} (annual)`}
        downloadName="ehe-national-flows-trend"
        legend={(['anytime', 'starts', 'returns', 'leave'] as const).map((m) => ({
          color: FLOW_MEASURE_COLOR[m],
          label: FLOW_MEASURE_LABEL[m],
        }))}
        footnote={maturityCaveat}
      >
        <LineChart
          series={flowLineSeries}
          yLabel="children"
          xTickLabel={yearTick}
          valueFormat={(v) => (v == null ? NA : formatCount(Math.round(v)))}
        />
      </ChartCard>

      {/* ---- enforcement national KPIs + trend ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Enforcement, {latest.label}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard
            label="Section 437 notices"
            value={formatCell(natLatest.s437)}
            accent={ENF_MEASURE_COLOR.s437}
            delta={formatSignedCount(delta('s437'))}
            sub="notices to satisfy the LA that education is suitable"
          />
          <KpiCard
            label="School attendance orders issued"
            value={formatCell(natLatest.sao_issued)}
            accent={ENF_MEASURE_COLOR.sao_issued}
            delta={formatSignedCount(delta('sao_issued'))}
            sub="orders requiring a return to school"
          />
          <KpiCard
            label="Orders revoked"
            value={formatCell(natLatest.sao_revoked)}
            accent={ENF_MEASURE_COLOR.sao_revoked}
            delta={formatSignedCount(delta('sao_revoked'))}
            sub="orders subsequently withdrawn"
          />
        </div>
        <Caveat title="National enforcement only">
          The published academic-year file releases enforcement counts by LA for a subset of
          authorities only, so the number of LAs issuing zero notices or orders cannot be derived
          here; these tiles are national. Enforcement counts are heavily rounded (LA to the nearest
          10, national to the nearest 100), so small movements should not be over-read.
        </Caveat>
      </section>

      <ChartCard
        title="Enforcement trend"
        subtitle={`England, ${years[0]?.label} to ${latest.label} (annual)`}
        downloadName="ehe-enforcement-trend"
        legend={(['s437', 'sao_issued', 'sao_revoked'] as const).map((m) => ({
          color: ENF_MEASURE_COLOR[m],
          label: ENF_MEASURE_LABEL[m],
        }))}
        footnote={maturityCaveat}
      >
        <LineChart
          series={enfLineSeries}
          yLabel="cases"
          xTickLabel={yearTick}
          valueFormat={(v) => (v == null ? NA : formatCount(Math.round(v)))}
        />
      </ChartCard>

      {/* ---- footprint enforcement contrast ---- */}
      <ChartCard
        title="Enforcement intensity across the footprint and peninsula"
        subtitle={`Section 437 notices per 1,000 EHE children, ${latest.label}`}
        downloadName={`ehe-footprint-enforcement-${latest.key}`}
        footnote={
          <>
            {footprintCaveat} This is a recording-practice signal, not a measure of pupil behaviour:
            neighbouring LAs with similar populations record very different notice rates (Devon 10
            notices against 4,030 EHE children; Plymouth 100 against 1,090), which reflects how each
            authority logs and processes cases far more than any difference in the children. Bars use
            counts rounded to the nearest 10; a suppressed count renders n/a, never zero.
          </>
        }
      >
        <BarChart bars={enfBars} valueDp={1} labelWidth={110} />
      </ChartCard>

      {/* ---- footprint enforcement table (as-published symbols) ---- */}
      <ChartCard
        title="Footprint and peninsula enforcement, as published"
        subtitle={`${latest.label} academic year; values rounded to the nearest 10`}
        downloadName={`ehe-footprint-enforcement-table-${latest.key}`}
        footnote={
          <>
            Suppression symbols are shown as published: <span className="font-mono">low</span> ={' '}
            {FLAG_MEANING.low}; <span className="font-mono">x</span> = {FLAG_MEANING.x};{' '}
            <span className="font-mono">z</span> = {FLAG_MEANING.z}. Footprint LAs are shown in bold.
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-semibold">Local authority</th>
                <th className="py-2 pr-3 text-right font-semibold">At any point</th>
                <th className="py-2 pr-3 text-right font-semibold">S437 notices</th>
                <th className="py-2 pr-3 text-right font-semibold">Orders issued</th>
                <th className="py-2 pr-3 text-right font-semibold">Orders revoked</th>
              </tr>
            </thead>
            <tbody>
              {enfRows.map((r) => (
                <tr key={r.code} className="border-b border-slate-100">
                  <td
                    className={`py-1.5 pr-3 ${r.footprint ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
                  >
                    {r.name}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-700">
                    {formatCell(r.anytime)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-700">
                    {formatCell(r.s437)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-700">
                    {formatCell(r.sao_issued)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-700">
                    {formatCell(r.sao_revoked)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {/* ---- prior school type ---- */}
      <ChartCard
        title="Where EHE children came from (prior school type)"
        subtitle={`National, ${latest.label}; share of starts with a known prior setting`}
        downloadName={`ehe-prior-school-type-${latest.key}`}
        footnote={
          <>
            National only: the published counts for prior school type are structurally suppressed (
            <span className="font-mono">x</span> = {FLAG_MEANING.x}), so percentages are used.
            Percentages are rounded to whole numbers and small categories can round to{' '}
            <span className="font-mono">low</span> ({FLAG_MEANING.low}), shown as n/a. Shares may not
            sum to 100 because of rounding. {maturityCaveat}
          </>
        }
      >
        <BarChart bars={pstBars} valueSuffix="%" valueDp={0} labelWidth={190} />
      </ChartCard>
    </div>
  )
}

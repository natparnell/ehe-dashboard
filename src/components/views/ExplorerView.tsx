import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Download, ExternalLink, Search } from 'lucide-react'
import { loadProcessed } from '../../services/dataService'
import { formatCell, formatCount, formatPercent, formatRate, FLAG_MEANING, NA } from '../../utils/formatting'
import { getReasonColor, getReasonFamily } from '../../utils/colors'
import { DFE_RELEASE_URL, OFFICIAL_STATS_BADGE } from '../../constants'
import type { Cell } from '../../types'

// ---------------------------------------------------------------------------
// Data Explorer (spec section 5.9). A filterable, sortable real HTML table
// over BOTH source datasets (census-date stock and academic-year flows),
// as-published symbols shown, plus a CSV download using the clean raw source
// schema (raw column names, no derived columns) and links to the DfE release
// and both raw files. This view owns only this file: the JSON contract it
// reads is modelled locally rather than imported from a shared types module
// (scripts/DATA_SHAPES.md sections 1, 2, 3 and 5), matching the convention
// used by RegionalView / ReasonsView / MapView.
//
// Hard methodology rules honoured here:
//  - 4.1 Term is first-class: exactly one period (or one flow year) is shown
//    at a time; nothing is ever summed or averaged across terms or years.
//  - 4.2 Rates and percentages are shown exactly as published; only the raw
//    cell value is rendered, never recomputed.
//  - 4.6 Suppression to null, symbol preserved: suppressed cells render their
//    published symbol (never blank, never zero) and are hatched.
//  - 4.7 Region rank is not claimed here (this is a raw table, not a ranking).
//  - 4.8 Reason honesty: above LA level reason counts are structurally
//    suppressed (shown via the symbol); Unknown / No reason given / Other are
//    marked as data-quality categories, visually separated from substantive
//    reasons.
//  - 4.9 Footprint proxy caveat shown when Local authority level is selected.
//  - 4.10 Collection-maturity caveat shown as a standing note.
//  - 4.11 Sex: the published split includes Unknown; sex rates do not exist.
//  - 4.12 National reason counts / per-year-group rates are structurally
//    suppressed: never promised here, only shown as published (suppressed).
// ---------------------------------------------------------------------------

type Level = 'National' | 'Regional' | 'Local authority'
type CensusTopic = 'Total' | 'Sex' | 'Year group' | 'Reason'
type SortDir = 'asc' | 'desc'
type SortableValue = string | number | null

// ----- local data shapes (scripts/DATA_SHAPES.md) ---------------------------
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
  level: Level
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

interface LaBreakdownRecord {
  level: 'Local authority'
  code: string
  name: string
  region_code: string | null
  region_name: string | null
  topic: 'Reason' | 'Year group' | 'Sex'
  breakdown: string
  series: Record<string, BreakdownSeriesEntry>
}

interface BreakdownsLaReason {
  periods: TermPeriod[]
  topic: 'Reason'
  reasonOrder: string[]
  records: LaBreakdownRecord[]
}
interface BreakdownsLaYearGroup {
  periods: TermPeriod[]
  topic: 'Year group'
  yearGroupOrder: string[]
  records: LaBreakdownRecord[]
}
interface BreakdownsLaSex {
  periods: TermPeriod[]
  topic: 'Sex'
  sexOrder: string[]
  records: LaBreakdownRecord[]
}

interface FlowYear {
  key: string
  label: string
}

interface FlowsRecord {
  level: Level
  code: string
  name: string
  region_code: string | null
  series: Record<string, Record<string, Cell>>
}

interface PriorSchoolTypeEntry {
  count: Cell
  pct: Cell
}

interface Flows {
  years: FlowYear[]
  measures: string[]
  records: FlowsRecord[]
  priorSchoolTypeNational: {
    order: string[]
    series: Record<string, Record<string, PriorSchoolTypeEntry>>
  }
}

// ----- row shapes used by the table --------------------------------------
interface GeoIdentity {
  level: Level
  code: string
  name: string
  region_code: string | null
  region_name: string | null
}

interface CensusTotalRow extends GeoIdentity {
  count: Cell
  rate: Cell
  percent: Cell
  pop: number | null
}

interface CensusBreakdownRow extends GeoIdentity {
  breakdown: string
  count: Cell
  percent: Cell
}

interface FlowRow extends GeoIdentity {
  measures: Record<string, Cell>
}

// ----- constants -------------------------------------------------------
const RAW_CENSUS_URL = 'https://github.com/natparnell/ehe-dashboard/blob/main/data/ehe_census.csv'
const RAW_FLOWS_URL = 'https://github.com/natparnell/ehe-dashboard/blob/main/data/ehe_academic_year.csv'
const LEVELS: Level[] = ['National', 'Regional', 'Local authority']
const CENSUS_TOPICS: CensusTopic[] = ['Total', 'Sex', 'Year group', 'Reason']
const MEASURE_LABELS: Record<string, string> = {
  anytime: 'At any point in year',
  starts: 'Starts',
  returns: 'Returns',
  leave: 'Leave',
  s437: 'Section 437 notices',
  sao_issued: 'SAO issued',
  sao_revoked: 'SAO revoked',
}
const HATCH_BG = 'repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 4px, #cbd5e1 4px, #cbd5e1 6px)'

// ----- generic helpers -----------------------------------------------------
function compareSortable(a: SortableValue, b: SortableValue, dir: SortDir): number {
  if (a == null && b == null) return 0
  if (a == null) return 1 // nulls (suppressed / absent) always sort last
  if (b == null) return -1
  const cmp = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
  return dir === 'asc' ? cmp : -cmp
}

function matchesSearch(row: GeoIdentity, term: string): boolean {
  if (!term) return true
  const t = term.trim().toLowerCase()
  return (
    row.name.toLowerCase().includes(t) ||
    row.code.toLowerCase().includes(t) ||
    (row.region_name ?? '').toLowerCase().includes(t)
  )
}

// Suppression-aware cell props: hatched background + a title/aria tooltip
// carrying the published symbol's meaning (spec 3.2 / 4.6). Never applied to a
// genuine zero.
function suppressedCellProps(cell: Cell | null | undefined) {
  const suppressed = !!cell && cell.v == null
  if (!suppressed) return {}
  const meaning = cell?.f ? FLAG_MEANING[cell.f] : 'no data'
  return {
    style: { backgroundImage: HATCH_BG },
    title: meaning,
    'aria-label': meaning,
  }
}

// CSV cells preserve the raw as-published convention: the symbol itself
// ('x' / 'z' / 'low') or an empty string for a genuinely blank source cell,
// never "n/a" (that is a display-only convention for the on-screen table).
function rawCellValue(cell: Cell | null | undefined): string | number {
  if (!cell) return ''
  if (cell.v == null) return cell.f ?? ''
  return cell.v
}

function csvField(value: string | number): string {
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n')
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// The raw DfE geography columns (region_code, region_name, old_la_code,
// new_la_code, la_name), reconstructed from the processed row. old_la_code is
// not carried by the processed JSON, so it is always blank here; the raw file
// links exist precisely so a reader who needs that legacy column can get it.
function rawGeoColumns(row: GeoIdentity): (string | number)[] {
  if (row.level === 'National') return ['', '', '', '', '']
  if (row.level === 'Regional') return [row.code, row.name, '', '', '']
  return [row.region_code ?? '', row.region_name ?? '', '', row.code, row.name]
}

// ----- sortable table (generic, shared by all three tables in this view) ---
interface ColumnDef<T> {
  key: string
  label: ReactNode
  align?: 'left' | 'right'
  sortValue: (row: T) => SortableValue
  render: (row: T) => ReactNode
}

function SortableTable<T extends { code: string; breakdown?: string }>({
  rows,
  columns,
  sortKey,
  sortDir,
  onSort,
  rowKey,
}: {
  rows: T[]
  columns: ColumnDef<T>[]
  sortKey: string
  sortDir: SortDir
  onSort: (key: string) => void
  rowKey: (row: T, i: number) => string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={'py-1.5 pr-3' + (col.align === 'right' ? ' text-right' : '')}
                aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button
                  type="button"
                  onClick={() => onSort(col.key)}
                  className={
                    'inline-flex items-center gap-1 hover:text-slate-700' +
                    (col.align === 'right' ? ' flex-row-reverse' : '')
                  }
                  aria-label={`Sort by ${typeof col.label === 'string' ? col.label : col.key}`}
                >
                  {col.label}
                  {sortKey === col.key ? (
                    sortDir === 'asc' ? (
                      <ChevronUp size={12} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={12} aria-hidden="true" />
                    )
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b border-slate-100">
              {columns.map((col) => (
                <td key={col.key} className={'py-1.5 pr-3' + (col.align === 'right' ? ' text-right' : '')}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-6 text-center text-slate-400">
                No rows match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function GeoCell({ row }: { row: GeoIdentity }) {
  return (
    <div>
      <div className="font-medium text-slate-800">{row.name}</div>
      <div className="text-[11px] text-slate-400">{row.code}</div>
    </div>
  )
}

function ReasonCell({ breakdown }: { breakdown: string }) {
  const family = getReasonFamily(breakdown)
  const dataQuality = family === 'dataQuality'
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: getReasonColor(breakdown) }}
        aria-hidden="true"
      />
      <span className={dataQuality ? 'italic text-slate-500' : 'text-slate-700'}>{breakdown}</span>
      {dataQuality && <span className="text-[10px] uppercase tracking-wide text-slate-400">data quality</span>}
    </div>
  )
}

// ----- the view --------------------------------------------------------
export function ExplorerView() {
  const [tab, setTab] = useState<'census' | 'flows'>('census')

  // eager files (spec 3.3: totals ~160KB, breakdowns ~306KB, flows ~9KB).
  // undefined = still loading; null = fetch failed (distinct from not-yet-loaded).
  const [totals, setTotals] = useState<Totals | null | undefined>(undefined)
  const [breakdowns, setBreakdowns] = useState<Breakdowns | null | undefined>(undefined)
  const [flows, setFlows] = useState<Flows | null | undefined>(undefined)

  // lazy LA-grain breakdown files, loaded only when needed (spec 3.3 item 3).
  // undefined = not yet requested / in flight; null = fetch failed.
  const [laReason, setLaReason] = useState<BreakdownsLaReason | null | undefined>(undefined)
  const [laYearGroup, setLaYearGroup] = useState<BreakdownsLaYearGroup | null | undefined>(undefined)
  const [laSex, setLaSex] = useState<BreakdownsLaSex | null | undefined>(undefined)

  // census controls
  const [level, setLevel] = useState<Level>('National')
  const [topic, setTopic] = useState<CensusTopic>('Total')
  const [breakdownFilter, setBreakdownFilter] = useState<string>('All')
  const [periodKey, setPeriodKey] = useState<string>('')
  const [censusSort, setCensusSort] = useState<{ key: string; dir: SortDir }>({ key: 'name', dir: 'asc' })

  // flows controls
  const [flowYearKey, setFlowYearKey] = useState<string>('')
  const [flowSort, setFlowSort] = useState<{ key: string; dir: SortDir }>({ key: 'name', dir: 'asc' })

  const [search, setSearch] = useState('')

  useEffect(() => {
    let alive = true
    void loadProcessed<Totals>('totals.json').then((d) => {
      if (!alive) return
      setTotals(d)
      if (d && d.periods.length) setPeriodKey((k) => k || d.periods[d.periods.length - 1].key)
    })
    void loadProcessed<Breakdowns>('breakdowns.json').then((d) => {
      if (alive) setBreakdowns(d)
    })
    void loadProcessed<Flows>('flows.json').then((d) => {
      if (!alive) return
      setFlows(d)
      if (d && d.years.length) setFlowYearKey((k) => k || d.years[d.years.length - 1].key)
    })
    return () => {
      alive = false
    }
  }, [])

  // lazy-load the LA-grain breakdown file matching the current topic, once,
  // only when Local authority level + a non-Total topic is selected.
  useEffect(() => {
    if (level !== 'Local authority' || topic === 'Total') return
    let alive = true
    // Only fetch when the slot is still undefined (not yet requested); a null
    // (previous failure) is left as-is so we do not silently retry-loop.
    if (topic === 'Reason' && laReason === undefined) {
      void loadProcessed<BreakdownsLaReason>('breakdowns-la-reason.json').then((d) => alive && setLaReason(d))
    } else if (topic === 'Year group' && laYearGroup === undefined) {
      void loadProcessed<BreakdownsLaYearGroup>('breakdowns-la-yeargroup.json').then((d) => alive && setLaYearGroup(d))
    } else if (topic === 'Sex' && laSex === undefined) {
      void loadProcessed<BreakdownsLaSex>('breakdowns-la-sex.json').then((d) => alive && setLaSex(d))
    }
    return () => {
      alive = false
    }
  }, [level, topic, laReason, laYearGroup, laSex])

  // region_name lookup for LA codes, derived from the already-eager totals
  // file, so flows.json's LA rows (which carry region_code but not
  // region_name) can be displayed and exported consistently with the census
  // rows. No hardcoded geography facts.
  const regionNameByLaCode = useMemo(() => {
    const m = new Map<string, string | null>()
    if (totals) {
      for (const g of totals.geographies) {
        if (g.level === 'Local authority') m.set(g.code, g.region_name)
      }
    }
    return m
  }, [totals])

  function handleCensusSort(key: string) {
    setCensusSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }
  function handleFlowSort(key: string) {
    setFlowSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  const breakdownOrder: string[] = useMemo(() => {
    if (!breakdowns) return []
    if (topic === 'Sex') return breakdowns.sexOrder
    if (topic === 'Year group') return breakdowns.yearGroupOrder
    if (topic === 'Reason') return breakdowns.reasonOrder
    return []
  }, [breakdowns, topic])

  // --- census rows ---------------------------------------------------------
  const censusPeriod = useMemo(
    () => totals?.periods.find((p) => p.key === periodKey) ?? null,
    [totals, periodKey],
  )

  const censusRows = useMemo((): (CensusTotalRow | CensusBreakdownRow)[] => {
    if (!totals || !censusPeriod) return []
    if (topic === 'Total') {
      const rows: CensusTotalRow[] = []
      for (const g of totals.geographies) {
        if (g.level !== level) continue
        const entry = g.series[censusPeriod.key]
        if (!entry) continue
        if (!matchesSearch(g, search)) continue
        rows.push({
          level: g.level,
          code: g.code,
          name: g.name,
          region_code: g.region_code,
          region_name: g.region_name,
          count: entry.count,
          rate: entry.rate,
          percent: entry.percent,
          pop: entry.pop,
        })
      }
      return rows
    }
    // Sex / Year group / Reason
    const source: (BreakdownRecord | LaBreakdownRecord)[] =
      level === 'Local authority'
        ? topic === 'Reason'
          ? laReason?.records ?? []
          : topic === 'Year group'
            ? laYearGroup?.records ?? []
            : laSex?.records ?? []
        : breakdowns?.records.filter((r) => r.level === level) ?? []
    const rows: CensusBreakdownRow[] = []
    for (const r of source) {
      if (r.topic !== topic) continue
      if (breakdownFilter !== 'All' && r.breakdown !== breakdownFilter) continue
      const entry = r.series[censusPeriod.key]
      if (!entry) continue
      if (!matchesSearch(r, search)) continue
      rows.push({
        level: r.level,
        code: r.code,
        name: r.name,
        region_code: r.region_code,
        region_name: r.region_name,
        breakdown: r.breakdown,
        count: entry.count,
        percent: entry.percent,
      })
    }
    return rows
  }, [totals, censusPeriod, topic, level, search, breakdownFilter, breakdowns, laReason, laYearGroup, laSex])

  const censusLoading =
    level === 'Local authority' &&
    topic !== 'Total' &&
    ((topic === 'Reason' && laReason === undefined) ||
      (topic === 'Year group' && laYearGroup === undefined) ||
      (topic === 'Sex' && laSex === undefined))
  const censusError =
    level === 'Local authority' &&
    topic !== 'Total' &&
    ((topic === 'Reason' && laReason === null) ||
      (topic === 'Year group' && laYearGroup === null) ||
      (topic === 'Sex' && laSex === null))

  const censusColumns: ColumnDef<CensusTotalRow | CensusBreakdownRow>[] = useMemo(() => {
    const base: ColumnDef<CensusTotalRow | CensusBreakdownRow>[] = [
      { key: 'name', label: 'Geography', sortValue: (r) => r.name, render: (r) => <GeoCell row={r} /> },
      { key: 'level', label: 'Level', sortValue: (r) => r.level, render: (r) => r.level },
      {
        key: 'region_name',
        label: 'Region',
        sortValue: (r) => r.region_name,
        render: (r) => r.region_name ?? NA,
      },
    ]
    if (topic === 'Total') {
      return [
        ...base,
        {
          key: 'count',
          label: 'Count',
          align: 'right',
          sortValue: (r) => (r as CensusTotalRow).count.v,
          render: (r) => (
            <span {...suppressedCellProps((r as CensusTotalRow).count)}>
              {formatCell((r as CensusTotalRow).count, formatCount)}
            </span>
          ),
        },
        {
          key: 'rate',
          label: 'Rate per 100',
          align: 'right',
          sortValue: (r) => (r as CensusTotalRow).rate.v,
          render: (r) => (
            <span {...suppressedCellProps((r as CensusTotalRow).rate)}>
              {formatCell((r as CensusTotalRow).rate, (v) => formatRate(v))}
            </span>
          ),
        },
        {
          key: 'percent',
          label: 'Percent',
          align: 'right',
          sortValue: (r) => (r as CensusTotalRow).percent.v,
          render: (r) => (
            <span {...suppressedCellProps((r as CensusTotalRow).percent)}>
              {formatCell((r as CensusTotalRow).percent, (v) => formatPercent(v))}
            </span>
          ),
        },
        {
          key: 'pop',
          label: 'Population (back-out)',
          align: 'right',
          sortValue: (r) => (r as CensusTotalRow).pop,
          render: (r) => formatCount((r as CensusTotalRow).pop),
        },
      ]
    }
    return [
      ...base,
      {
        key: 'breakdown',
        label: topic,
        sortValue: (r) => (r as CensusBreakdownRow).breakdown,
        render: (r) => <ReasonCell breakdown={(r as CensusBreakdownRow).breakdown} />,
      },
      {
        key: 'count',
        label: 'Count',
        align: 'right',
        sortValue: (r) => (r as CensusBreakdownRow).count.v,
        render: (r) => (
          <span {...suppressedCellProps((r as CensusBreakdownRow).count)}>
            {formatCell((r as CensusBreakdownRow).count, formatCount)}
          </span>
        ),
      },
      {
        key: 'percent',
        label: 'Percent',
        align: 'right',
        sortValue: (r) => (r as CensusBreakdownRow).percent.v,
        render: (r) => (
          <span {...suppressedCellProps((r as CensusBreakdownRow).percent)}>
            {formatCell((r as CensusBreakdownRow).percent, (v) => formatPercent(v))}
          </span>
        ),
      },
    ]
  }, [topic])

  const sortedCensusRows = useMemo(() => {
    const col = censusColumns.find((c) => c.key === censusSort.key) ?? censusColumns[0]
    return [...censusRows].sort((a, b) => compareSortable(col.sortValue(a), col.sortValue(b), censusSort.dir))
  }, [censusRows, censusColumns, censusSort])

  // --- flow rows -----------------------------------------------------------
  const flowYear = useMemo(() => flows?.years.find((y) => y.key === flowYearKey) ?? null, [flows, flowYearKey])

  const flowRows = useMemo((): FlowRow[] => {
    if (!flows || !flowYear) return []
    const rows: FlowRow[] = []
    for (const r of flows.records) {
      if (r.level !== level) continue
      const entry = r.series[flowYear.key]
      if (!entry) continue
      const region_name =
        r.level === 'National' ? null : r.level === 'Regional' ? r.name : (regionNameByLaCode.get(r.code) ?? null)
      const identity: GeoIdentity = {
        level: r.level,
        code: r.code,
        name: r.name,
        region_code: r.region_code,
        region_name,
      }
      if (!matchesSearch(identity, search)) continue
      rows.push({ ...identity, measures: entry })
    }
    return rows
  }, [flows, flowYear, level, search, regionNameByLaCode])

  const flowColumns: ColumnDef<FlowRow>[] = useMemo(() => {
    const base: ColumnDef<FlowRow>[] = [
      { key: 'name', label: 'Geography', sortValue: (r) => r.name, render: (r) => <GeoCell row={r} /> },
      { key: 'level', label: 'Level', sortValue: (r) => r.level, render: (r) => r.level },
      { key: 'region_name', label: 'Region', sortValue: (r) => r.region_name, render: (r) => r.region_name ?? NA },
    ]
    const measureCols: ColumnDef<FlowRow>[] = (flows?.measures ?? Object.keys(MEASURE_LABELS)).map((m) => ({
      key: m,
      label: MEASURE_LABELS[m] ?? m,
      align: 'right' as const,
      sortValue: (r: FlowRow) => r.measures[m]?.v ?? null,
      render: (r: FlowRow) => (
        <span {...suppressedCellProps(r.measures[m])}>{formatCell(r.measures[m], formatCount)}</span>
      ),
    }))
    return [...base, ...measureCols]
  }, [flows])

  const sortedFlowRows = useMemo(() => {
    const col = flowColumns.find((c) => c.key === flowSort.key) ?? flowColumns[0]
    return [...flowRows].sort((a, b) => compareSortable(col.sortValue(a), col.sortValue(b), flowSort.dir))
  }, [flowRows, flowColumns, flowSort])

  // --- CSV export ------------------------------------------------------
  function exportCensusCsv() {
    if (!censusPeriod) return
    const timePeriod = censusPeriod.year.replace('/', '')
    const timeIdentifier = `${censusPeriod.term} term`
    const headers =
      topic === 'Total'
        ? [
            'time_period', 'time_identifier', 'geographic_level', 'country_code', 'country_name',
            'region_code', 'region_name', 'old_la_code', 'new_la_code', 'la_name',
            'breakdown_topic', 'breakdown', 'child_count', 'child_percent', 'rate_per_100',
          ]
        : [
            'time_period', 'time_identifier', 'geographic_level', 'country_code', 'country_name',
            'region_code', 'region_name', 'old_la_code', 'new_la_code', 'la_name',
            'breakdown_topic', 'breakdown', 'child_count', 'child_percent',
          ]
    const body = sortedCensusRows.map((r) => {
      const geoCols = rawGeoColumns(r)
      if (topic === 'Total') {
        const tr = r as CensusTotalRow
        return [
          timePeriod, timeIdentifier, r.level, 'E92000001', 'England', ...geoCols,
          'Total', 'Total', rawCellValue(tr.count), rawCellValue(tr.percent), rawCellValue(tr.rate),
        ]
      }
      const br = r as CensusBreakdownRow
      return [
        timePeriod, timeIdentifier, r.level, 'E92000001', 'England', ...geoCols,
        topic, br.breakdown, rawCellValue(br.count), rawCellValue(br.percent),
      ]
    })
    downloadCsv(
      `ehe-census-${topic.toLowerCase().replace(/\s+/g, '-')}-${level.toLowerCase().replace(/\s+/g, '-')}-${censusPeriod.key}.csv`,
      toCsv(headers, body),
    )
  }

  function exportFlowsCsv() {
    if (!flowYear) return
    const headers = [
      'time_period', 'time_identifier', 'geographic_level', 'country_code', 'country_name',
      'region_code', 'region_name', 'old_la_code', 'new_la_code', 'la_name',
      'ehe_starts_full_year', 'ehe_anytime_full_year', 'ehe_returns_full_year', 'ehe_leave',
      'ehe_section_437_full_year', 'ehe_sao_issued_full_year', 'ehe_sao_revoked_full_year',
    ]
    const body = sortedFlowRows.map((r) => [
      flowYear.key, 'Academic year', r.level, 'E92000001', 'England', ...rawGeoColumns(r),
      rawCellValue(r.measures.starts), rawCellValue(r.measures.anytime), rawCellValue(r.measures.returns),
      rawCellValue(r.measures.leave), rawCellValue(r.measures.s437), rawCellValue(r.measures.sao_issued),
      rawCellValue(r.measures.sao_revoked),
    ])
    downloadCsv(`ehe-flows-${level.toLowerCase().replace(/\s+/g, '-')}-${flowYear.key}.csv`, toCsv(headers, body))
  }

  if (totals === null || breakdowns === null || flows === null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        No processed data found. Run <code>npm run preprocess</code> first.
      </div>
    )
  }
  if (!totals || !breakdowns || !flows) {
    return <div className="p-8 text-sm text-slate-500">Loading data...</div>
  }

  return (
    <div className="space-y-4">
      {/* standing caveats and reference links (spec 4.10, 5.9) */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">
          A raw, filterable view of both source files behind this dashboard: the {formatCount(58968)}-row
          census-date file (termly stock) and the {formatCount(655)}-row academic-year file (annual flow,
          one year behind the census). Every value shown is a single geography x period cell exactly as
          published: nothing here is summed or averaged across terms, years or geographies. {OFFICIAL_STATS_BADGE}.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <a
            href={DFE_RELEASE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-700 hover:underline"
          >
            DfE release <ExternalLink size={12} aria-hidden="true" />
          </a>
          <a
            href={RAW_CENSUS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-700 hover:underline"
          >
            Raw file: ehe_census.csv <ExternalLink size={12} aria-hidden="true" />
          </a>
          <a
            href={RAW_FLOWS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-700 hover:underline"
          >
            Raw file: ehe_academic_year.csv <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="inline-flex overflow-hidden rounded-md border border-slate-300 print:hidden">
        {(
          [
            { id: 'census', label: 'Census-date stock' },
            { id: 'flows', label: 'Academic year flows' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={'px-3 py-1.5 text-sm ' + (tab === t.id ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'census' ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Geography level
              <select
                className="mt-1 h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800"
                value={level}
                onChange={(e) => setLevel(e.target.value as Level)}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Topic
              <select
                className="mt-1 h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800"
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value as CensusTopic)
                  setBreakdownFilter('All')
                }}
              >
                {CENSUS_TOPICS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            {topic !== 'Total' && (
              <label className="flex flex-col text-xs text-slate-500">
                {topic}
                <select
                  className="mt-1 h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800"
                  value={breakdownFilter}
                  onChange={(e) => setBreakdownFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  {breakdownOrder.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col text-xs text-slate-500">
              Period
              <select
                className="mt-1 h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800"
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
              >
                {[...totals.periods].reverse().map((p) => (
                  <option key={p.key} value={p.key}>{p.term} {p.year}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Search geography
              <span className="mt-1 flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2">
                <Search size={13} className="text-slate-400" aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="name, code or region"
                  className="h-full w-40 text-sm text-slate-800 outline-none"
                  aria-label="Search geography by name, code or region"
                />
              </span>
            </label>
            <button
              onClick={exportCensusCsv}
              disabled={!censusPeriod || sortedCensusRows.length === 0}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 print:hidden"
            >
              <Download size={13} aria-hidden="true" />
              Download CSV (raw schema)
            </button>
          </div>

          {level === 'Local authority' && (
            <p className="mt-2 text-[11px] text-slate-400">
              Local-authority figures are for all children resident in that local authority, not only WeST
              pupils (see the WeST Footprint view for the trust&rsquo;s three-LA footprint).
            </p>
          )}

          <div className="mt-3">
            {censusLoading ? (
              <div className="p-8 text-sm text-slate-500">Loading local authority breakdown...</div>
            ) : censusError ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
                This local authority breakdown could not be loaded. Run <code>npm run preprocess</code> to
                regenerate the processed files, or try again.
              </div>
            ) : (
              <>
                <p className="mb-2 text-xs text-slate-400">
                  {sortedCensusRows.length} row{sortedCensusRows.length === 1 ? '' : 's'} shown, {level}, {topic}
                  {censusPeriod ? `, ${censusPeriod.term} ${censusPeriod.year}` : ''}.
                </p>
                <SortableTable
                  rows={sortedCensusRows}
                  columns={censusColumns}
                  sortKey={censusSort.key}
                  sortDir={censusSort.dir}
                  onSort={handleCensusSort}
                  rowKey={(r) => `${r.code}-${'breakdown' in r ? r.breakdown : 'total'}`}
                />
              </>
            )}
          </div>

          <div className="mt-3 space-y-1 text-[11px] leading-snug text-slate-400">
            <p>
              Rounding as published: local authority and regional counts to the nearest 10, national counts
              to the nearest 100, percentages to whole numbers, rates to 1 decimal place. Totals may not sum
              exactly because of this rounding.
            </p>
            {topic === 'Sex' && (
              <p>
                The published sex split includes an Unknown category. Sex rates are not published (they are
                structurally suppressed at every geography level); only counts and percentages are shown.
              </p>
            )}
            {topic === 'Year group' && (
              <p>
                Local-authority year-group counts exist only from 2024/25 onward (percent-only in earlier
                periods); rates by year group are not published at any level.
              </p>
            )}
            {topic === 'Reason' && (
              <p>
                Above local-authority level, reason counts are structurally suppressed (shown as their
                published symbol): use the percent column instead. Unknown, No reason given and Other are
                marked as data-quality categories (italic, grey dot), separate from substantive reasons.
                Never infer a school-driven-versus-lifestyle split from local-authority reason data; the
                suppression will not bear it. Cross-region comparison of named reasons carries an
                Unknown-share caveat: it varies 7% to 29% by region, some of which is recording practice, not
                only underlying cause.
              </p>
            )}
            <p>
              Collection was voluntary from autumn 2022 (93 to 100% local-authority response) and became
              mandatory from autumn 2024; national and regional figures are uprated for non-response. Part of
              any apparent growth reflects improved coverage, not only more children becoming electively home
              educated.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Geography level
              <select
                className="mt-1 h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800"
                value={level}
                onChange={(e) => setLevel(e.target.value as Level)}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Academic year
              <select
                className="mt-1 h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800"
                value={flowYearKey}
                onChange={(e) => setFlowYearKey(e.target.value)}
              >
                {[...flows.years].reverse().map((y) => (
                  <option key={y.key} value={y.key}>{y.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Search geography
              <span className="mt-1 flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2">
                <Search size={13} className="text-slate-400" aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="name, code or region"
                  className="h-full w-40 text-sm text-slate-800 outline-none"
                  aria-label="Search geography by name, code or region"
                />
              </span>
            </label>
            <button
              onClick={exportFlowsCsv}
              disabled={!flowYear || sortedFlowRows.length === 0}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 print:hidden"
            >
              <Download size={13} aria-hidden="true" />
              Download CSV (raw schema)
            </button>
          </div>

          <p className="mt-2 text-[11px] text-slate-400">
            This file&rsquo;s processed scope is limited to England, South West, the WeST-footprint local
            authorities (Cornwall, Plymouth, Devon) and the benchmark local authorities (Torbay, Somerset,
            Dorset): 8 geographies, not the full local-authority list. Use the raw file link above for every
            local authority.
          </p>

          <div className="mt-3">
            <p className="mb-2 text-xs text-slate-400">
              {sortedFlowRows.length} row{sortedFlowRows.length === 1 ? '' : 's'} shown, {level}
              {flowYear ? `, academic year ${flowYear.label}` : ''}.
            </p>
            <SortableTable
              rows={sortedFlowRows}
              columns={flowColumns}
              sortKey={flowSort.key}
              sortDir={flowSort.dir}
              onSort={handleFlowSort}
              rowKey={(r) => r.code}
            />
          </div>

          {level === 'National' && flowYear && (
            <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Prior school type mix, England, {flowYear.label} (national only)
              </h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th scope="col" className="py-1 pr-3">Prior school type</th>
                      <th scope="col" className="py-1 pr-3 text-right">Count</th>
                      <th scope="col" className="py-1 text-right">Percent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flows.priorSchoolTypeNational.order.map((type) => {
                      const entry = flows.priorSchoolTypeNational.series[flowYear.key]?.[type]
                      return (
                        <tr key={type} className="border-b border-slate-100">
                          <td className="py-1 pr-3 text-slate-700">{type}</td>
                          <td className="py-1 pr-3 text-right" {...suppressedCellProps(entry?.count)}>
                            {formatCell(entry?.count, formatCount)}
                          </td>
                          <td className="py-1 text-right" {...suppressedCellProps(entry?.pct)}>
                            {formatCell(entry?.pct, (v) => formatPercent(v))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                National only: regional and local-authority prior-school-type counts are almost entirely
                suppressed in the source file.
              </p>
            </div>
          )}

          <p className="mt-3 text-[11px] leading-snug text-slate-400">
            Annual, one year behind the census-date file, and a different measure: &ldquo;at any point in
            year&rdquo; counts a child once if they were electively home educated at any time in the academic
            year (England {formatCount(175900)} in 2024/25), which is never arithmetically reconciled to the
            census-date stock (England {formatCount(126000)} in autumn 2025/26). Label periods explicitly
            whenever comparing figures from this table to the census-date table.
          </p>
        </div>
      )}
    </div>
  )
}

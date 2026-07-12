import { useRef, type ReactNode } from 'react'
import { ChartDownload } from './ChartDownload'
import { getGeoColor, type GeoRole } from '../utils/colors'

export interface LegendItem {
  // Either a geography role (fixed colour) or an explicit colour (e.g. a reason
  // family or a benchmark LA).
  role?: GeoRole
  color?: string
  label: string
  dashed?: boolean
  band?: boolean
}

interface Props {
  title: string
  // The measure and period, e.g. "Census-date stock, autumn 2025/26".
  subtitle?: string
  downloadName: string
  legend?: LegendItem[]
  // The caveat line: proxy note, suppression note, maturity note, etc.
  footnote?: ReactNode
  children: ReactNode
}

function legendColor(it: LegendItem): string {
  return it.color ?? (it.role ? getGeoColor(it.role) : '#94a3b8')
}

function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.band ? (
            <span
              className="inline-block h-2.5 w-4 rounded-sm"
              style={{ background: legendColor(it), opacity: 0.3 }}
            />
          ) : (
            <svg width="20" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="20"
                y2="4"
                stroke={legendColor(it)}
                strokeWidth={it.role === 'footprint' ? 3 : 2}
                strokeDasharray={it.dashed ? '5 3' : undefined}
              />
            </svg>
          )}
          {it.label}
        </span>
      ))}
    </div>
  )
}

// A chart container: title row with PNG export, optional legend, the chart, and
// an optional footnote caveat. The whole card is the PNG capture target and is
// kept intact across print page breaks.
export function ChartCard({ title, subtitle, downloadName, legend, footnote, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:break-inside-avoid"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        <ChartDownload targetRef={ref} filename={downloadName} />
      </div>
      {legend && <Legend items={legend} />}
      <div className="mt-2">{children}</div>
      {footnote && <div className="mt-2 text-[11px] leading-snug text-slate-500">{footnote}</div>}
    </div>
  )
}

import { useRef, useState, useLayoutEffect, useMemo } from 'react'
import { getGeoColor, type GeoRole } from '../../utils/colors'
import { niceTicks } from '../../utils/ticks'

export interface LinePoint {
  x: number
  y: number | null
  lo?: number | null
  hi?: number | null
}

export interface LineSeries {
  id: string
  role: GeoRole
  data: LinePoint[]
  // Explicit colour override (e.g. a benchmark LA distinct from the grey role).
  color?: string
  dashed?: boolean
  width?: number
  // Render a shaded ribbon between lo and hi (reference band).
  band?: boolean
}

interface Props {
  series: LineSeries[]
  height?: number
  yLabel?: string
  valueSuffix?: string
  yMin?: number | 'auto'
  yMax?: number | 'auto'
  // A vertical reference marker at x with an optional label.
  markerX?: number
  markerLabel?: string
  // Formatter for the x tick labels (e.g. map a term-point index to "Aut 25").
  xTickLabel?: (x: number) => string
  // Formatter for hover-tooltip and axis values. Defaults to 1 dp + suffix.
  valueFormat?: (v: number | null | undefined) => string
}

const M = { top: 16, right: 24, bottom: 40, left: 52 }

// A self-contained SVG line chart: per-series colour, width, dash and
// null-driven gaps; optional shaded bands; a vertical reference marker; and a
// snap-to-point hover tooltip. Dashed lines carry the England-reference
// convention (spec section 7). Used for every time-series view.
export function LineChart({
  series,
  height = 320,
  yLabel,
  valueSuffix = '',
  yMin = 0,
  yMax = 'auto',
  markerX,
  markerLabel,
  xTickLabel,
  valueFormat,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hoverX, setHoverX] = useState<number | null>(null)

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

  const fmt = useMemo(
    () =>
      valueFormat ??
      ((v: number | null | undefined) =>
        v == null || Number.isNaN(v) ? 'n/a' : `${v.toFixed(1)}${valueSuffix}`),
    [valueFormat, valueSuffix],
  )

  const { xs, xMin, xMax, lo, hi } = useMemo(() => {
    const allX = new Set<number>()
    let yLo = Infinity
    let yHi = -Infinity
    for (const s of series) {
      for (const p of s.data) {
        allX.add(p.x)
        for (const v of [p.y, p.lo, p.hi]) {
          if (v != null && Number.isFinite(v)) {
            if (v < yLo) yLo = v
            if (v > yHi) yHi = v
          }
        }
      }
    }
    const xsSorted = [...allX].sort((a, b) => a - b)
    if (!Number.isFinite(yLo)) {
      yLo = 0
      yHi = 1
    }
    const pad = (yHi - yLo) * 0.1 || 1
    const loOut = yMin === 'auto' ? yLo - pad : yMin
    const hiOut = yMax === 'auto' ? yHi + pad : yMax
    return {
      xs: xsSorted,
      xMin: xsSorted[0] ?? 0,
      xMax: xsSorted[xsSorted.length - 1] ?? 1,
      lo: loOut,
      hi: hiOut,
    }
  }, [series, yMin, yMax])

  const innerW = Math.max(width - M.left - M.right, 10)
  const innerH = Math.max(height - M.top - M.bottom, 10)
  const sx = (x: number) =>
    M.left + (xMax === xMin ? innerW / 2 : ((x - xMin) / (xMax - xMin)) * innerW)
  const sy = (y: number) => M.top + (hi === lo ? innerH / 2 : (1 - (y - lo) / (hi - lo)) * innerH)

  const yticks = niceTicks(lo, hi, 5)
  const xticks = xs.length <= 12 ? xs : niceTicks(xMin, xMax, 8).filter((v) => Number.isInteger(v))

  function color(s: LineSeries): string {
    return s.color ?? getGeoColor(s.role)
  }

  function segPath(data: LinePoint[]): string[] {
    const out: string[] = []
    let cur: string[] = []
    for (const p of data) {
      if (p.y == null) {
        if (cur.length) out.push(cur.join(' '))
        cur = []
      } else {
        cur.push(`${cur.length === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
      }
    }
    if (cur.length) out.push(cur.join(' '))
    return out
  }

  function bandPath(data: LinePoint[]): string | null {
    const pts = data.filter((p) => p.lo != null && p.hi != null)
    if (pts.length < 2) return null
    const top = pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.hi as number).toFixed(1)}`)
    const bot = [...pts].reverse().map((p) => `${sx(p.x).toFixed(1)},${sy(p.lo as number).toFixed(1)}`)
    return `M${top.join(' L')} L${bot.join(' L')} Z`
  }

  // Hover: snap to the nearest x present in the data.
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    if (!xs.length) return
    let best = xs[0]
    let bestD = Infinity
    for (const x of xs) {
      const d = Math.abs(sx(x) - mx)
      if (d < bestD) {
        bestD = d
        best = x
      }
    }
    setHoverX(best)
  }

  const hoverRows =
    hoverX == null
      ? []
      : series.map((s) => ({
          id: s.id,
          color: color(s),
          y: s.data.find((p) => p.x === hoverX)?.y ?? null,
        }))
  const hoverPx = hoverX == null ? 0 : sx(hoverX)
  const tooltipLeft = Math.min(Math.max(hoverPx + 8, 0), Math.max(width - 180, 0))

  return (
    <div ref={wrapRef} className="relative" style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={yLabel ?? 'time series'}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverX(null)}
      >
        {yticks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke="#eef2f6" />
            <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="#64748b">
              {`${t}${valueSuffix}`}
            </text>
          </g>
        ))}
        {xticks.map((t) => (
          <text
            key={`x${t}`}
            x={sx(t)}
            y={height - M.bottom + 16}
            textAnchor="middle"
            fontSize="10"
            fill="#64748b"
          >
            {xTickLabel ? xTickLabel(t) : t}
          </text>
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
        {series
          .filter((s) => s.band)
          .map((s) => {
            const d = bandPath(s.data)
            return d ? (
              <path key={`band-${s.id}`} d={d} fill={color(s)} fillOpacity={0.16} />
            ) : null
          })}
        {markerX != null && markerX >= xMin && markerX <= xMax && (
          <g>
            <line
              x1={sx(markerX)}
              x2={sx(markerX)}
              y1={M.top}
              y2={height - M.bottom}
              stroke="#cbd5e1"
              strokeDasharray="4 4"
            />
            {markerLabel && (
              <text x={sx(markerX) + 4} y={M.top + 10} fontSize="9" fill="#64748b">
                {markerLabel}
              </text>
            )}
          </g>
        )}
        {series.map((s) =>
          segPath(s.data).map((d, i) => (
            <path
              key={`line-${s.id}-${i}`}
              d={d}
              fill="none"
              stroke={color(s)}
              strokeWidth={s.width ?? 2}
              strokeDasharray={s.dashed ? '8 4' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )),
        )}
        {series.map((s) =>
          s.data
            .filter((p) => p.y != null)
            .map((p) => (
              <circle
                key={`pt-${s.id}-${p.x}`}
                cx={sx(p.x)}
                cy={sy(p.y as number)}
                r={(s.width ?? 2) >= 3 ? 3 : 2.4}
                fill={color(s)}
              />
            )),
        )}
        {hoverX != null && (
          <line
            x1={hoverPx}
            x2={hoverPx}
            y1={M.top}
            y2={height - M.bottom}
            stroke="#94a3b8"
            strokeWidth={1}
          />
        )}
      </svg>
      {hoverX != null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: tooltipLeft, top: 8, minWidth: 150 }}
        >
          <div className="mb-1 font-semibold text-slate-700">
            {xTickLabel ? xTickLabel(hoverX) : hoverX}
          </div>
          {hoverRows.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
              <span className="text-slate-600">{r.id}</span>
              <span className="ml-auto font-medium text-slate-900">{fmt(r.y)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

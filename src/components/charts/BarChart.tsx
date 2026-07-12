import { useRef, useState, useLayoutEffect } from 'react'
import { getGeoColor, type GeoRole } from '../../utils/colors'
import { NA } from '../../utils/formatting'

export interface Bar {
  id: string
  label: string
  value: number | null
  role?: GeoRole
  color?: string
  highlight?: boolean
}

export interface RefLine {
  value: number
  label: string
  color: string
}

interface Props {
  bars: Bar[]
  valueSuffix?: string
  refLines?: RefLine[]
  rowHeight?: number
  // Width of the left label gutter; widen it for long category names.
  labelWidth?: number
  // Decimal places for the value labels (rates use 1, counts use 0).
  valueDp?: number
}

// A horizontal bar chart for ranked comparisons (regions, LAs, reasons).
// Highlighted bars get a heavier outline; reference lines mark benchmarks
// (e.g. the England datum). Handles signed values with a zero baseline when any
// value is negative, otherwise a left baseline. A null value renders as a
// gap-less zero-width bar with an "n/a" label (never a spurious zero bar).
export function BarChart({
  bars,
  valueSuffix = '',
  refLines = [],
  rowHeight = 26,
  labelWidth = 160,
  valueDp = 1,
}: Props) {
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

  // Clamp the label gutter to the measured width so labels and bars stay inside
  // the SVG canvas on narrow (phone-width) containers instead of overflowing off
  // the left edge: never let the fixed gutter exceed ~40% of the container.
  const labelW = Math.min(labelWidth, Math.max(width * 0.4, 60))
  const valueW = 56
  const plotW = Math.max(width - labelW - valueW, 40)
  const vals = bars.map((b) => b.value).filter((v): v is number => v != null)
  const refVals = refLines.map((r) => r.value)
  const minV = Math.min(0, ...vals, ...refVals)
  const maxV = Math.max(1, ...vals, ...refVals)
  const hasNeg = minV < 0
  const lo = hasNeg ? minV * 1.12 : 0
  const hi = maxV * 1.08
  const sx = (v: number) => ((v - lo) / (hi - lo)) * plotW
  const x0 = sx(0)
  const height = bars.length * rowHeight + 24

  return (
    <div ref={wrapRef}>
      <svg width={width} height={height} role="img" aria-label="ranked bars">
        {hasNeg && (
          <line
            x1={labelW + x0}
            x2={labelW + x0}
            y1={0}
            y2={bars.length * rowHeight}
            stroke="#cbd5e1"
            strokeWidth={1}
          />
        )}
        {refLines.map((r) => (
          <g key={`ref-${r.label}`}>
            <line
              x1={labelW + sx(r.value)}
              x2={labelW + sx(r.value)}
              y1={0}
              y2={bars.length * rowHeight}
              stroke={r.color}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              x={labelW + sx(r.value) + 3}
              y={bars.length * rowHeight + 14}
              fontSize="9"
              fill={r.color}
            >
              {r.label} {r.value.toFixed(valueDp)}
              {valueSuffix}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const y = i * rowHeight + 3
          const color = b.color ?? (b.role ? getGeoColor(b.role) : '#94a3b8')
          const v = b.value
          const barLeft = v == null ? labelW + x0 : labelW + Math.min(x0, sx(v))
          const barW = v == null ? 0 : Math.max(Math.abs(sx(v) - x0), 1)
          const labelX = v == null || v >= 0 ? barLeft + barW + 6 : barLeft - 6
          const labelAnchor = v == null || v >= 0 ? 'start' : 'end'
          return (
            <g key={b.id}>
              <text
                x={labelW - 8}
                y={y + rowHeight / 2}
                dy="0.32em"
                textAnchor="end"
                fontSize="11"
                fill={b.highlight ? '#0f172a' : '#475569'}
                fontWeight={b.highlight ? 700 : 400}
              >
                {b.label}
              </text>
              <rect
                x={barLeft}
                y={y}
                width={barW}
                height={rowHeight - 6}
                rx={2}
                fill={color}
                opacity={b.highlight ? 1 : 0.78}
                stroke={b.highlight ? '#0f172a' : 'none'}
                strokeWidth={b.highlight ? 1.5 : 0}
              />
              <text
                x={labelX}
                y={y + rowHeight / 2}
                dy="0.32em"
                textAnchor={labelAnchor}
                fontSize="10"
                fill="#475569"
              >
                {v == null ? NA : `${v.toFixed(valueDp)}${valueSuffix}`}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

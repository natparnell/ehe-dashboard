import { useRef, useState, useLayoutEffect } from 'react'
import { getGeoColor, type GeoRole } from '../../utils/colors'
import { niceTicks } from '../../utils/ticks'

export interface ScatterPoint {
  id: string
  label: string
  x: number
  y: number
  role?: GeoRole
  color?: string
  highlight?: boolean
}

interface Props {
  points: ScatterPoint[]
  xLabel: string
  yLabel: string
  fit?: { slope: number; intercept: number } | null
  height?: number
  xSuffix?: string
  ySuffix?: string
}

const M = { top: 14, right: 18, bottom: 42, left: 50 }

// A scatter plot with an optional OLS fit line and highlighted points (the
// footprint LAs). Used for the regional-honesty scatter (Unknown % vs mental
// health %) and any LA comparison scatter.
export function ScatterChart({
  points,
  xLabel,
  yLabel,
  fit,
  height = 360,
  xSuffix = '',
  ySuffix = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<ScatterPoint | null>(null)
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

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const padX = (xMax - xMin) * 0.06 || 1
  const padY = (yMax - yMin) * 0.06 || 1
  const xLo = xMin - padX
  const xHi = xMax + padX
  const yLo = yMin - padY
  const yHi = yMax + padY
  const innerW = Math.max(width - M.left - M.right, 10)
  const innerH = Math.max(height - M.top - M.bottom, 10)
  const sx = (x: number) => M.left + ((x - xLo) / (xHi - xLo)) * innerW
  const sy = (y: number) => M.top + (1 - (y - yLo) / (yHi - yLo)) * innerH

  function color(p: ScatterPoint): string {
    return p.color ?? (p.role ? getGeoColor(p.role) : '#cbd5e1')
  }

  return (
    <div ref={wrapRef} className="relative" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="scatter plot">
        {niceTicks(yLo, yHi, 5).map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke="#eef2f6" />
            <text
              x={M.left - 6}
              y={sy(t)}
              dy="0.32em"
              textAnchor="end"
              fontSize="9"
              fill="#64748b"
            >{`${t.toFixed(0)}${ySuffix}`}</text>
          </g>
        ))}
        {niceTicks(xLo, xHi, 6).map((t) => (
          <text
            key={`x${t}`}
            x={sx(t)}
            y={height - M.bottom + 14}
            textAnchor="middle"
            fontSize="9"
            fill="#64748b"
          >{`${t.toFixed(0)}${xSuffix}`}</text>
        ))}
        <text
          x={M.left + innerW / 2}
          y={height - 6}
          textAnchor="middle"
          fontSize="10"
          fill="#64748b"
        >
          {xLabel}
        </text>
        <text
          x={14}
          y={M.top + innerH / 2}
          transform={`rotate(-90 14 ${M.top + innerH / 2})`}
          textAnchor="middle"
          fontSize="10"
          fill="#64748b"
        >
          {yLabel}
        </text>
        {fit && (
          <line
            x1={sx(xLo)}
            y1={sy(fit.slope * xLo + fit.intercept)}
            x2={sx(xHi)}
            y2={sy(fit.slope * xHi + fit.intercept)}
            stroke="#64748b"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        )}
        {points.map((p) => (
          <circle
            key={p.id}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={p.highlight ? 6 : 3}
            fill={color(p)}
            opacity={p.highlight ? 1 : 0.6}
            stroke={p.highlight ? '#0f172a' : 'none'}
            strokeWidth={p.highlight ? 1.5 : 0}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-md"
          style={{ left: Math.min(sx(hover.x) + 8, width - 160), top: Math.max(sy(hover.y) - 30, 0) }}
        >
          <div className="font-semibold text-slate-700">{hover.label}</div>
          <div className="text-slate-500">
            {xLabel}: {hover.x.toFixed(1)}
            {xSuffix} &middot; {yLabel}: {hover.y.toFixed(1)}
            {ySuffix}
          </div>
        </div>
      )}
    </div>
  )
}

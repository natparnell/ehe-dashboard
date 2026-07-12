import { type ReactNode } from 'react'
import { NA } from '../utils/formatting'
import { DELTA_INK } from '../utils/colors'

// A headline KPI tile: a colour-coded top border, an uppercase micro-label, a
// big number, and an optional sub-line. Ports the essence of the old Dash
// cards.
//
// House rules:
//   - Rising EHE is NEUTRAL. Any delta renders in neutral ink (DELTA_INK) with
//     its explicit +/- sign already in the string; the card never colours a
//     delta green-for-good or red-for-bad.
//   - Zero is a value: pass "0" and it shows; only a genuinely missing value
//     should be passed as null, which renders "n/a".
interface Props {
  // The uppercase micro-label, e.g. "ENGLAND, AUTUMN 2025/26".
  label: string
  // The pre-formatted headline value (caller formats via formatting.ts), or
  // null for a suppressed / missing value.
  value: string | null
  // The accent colour for the top border (usually a geography colour).
  accent?: string
  // An optional pre-formatted, already-signed delta, e.g. "+0.5 vs 2024/25".
  delta?: string
  // An optional secondary line (a rate under a count, a caveat, etc.).
  sub?: ReactNode
}

export function KpiCard({ label, value, accent = '#475569', delta, sub }: Props) {
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      style={{ borderTopColor: accent, borderTopWidth: 3 }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value ?? NA}</div>
      {delta && (
        <div className="mt-1 text-sm font-medium" style={{ color: DELTA_INK }}>
          {delta}
        </div>
      )}
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

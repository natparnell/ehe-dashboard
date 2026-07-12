// Display formatting. House rules:
//   - null renders as "n/a" (never a dash, never "NaN"). ONLY null does.
//   - zero is a value: 0 renders as "0" / "0%" / "0.0", never "n/a".
//   - UK English, en-GB locale, DD/MM/YYYY dates, no em or en dashes anywhere.
//   - deltas carry an explicit +/- sign and are colour-NEUTRAL (rising EHE is
//     neither good nor bad; see colors.ts DELTA_INK).

import type { Cell, SuppressFlag } from '../types'

export const NA = 'n/a'

// A count with UK thousands separators, e.g. 14,600. Zero renders "0".
export function formatCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NA
  return value.toLocaleString('en-GB')
}

// A percentage, whole-number by default (EHE percentages are published to whole
// numbers). Zero renders "0%".
export function formatPercent(value: number | null | undefined, dp = 0): string {
  if (value == null || Number.isNaN(value)) return NA
  return `${value.toFixed(dp)}%`
}

// A rate per 100, one decimal place as published, e.g. "2.0". Zero renders "0.0".
export function formatRate(value: number | null | undefined, dp = 1): string {
  if (value == null || Number.isNaN(value)) return NA
  return value.toFixed(dp)
}

// A signed count delta with explicit sign, e.g. "+1,640", "-11,200".
export function formatSignedCount(delta: number | null | undefined): string {
  if (delta == null || Number.isNaN(delta)) return NA
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString('en-GB')}`
}

// A signed rate/percentage-point delta with explicit sign, e.g. "+0.5", "-0.2".
export function formatSignedRate(delta: number | null | undefined, dp = 1): string {
  if (delta == null || Number.isNaN(delta)) return NA
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(dp)}`
}

// A signed percentage-point delta, e.g. "+4pp", "-3pp".
export function formatSignedPp(delta: number | null | undefined, dp = 0): string {
  if (delta == null || Number.isNaN(delta)) return NA
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(dp)}pp`
}

// The human-readable meaning of a suppression flag (spec section 3.2 / 4.6).
export const FLAG_MEANING: Record<SuppressFlag, string> = {
  low: 'rounds to zero but is not zero',
  x: 'not available',
  z: 'not applicable',
}

// Render a suppression-aware Cell. A real value renders via `render`; a
// suppressed cell renders its published symbol so a table never shows a blank
// or a spurious zero. Pass a formatter for the value (formatCount by default).
export function formatCell(
  cell: Cell | null | undefined,
  render: (v: number) => string = formatCount,
): string {
  if (!cell) return NA
  if (cell.v == null) return cell.f ?? NA
  return render(cell.v)
}

// Render an ISO build timestamp as "DD/MM/YYYY HH:MM" in UK conventions.
export function formatBuildStamp(iso: string | null | undefined): string {
  if (!iso) return NA
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return NA
  const date = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return `${date} ${time}`
}

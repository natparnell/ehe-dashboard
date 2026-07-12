// Shared axis-tick helper. Factored out of the individual chart components so
// LineChart, BarChart and ScatterChart all compute "nice" ticks the same way.
// Returns rounded tick values covering [min, max] with roughly `count` steps,
// snapping the step to a 1/2/5 x 10^n magnitude.
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [min]
  const span = max - min
  const step0 = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag
  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

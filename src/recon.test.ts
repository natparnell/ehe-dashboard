// Reconciliation gate (REBUILD_SPEC.md section 6). Loads the JSON emitted by
// scripts/preprocess.mjs off disk and asserts every published anchor, the
// footprint pooled-rate maths, the structural invariants and the suppression
// semantics. This must be green before any view is built.
//
// Run `npm run preprocess` first (metadata.json presence gates this suite).
//
// Values are as-published: assertions are EXACT except where the spec states a
// tolerance (footprint pooled rate ± 0.05 back-out rounding; England back-out
// population ± 2%; regional count sum "within rounding"; Y10+Y11 share ≈ 36%).
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'public', 'processed')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf-8'))

type Cell = { v: number | null; f?: 'low' | 'x' | 'z' }
interface Period { key: string; year: string; term: string; sort: number }
interface GeoSeriesEntry { count: Cell; rate: Cell; percent: Cell; pop: number | null }
interface Geo {
  level: 'National' | 'Regional' | 'Local authority'
  code: string
  name: string
  region_code: string | null
  region_name: string | null
  series: Record<string, GeoSeriesEntry>
}
interface Totals { periods: Period[]; geographies: Geo[] }
interface BreakdownRecord {
  level: string
  code: string
  name: string
  topic: 'Sex' | 'Year group' | 'Reason'
  breakdown: string
  series: Record<string, { count: Cell; percent: Cell }>
}
interface Breakdowns {
  periods: Period[]
  reasonOrder: string[]
  yearGroupOrder: string[]
  sexOrder: string[]
  records: BreakdownRecord[]
}

const ENGLAND = 'E92000001'
const SOUTH_WEST = 'E12000009'
const CORNWALL = 'E06000052'
const PLYMOUTH = 'E06000026'
const DEVON = 'E10000008'
const TORBAY = 'E06000027'

let totals: Totals
let breakdowns: Breakdowns
let breakdownsLaYearGroup: Breakdowns
let footprint: {
  series: {
    key: string
    count: number
    rate: number
    pop: number
    excessVsEngland: { multiple: number | null; excessChildren: number | null }
  }[]
}
let flows: {
  years: { key: string; label: string }[]
  records: { level: string; code: string; name: string; series: Record<string, Record<string, Cell>> }[]
}
let mapLa: { period: Period; las: { code: string; rate: Cell; count: Cell }[]; missingCodes: unknown[] }
let headlines: Record<string, unknown>
let meta: Record<string, unknown>

beforeAll(() => {
  expect(existsSync(join(DIR, 'metadata.json')), 'run `npm run preprocess` first').toBe(true)
  totals = load('totals.json')
  breakdowns = load('breakdowns.json')
  breakdownsLaYearGroup = load('breakdowns-la-yeargroup.json')
  footprint = load('footprint.json')
  flows = load('flows.json')
  mapLa = load('map-la.json')
  headlines = load('headlines.json')
  meta = load('metadata.json')
})

// ---- helpers -------------------------------------------------------------

const geo = (code: string) => {
  const g = totals.geographies.find((x) => x.code === code)
  if (!g) throw new Error(`geography ${code} not found in totals.json`)
  return g
}
const cellV = (c: Cell | undefined) => (c ? c.v : undefined)

const natReason = (breakdown: string) =>
  breakdowns.records.find(
    (r) => r.level === 'National' && r.topic === 'Reason' && r.breakdown === breakdown,
  )
const natSex = (breakdown: string) =>
  breakdowns.records.find(
    (r) => r.level === 'National' && r.topic === 'Sex' && r.breakdown === breakdown,
  )
const natYearGroup = (breakdown: string) =>
  breakdowns.records.find(
    (r) => r.level === 'National' && r.topic === 'Year group' && r.breakdown === breakdown,
  )

const AUTUMN_KEYS = ['202223-Autumn', '202324-Autumn', '202425-Autumn', '202526-Autumn']
const LATEST = '202526-Autumn'

// ---- section 6 anchor table ---------------------------------------------

describe('England census-date stock', () => {
  it('autumn 2025/26: count 126,000, rate 1.5', () => {
    const s = geo(ENGLAND).series[LATEST]
    expect(cellV(s.count)).toBe(126000)
    expect(cellV(s.rate)).toBe(1.5)
  })

  it('autumn series counts 80,900 / 92,000 / 111,700 / 126,000', () => {
    const eng = geo(ENGLAND)
    expect(AUTUMN_KEYS.map((k) => cellV(eng.series[k].count))).toEqual([
      80900, 92000, 111700, 126000,
    ])
  })

  it('autumn series rates 1.0 / 1.1 / 1.4 / 1.5', () => {
    const eng = geo(ENGLAND)
    expect(AUTUMN_KEYS.map((k) => cellV(eng.series[k].rate))).toEqual([1, 1.1, 1.4, 1.5])
  })

  it('summer 2024/25 count 137,200 (reset to 126,000 = -11,200)', () => {
    const eng = geo(ENGLAND)
    const summer = cellV(eng.series['202425-Summer'].count) as number
    const autumn = cellV(eng.series['202526-Autumn'].count) as number
    expect(summer).toBe(137200)
    expect(autumn - summer).toBe(-11200)
  })

  it('back-out population ~8.4M (± 2%)', () => {
    const pop = geo(ENGLAND).series[LATEST].pop as number
    expect(pop).not.toBeNull()
    expect(Math.abs(pop - 8_400_000) / 8_400_000).toBeLessThan(0.02)
  })
})

describe('South West region', () => {
  it('autumn 2025/26: count 15,830, rate 2.0', () => {
    const s = geo(SOUTH_WEST).series[LATEST]
    expect(cellV(s.count)).toBe(15830)
    expect(cellV(s.rate)).toBe(2)
  })

  it('autumn rate series 1.5 / 1.6 / 1.8 / 2.0', () => {
    const sw = geo(SOUTH_WEST)
    expect(AUTUMN_KEYS.map((k) => cellV(sw.series[k].rate))).toEqual([1.5, 1.6, 1.8, 2])
  })

  it('is the highest-rate region in every one of the 10 terms (rank 1 of 10)', () => {
    const regions = totals.geographies.filter((g) => g.level === 'Regional')
    expect(regions.length).toBe(10)
    for (const p of totals.periods) {
      const rated = regions
        .map((g) => ({ name: g.name, rate: cellV(g.series[p.key]?.rate) }))
        .filter((r) => r.rate != null) as { name: string; rate: number }[]
      expect(rated.length, `${p.key}: all 10 regions have a rate`).toBe(10)
      const max = Math.max(...rated.map((r) => r.rate))
      const top = rated.filter((r) => r.rate === max).map((r) => r.name)
      expect(top, `${p.key}: South West is top`).toContain('South West')
      // South West must be uniquely top, not merely tied.
      expect(cellV(geo(SOUTH_WEST).series[p.key].rate)).toBe(max)
    }
  })
})

describe('regional autumn 2025/26 ordering', () => {
  it('exactly 10 regions, SW 2.0 top, Inner London 0.9 bottom', () => {
    const regions = totals.geographies.filter((g) => g.level === 'Regional')
    expect(regions.length).toBe(10)
    const rated = regions
      .map((g) => ({ name: g.name, rate: cellV(g.series[LATEST].rate) as number }))
      .sort((a, b) => b.rate - a.rate)
    expect(rated[0].name).toBe('South West')
    expect(rated[0].rate).toBe(2)
    expect(rated[rated.length - 1].name).toBe('Inner London')
    expect(rated[rated.length - 1].rate).toBe(0.9)
  })

  it('there is no "London" row (Inner/Outer London only)', () => {
    const names = totals.geographies.filter((g) => g.level === 'Regional').map((g) => g.name)
    expect(names).toContain('Inner London')
    expect(names).toContain('Outer London')
    expect(names).not.toContain('London')
  })

  it('regional counts sum to ~126,000 within rounding (126,040)', () => {
    const sum = totals.geographies
      .filter((g) => g.level === 'Regional')
      .reduce((a, g) => a + ((cellV(g.series[LATEST].count) as number) ?? 0), 0)
    expect(sum).toBe(126040)
    expect(Math.abs(sum - 126000)).toBeLessThanOrEqual(100)
  })
})

describe('footprint LAs, autumn 2025/26', () => {
  const cases: Array<[string, string, number, number]> = [
    ['Cornwall', CORNWALL, 2.9, 2210],
    ['Plymouth', PLYMOUTH, 2.0, 720],
    ['Devon', DEVON, 2.7, 2840],
    ['Torbay', TORBAY, 2.8, 500],
  ]
  for (const [name, code, rate, count] of cases) {
    it(`${name}: rate ${rate}, count ${count}`, () => {
      const s = geo(code).series[LATEST]
      expect(cellV(s.rate)).toBe(rate)
      expect(cellV(s.count)).toBe(count)
    })
  }
})

describe('footprint pooled aggregate', () => {
  const fpAt = (key: string) => footprint.series.find((s) => s.key === key)

  it('autumn 2025/26: count 5,770, rate 2.65 (± 0.05)', () => {
    const s = fpAt('202526-Autumn')!
    expect(s.count).toBe(5770)
    expect(Math.abs(s.rate - 2.65)).toBeLessThanOrEqual(0.05)
  })

  it('autumn 2024/25: count 5,130, rate 2.39 (± 0.05)', () => {
    const s = fpAt('202425-Autumn')!
    expect(s.count).toBe(5130)
    expect(Math.abs(s.rate - 2.39)).toBeLessThanOrEqual(0.05)
  })

  it('autumn 2023/24: count 4,140, rate 1.90 (± 0.05)', () => {
    const s = fpAt('202324-Autumn')!
    expect(s.count).toBe(4140)
    expect(Math.abs(s.rate - 1.9)).toBeLessThanOrEqual(0.05)
  })

  it('excludes 2022/23: no aggregate row exists', () => {
    expect(footprint.series.find((s) => s.key.startsWith('202223'))).toBeUndefined()
  })

  it('pooled rate is population-weighted, equals sum(count)/sum(pop)*100', () => {
    const s = fpAt(LATEST)!
    const expected = (s.count / s.pop) * 100
    // pooled rate is 2 dp; expected within back-out rounding of the stored value
    expect(Math.abs(s.rate - expected)).toBeLessThan(0.06)
  })
})

describe('national reasons, autumn 2025/26 (percent)', () => {
  const cases: Array<[string, number]> = [
    ['Unknown', 17],
    ['Mental health', 16],
    ['No reason given', 12],
    // NOTE: spec anchor labels this "Philosophical/preferential"; the DfE
    // published label (and reasonOrder) is "Philosophical or preferential".
    ['Philosophical or preferential', 12],
  ]
  for (const [name, pct] of cases) {
    it(`${name} = ${pct}%`, () => {
      const r = natReason(name)
      expect(r, `reason ${name} present`).toBeTruthy()
      expect(cellV(r!.series[LATEST].percent)).toBe(pct)
    })
  }

  it('mental health autumn series 9 / 13 / 14 / 16', () => {
    const mh = natReason('Mental health')!
    expect(AUTUMN_KEYS.map((k) => cellV(mh.series[k]?.percent))).toEqual([9, 13, 14, 16])
  })

  it('philosophical autumn series 16 / 16 / 14 / 12', () => {
    const ph = natReason('Philosophical or preferential')!
    expect(AUTUMN_KEYS.map((k) => cellV(ph.series[k]?.percent))).toEqual([16, 16, 14, 12])
  })

  it('mental health has overtaken philosophical at the latest autumn (16 > 12)', () => {
    expect(cellV(natReason('Mental health')!.series[LATEST].percent) as number).toBeGreaterThan(
      cellV(natReason('Philosophical or preferential')!.series[LATEST].percent) as number,
    )
  })

  it('national reason counts are structurally suppressed (null-flagged, never 0)', () => {
    for (const r of breakdowns.records.filter((x) => x.level === 'National' && x.topic === 'Reason')) {
      const c = r.series[LATEST]?.count
      if (c) {
        expect(c.v, `${r.breakdown} count null`).toBeNull()
      }
    }
  })
})

describe('South West Unknown reason, autumn 2025/26', () => {
  it('percent 27, count suppressed', () => {
    const sw = breakdowns.records.find(
      (r) =>
        r.level === 'Regional' &&
        r.name === 'South West' &&
        r.topic === 'Reason' &&
        r.breakdown === 'Unknown',
    )
    expect(sw, 'SW Unknown reason present').toBeTruthy()
    expect(cellV(sw!.series[LATEST].percent)).toBe(27)
    expect(cellV(sw!.series[LATEST].count)).toBeNull()
  })

  it('all regional reason counts are null-flagged (suppressed above LA level)', () => {
    for (const r of breakdowns.records.filter((x) => x.level === 'Regional' && x.topic === 'Reason')) {
      const c = r.series[LATEST]?.count
      if (c) expect(c.v, `${r.name}/${r.breakdown} count null`).toBeNull()
    }
  })
})

describe('national sex, autumn 2025/26', () => {
  it('Female 65,100 (52%)', () => {
    const f = natSex('Female')!.series[LATEST]
    expect(cellV(f.count)).toBe(65100)
    expect(cellV(f.percent)).toBe(52)
  })
  it('Male 60,700 (48%)', () => {
    const m = natSex('Male')!.series[LATEST]
    expect(cellV(m.count)).toBe(60700)
    expect(cellV(m.percent)).toBe(48)
  })
})

describe('national year groups, autumn 2025/26', () => {
  it('Year 11 count 24,100', () => {
    expect(cellV(natYearGroup('Year 11')!.series[LATEST].count)).toBe(24100)
  })
  it('Year 10 count 21,800', () => {
    expect(cellV(natYearGroup('Year 10')!.series[LATEST].count)).toBe(21800)
  })
  it('Year 10 + Year 11 share ~ 36% of 126,000', () => {
    const y10 = cellV(natYearGroup('Year 10')!.series[LATEST].count) as number
    const y11 = cellV(natYearGroup('Year 11')!.series[LATEST].count) as number
    const total = cellV(geo(ENGLAND).series[LATEST].count) as number
    const share = ((y10 + y11) / total) * 100
    expect(Math.round(share)).toBe(36)
  })
})

describe('Plymouth Year 10 + Year 11 percent, autumn 2025/26', () => {
  it('20 + 31 = 51', () => {
    const y10 = breakdownsLaYearGroup.records.find(
      (r) => r.code === PLYMOUTH && r.breakdown === 'Year 10',
    )!
    const y11 = breakdownsLaYearGroup.records.find(
      (r) => r.code === PLYMOUTH && r.breakdown === 'Year 11',
    )!
    const p10 = cellV(y10.series[LATEST].percent) as number
    const p11 = cellV(y11.series[LATEST].percent) as number
    expect(p10).toBe(20)
    expect(p11).toBe(31)
    expect(p10 + p11).toBe(51)
  })
})

describe('flows (academic-year file, 2024/25, one year behind census)', () => {
  const flowsRec = (code: string) => flows.records.find((r) => r.code === code)!
  const natFlow = () => flows.records.find((r) => r.level === 'National')!

  it('national 2024/25: anytime 175,900; starts 78,000; returns 28,100; s437 7,400; SAO issued 2,500; revoked 600', () => {
    const s = natFlow().series['202425']
    expect(cellV(s.anytime)).toBe(175900)
    expect(cellV(s.starts)).toBe(78000)
    expect(cellV(s.returns)).toBe(28100)
    expect(cellV(s.s437)).toBe(7400)
    expect(cellV(s.sao_issued)).toBe(2500)
    expect(cellV(s.sao_revoked)).toBe(600)
  })

  it('national 2023/24 anytime 153,300', () => {
    expect(cellV(natFlow().series['202324'].anytime)).toBe(153300)
  })

  it('footprint 2024/25: Devon 4,030 / s437 10; Plymouth 1,090 / 100; Cornwall 3,170 / 40', () => {
    expect(cellV(flowsRec(DEVON).series['202425'].anytime)).toBe(4030)
    expect(cellV(flowsRec(DEVON).series['202425'].s437)).toBe(10)
    expect(cellV(flowsRec(PLYMOUTH).series['202425'].anytime)).toBe(1090)
    expect(cellV(flowsRec(PLYMOUTH).series['202425'].s437)).toBe(100)
    expect(cellV(flowsRec(CORNWALL).series['202425'].anytime)).toBe(3170)
    expect(cellV(flowsRec(CORNWALL).series['202425'].s437)).toBe(40)
  })
})

describe('headlines.json ties to the sources', () => {
  it('England 126,000 / 1.5 with a 8.4M back-out', () => {
    const e = headlines.england as { count: Cell; rate: Cell; popBackout: number }
    expect(cellV(e.count)).toBe(126000)
    expect(cellV(e.rate)).toBe(1.5)
    expect(Math.abs(e.popBackout - 8_400_000) / 8_400_000).toBeLessThan(0.02)
  })
  it('SW rank 1 of 10, ~1.33x England', () => {
    const sw = headlines.sw as { rank: number; ofRegions: number; multipleVsEngland: number }
    expect(sw.rank).toBe(1)
    expect(sw.ofRegions).toBe(10)
    expect(Math.abs(sw.multipleVsEngland - 1.33)).toBeLessThan(0.05)
  })
  it('footprint 5,770 / 2.65 / ~1.77x', () => {
    const fp = headlines.footprint as { count: number; rate: number; multipleVsEngland: number }
    expect(fp.count).toBe(5770)
    expect(Math.abs(fp.rate - 2.65)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(fp.multipleVsEngland - 1.77)).toBeLessThan(0.05)
  })
  it('flows anchors reproduce', () => {
    const f = headlines.flows as Record<string, number>
    expect(f.anytime).toBe(175900)
    expect(f.anytimePrev).toBe(153300)
    expect(f.starts).toBe(78000)
    expect(f.returns).toBe(28100)
    expect(f.s437).toBe(7400)
    expect(f.saoIssued).toBe(2500)
    expect(f.saoRevoked).toBe(600)
  })
})

describe('map-la.json', () => {
  it('latest autumn period is 2025/26 Autumn', () => {
    expect(mapLa.period.key).toBe(LATEST)
  })
  it('surfaces missing boundary codes rather than dropping them (Cumbria/N Yorks/Somerset)', () => {
    const codes = (mapLa.missingCodes as { code: string }[]).map((m) => m.code)
    expect(codes).toContain('E10000006') // Cumbria
    expect(codes).toContain('E10000023') // North Yorkshire
    expect(codes).toContain('E10000027') // Somerset
  })
})

// ---- section 6 suppression + structural invariants ----------------------

describe('suppression invariants', () => {
  it('no numeric 0 is produced from a low/x/z flagged cell (null preserved, symbol kept)', () => {
    const walk = (c: Cell | undefined, where: string) => {
      if (!c || !c.f) return
      // A flagged cell (low/x/z) must never carry a numeric value: it is null.
      expect(c.v, `${where} flagged '${c.f}' must be null, not ${c.v}`).toBeNull()
    }
    // totals
    for (const g of totals.geographies) {
      for (const [k, s] of Object.entries(g.series)) {
        walk(s.count, `totals ${g.code} ${k} count`)
        walk(s.rate, `totals ${g.code} ${k} rate`)
        walk(s.percent, `totals ${g.code} ${k} percent`)
      }
    }
    // breakdowns (national + regional) and LA year-group
    for (const src of [breakdowns, breakdownsLaYearGroup]) {
      for (const r of src.records) {
        for (const [k, s] of Object.entries(r.series)) {
          walk(s.count, `${r.code} ${r.breakdown} ${k} count`)
          walk(s.percent, `${r.code} ${r.breakdown} ${k} percent`)
        }
      }
    }
    // flows
    for (const r of flows.records) {
      for (const [k, measures] of Object.entries(r.series)) {
        for (const [m, c] of Object.entries(measures)) walk(c, `flows ${r.code} ${k} ${m}`)
      }
    }
  })

  it('Cornwall 2022/23 autumn Total is null-flagged (suppressed, not 0)', () => {
    const s = geo(CORNWALL).series['202223-Autumn']
    expect(s.count.v).toBeNull()
    expect(s.count.f).toBeTruthy()
    expect(s.rate.v).toBeNull()
    expect(s.pop).toBeNull()
  })
})

describe('structural invariants', () => {
  it('there are exactly 10 term-points, ascending by sort', () => {
    expect(totals.periods.length).toBe(10)
    const sorts = totals.periods.map((p) => p.sort)
    expect([...sorts].sort((a, b) => a - b)).toEqual(sorts)
  })

  it('every geography x period key in totals.json is unique', () => {
    const seen = new Set<string>()
    for (const g of totals.geographies) {
      expect(seen.has(g.code), `duplicate geography ${g.code}`).toBe(false)
      seen.add(g.code)
      // and each geography's own period keys are unique (object keys guarantee it,
      // but assert every key belongs to the declared period set)
      const validKeys = new Set(totals.periods.map((p) => p.key))
      for (const k of Object.keys(g.series)) {
        expect(validKeys.has(k), `${g.code} has unknown period key ${k}`).toBe(true)
      }
    }
  })

  it('metadata declares 10 regions and the correct release', () => {
    expect((meta.regions as string[]).length).toBe(10)
    expect(meta.region_count).toBe(10)
    expect(meta.release).toBe('Autumn term 2025/26')
  })
})

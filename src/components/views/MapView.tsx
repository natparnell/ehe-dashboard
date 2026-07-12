import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import { scaleSqrt } from 'd3-scale'
import { schemeBlues } from 'd3-scale-chromatic'
import type { Cell } from '../../types'
import { ChartCard } from '../ChartCard'
import { getGeoColor } from '../../utils/colors'
import { formatCount, formatCell, formatRate, NA } from '../../utils/formatting'
import { DFE_RELEASE_URL } from '../../constants'
import { loadProcessed } from '../../services/dataService'

// ---------------------------------------------------------------------------
// LA Map view (spec section 5.5). A choropleth of the latest-autumn EHE rate
// per local authority over the ONS December 2023 CTYUA boundaries, joined on
// properties.code === las[].code, PLUS the mandatory paired sortable ranked
// table (values as text, suppression hatched) so the map is never a map-only
// channel. Colour AND blob area both encode the rate, so colour is not the only
// visual channel. Rising EHE is neutral: a single-hue sequential ramp (darker =
// higher), never a good/bad diverging scale.
//
// Hard methodology rules honoured here:
//  - 4.1/4.4 Term is first-class: this is ONE census term-point (latest autumn),
//    labelled as such; the census resets each September so it is not comparable
//    term-to-term.
//  - 4.2 Rates are as-published, never recomputed or averaged.
//  - 4.6 Suppression to null with symbol preserved: suppressed LAs are hatched
//    (never blank, never zero) and the table shows the published symbol.
//  - 4.9 Footprint proxy: the footprint LAs are ringed and labelled LA-area
//    children, not WeST pupils.
//  - 4.10 Collection maturity caveat panel.
//  - 3.3(6) missingCodes surfaced in an amber notice, never silently dropped.
// ---------------------------------------------------------------------------

const FOOTPRINT_CODES = new Set(['E06000052', 'E06000026', 'E10000008']) // Cornwall, Plymouth, Devon

interface MapLaRecord {
  code: string
  la_name: string
  region_name: string | null
  rate: Cell
  count: Cell
}
interface MapLa {
  period: { key: string; year: string; term: string }
  join: string
  las: MapLaRecord[]
  missingCodes: { code: string; la_name: string }[]
}

interface GeoFeature {
  type: 'Feature'
  properties: { code: string; name: string }
  geometry: unknown
}
interface GeoData {
  type: 'FeatureCollection'
  features: GeoFeature[]
}

type MapMode = 'choropleth' | 'blobs' | 'both'
type SortKey = 'rate' | 'count' | 'name'

const RATE_SUFFIX = ' per 100'

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function MapView() {
  const [mapLa, setMapLa] = useState<MapLa | null>(null)
  const [dataError, setDataError] = useState(false)
  const [geo, setGeo] = useState<GeoData | null>(null)
  const [geoError, setGeoError] = useState(false)

  const [mode, setMode] = useState<MapMode>('both')
  const [zoomSW, setZoomSW] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('rate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [hover, setHover] = useState<{ name: string; cell: Cell; x: number; y: number } | null>(null)

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

  useEffect(() => {
    let alive = true
    void loadProcessed<MapLa>('map-la.json').then((d) => {
      if (!alive) return
      if (d) setMapLa(d)
      else setDataError(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    fetch('/geo/ctyua_2023_buc.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('geo'))))
      .then((d: GeoData) => alive && setGeo(d))
      .catch(() => alive && setGeoError(true))
    return () => {
      alive = false
    }
  }, [])

  // Rate per LA code (the mapped measure). Suppressed / absent = null.
  const rateByCode = useMemo(() => {
    const m = new Map<string, number | null>()
    if (!mapLa) return m
    for (const r of mapLa.las) m.set(r.code, r.rate.v)
    return m
  }, [mapLa])

  // South West LA codes, derived from the data (for the zoom toggle).
  const swCodes = useMemo(() => {
    const s = new Set<string>()
    if (!mapLa) return s
    for (const r of mapLa.las) if (r.region_name === 'South West') s.add(r.code)
    return s
  }, [mapLa])

  const height = 560
  const { path, centroids, colorFor, rScale, breaks } = useMemo(() => {
    if (!geo)
      return {
        path: null,
        centroids: new Map<string, [number, number]>(),
        colorFor: (v: number | null): string | null => (v == null ? null : null),
        rScale: (v: number): number => v * 0,
        breaks: [] as number[],
      }
    const focus = zoomSW ? geo.features.filter((f) => swCodes.has(f.properties.code)) : geo.features
    const fc = { type: 'FeatureCollection', features: focus.length ? focus : geo.features } as GeoData
    // Inset the fit by the largest blob radius so blobs on coastal/edge LAs are
    // not clipped (e.g. the Isles of Scilly in the far south west).
    const pad = 40
    const projection = geoMercator().fitExtent(
      [
        [pad, pad],
        [Math.max(width - pad, pad + 10), Math.max(height - pad, pad + 10)],
      ],
      fc as never,
    )
    const p = geoPath(projection as never)
    const cents = new Map<string, [number, number]>()
    for (const f of geo.features) cents.set(f.properties.code, p.centroid(f as never) as [number, number])

    const vals = [...rateByCode.values()].filter((v): v is number => v != null)
    const sorted = [...vals].sort((a, b) => a - b)
    const brk = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(sorted, q))
    const scheme = schemeBlues[5]
    const cf = (v: number | null): string | null => {
      if (v == null) return null
      let i = 0
      while (i < brk.length && v > brk[i]) i++
      return scheme[i]
    }
    const maxV = sorted.length ? sorted[sorted.length - 1] : 1
    const rs = scaleSqrt().domain([0, maxV]).range([0, 24])
    return { path: p, centroids: cents, colorFor: cf, rScale: rs, breaks: brk }
  }, [geo, width, rateByCode, zoomSW, swCodes])

  // Code-join: data codes with a live value but no boundary feature. Merge the
  // preprocessed missingCodes (authoritative) with any live-unmatched code.
  const missing = useMemo(() => {
    const out = new Map<string, string>()
    if (mapLa) for (const m of mapLa.missingCodes) out.set(m.code, m.la_name)
    if (geo && mapLa) {
      const geoCodes = new Set(geo.features.map((f) => f.properties.code))
      for (const r of mapLa.las) {
        if ((r.rate.v != null || r.count.v != null) && !geoCodes.has(r.code)) out.set(r.code, r.la_name)
      }
    }
    return [...out.entries()].map(([code, la_name]) => ({ code, la_name }))
  }, [geo, mapLa])

  // Ranked table rows (all LAs, suppressed sort to the end). Sort is stable and
  // suppression-aware: nulls always trail regardless of direction.
  const tableRows = useMemo(() => {
    if (!mapLa) return []
    const rows = mapLa.las.map((r) => ({
      code: r.code,
      name: r.la_name,
      region: r.region_name,
      rate: r.rate,
      count: r.count,
      footprint: FOOTPRINT_CODES.has(r.code),
    }))
    const num = (c: Cell) => c.v
    rows.sort((a, b) => {
      if (sortKey === 'name') {
        return sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      }
      const av = sortKey === 'rate' ? num(a.rate) : num(a.count)
      const bv = sortKey === 'rate' ? num(b.rate) : num(b.count)
      if (av == null && bv == null) return a.name.localeCompare(b.name)
      if (av == null) return 1 // nulls last
      if (bv == null) return -1
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return rows
  }, [mapLa, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null
    return <span aria-hidden="true"> {sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  if (dataError) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Map data could not be loaded. Run <code>npm run preprocess</code> to generate
        <code> public/processed/map-la.json</code>.
      </div>
    )
  }
  if (!mapLa) return <div className="p-8 text-sm text-slate-500">Loading map data...</div>

  const periodLabel = `${mapLa.period.term.toLowerCase()} ${mapLa.period.year}`

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">
        Elective home education rate per 100 children by local authority, {periodLabel}. Rates are as
        published by the DfE (the number in EHE per 100 of the 5 to 16 population) and are never
        recomputed here. Colour and blob area both encode the rate; every value is also in the ranked
        table below, so the map is never the only channel.
      </p>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="map style">
          {(['choropleth', 'blobs', 'both'] as MapMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={
                'px-3 py-1.5 text-sm capitalize ' +
                (mode === m ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
              }
            >
              {m}
            </button>
          ))}
        </div>
        <button
          onClick={() => setZoomSW((z) => !z)}
          aria-pressed={zoomSW}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          {zoomSW ? 'Reset to England' : 'Zoom to South West'}
        </button>
      </div>

      <ChartCard
        title={`EHE rate per 100 by local authority, ${periodLabel}`}
        subtitle="Census-date stock, one term-point. Blob area is proportional to the rate; the footprint LAs (Cornwall, Plymouth, Devon) are ringed. Suppressed LAs are hatched, never zero"
        downloadName={`ehe-la-map-${mapLa.period.key}`}
        footnote={
          <>
            A single census term-point: the EHE census rises within a year and resets each September,
            so this map is not comparable term-to-term. Colour darkens with the rate and blob area
            encodes it too, so colour is not the only channel; the ranked table below carries every
            value as text. Suppressed local authorities are hatched, never shown as zero: &lsquo;low&rsquo;
            rounds to zero but is not zero, &lsquo;x&rsquo; is not available. The footprint LAs are ringed
            in red and represent LA-area children, not WeST pupils.
          </>
        }
      >
        <div ref={wrapRef} className="relative">
          {geoError ? (
            <div className="p-6 text-sm text-slate-500">
              Map boundary not available; use the ranked table below.
            </div>
          ) : !geo || !path ? (
            <div className="p-6 text-sm text-slate-500">Loading boundary...</div>
          ) : (
            <svg width={width} height={height} role="img" aria-label={`Local authority EHE rate map, ${periodLabel}`}>
              <defs>
                <pattern
                  id="ehe-suppressed-hatch"
                  width="6"
                  height="6"
                  patternTransform="rotate(45)"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="6" height="6" fill="#f1f5f9" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="#cbd5e1" strokeWidth="1.5" />
                </pattern>
              </defs>
              {/* base fills */}
              {geo.features.map((f) => {
                const v = rateByCode.get(f.properties.code) ?? null
                let fill: string
                if (mode === 'choropleth') {
                  fill = colorFor(v) ?? 'url(#ehe-suppressed-hatch)'
                } else if (mode === 'both') {
                  // Light base under the blobs, but keep suppressed LAs hatched so
                  // they are visibly missing rather than reading as a low value.
                  fill = v == null ? 'url(#ehe-suppressed-hatch)' : '#f1f5f9'
                } else {
                  // blobs mode
                  fill = v == null ? 'url(#ehe-suppressed-hatch)' : '#f1f5f9'
                }
                const cent = centroids.get(f.properties.code)
                return (
                  <path
                    key={f.properties.code}
                    d={path(f as never) ?? ''}
                    fill={fill}
                    stroke="#fff"
                    strokeWidth={0.4}
                    onMouseEnter={
                      cent
                        ? () =>
                            setHover({
                              name: f.properties.name,
                              cell: { v },
                              x: cent[0],
                              y: cent[1],
                            })
                        : undefined
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                )
              })}
              {/* footprint rings */}
              {geo.features
                .filter((f) => FOOTPRINT_CODES.has(f.properties.code))
                .map((f) => (
                  <path
                    key={`ring-${f.properties.code}`}
                    d={path(f as never) ?? ''}
                    fill="none"
                    stroke={getGeoColor('footprint')}
                    strokeWidth={2}
                  />
                ))}
              {/* blobs */}
              {(mode === 'blobs' || mode === 'both') &&
                geo.features.map((f) => {
                  const v = rateByCode.get(f.properties.code) ?? null
                  const c = centroids.get(f.properties.code)
                  if (!c || v == null) return null
                  const r = rScale(v)
                  if (r <= 0) return null
                  const fp = FOOTPRINT_CODES.has(f.properties.code)
                  const cell: Cell = { v }
                  return (
                    <circle
                      key={`blob-${f.properties.code}`}
                      cx={c[0]}
                      cy={c[1]}
                      r={r}
                      fill={fp ? getGeoColor('footprint') : '#1d4ed8'}
                      fillOpacity={fp ? 0.7 : 0.45}
                      stroke={fp ? '#0f172a' : '#1e40af'}
                      strokeWidth={fp ? 1.2 : 0.4}
                      onMouseEnter={() => setHover({ name: f.properties.name, cell, x: c[0], y: c[1] })}
                      onMouseLeave={() => setHover(null)}
                    />
                  )
                })}
            </svg>
          )}
          {hover && (
            <div
              className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-md"
              style={{ left: Math.min(hover.x + 8, width - 160), top: Math.max(hover.y - 28, 0) }}
            >
              <span className="font-semibold text-slate-700">{hover.name}</span>:{' '}
              {formatCell(hover.cell, (n) => `${formatRate(n)}${RATE_SUFFIX}`)}
            </div>
          )}
          {geo && !geoError && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span>Lower</span>
              {schemeBlues[5].map((c, i) => (
                <span key={c} className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-5" style={{ background: c }} />
                  {breaks[i] != null ? formatRate(breaks[i]) : ''}
                </span>
              ))}
              <span>Higher</span>
              <span className="ml-2 inline-flex items-center gap-1">
                <span
                  className="inline-block h-3 w-5"
                  style={{ background: 'url(#ehe-suppressed-hatch)', backgroundColor: '#f1f5f9' }}
                />{' '}
                suppressed
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-3 w-3 rounded-full ring-2"
                  style={{ background: 'transparent', color: getGeoColor('footprint'), boxShadow: `0 0 0 2px ${getGeoColor('footprint')}` }}
                />{' '}
                footprint LA
              </span>
            </div>
          )}
        </div>
      </ChartCard>

      {missing.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {missing.length} local authorit{missing.length === 1 ? 'y' : 'ies'} in the data{' '}
          {missing.length === 1 ? 'has' : 'have'} no boundary on the December 2023 map (April 2023
          local-government-reorganisation codes absent from that boundary vintage):{' '}
          {missing.map((m) => m.la_name).join(', ')}. They are surfaced here (never silently dropped)
          but are not drawn on the map; abolished pre-reorganisation county codes carry no current-period
          data and are kept out of the ranked table.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:break-inside-avoid">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">
          Ranked local authorities (every value as text)
        </h2>
        <p className="mb-2 text-xs text-slate-500">
          {tableRows.length} local authorities, {periodLabel}. Suppressed cells show the published
          symbol (&lsquo;low&rsquo; rounds to zero but is not zero, &lsquo;x&rsquo; not available,
          &lsquo;z&rsquo; not applicable), never a blank or a spurious zero. Footprint LAs are
          highlighted.
        </p>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Elective home education rate and count by local authority, {periodLabel}, sortable
            </caption>
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="py-1.5 pr-3">
                  Rank
                </th>
                <th scope="col" className="py-1.5 pr-3">
                  <button
                    onClick={() => toggleSort('name')}
                    className="uppercase tracking-wide hover:text-slate-800"
                    aria-label="Sort by local authority name"
                  >
                    Local authority{sortIndicator('name')}
                  </button>
                </th>
                <th scope="col" className="py-1.5 pr-3">
                  Region
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right">
                  <button
                    onClick={() => toggleSort('rate')}
                    className="uppercase tracking-wide hover:text-slate-800"
                    aria-label="Sort by rate per 100"
                  >
                    Rate per 100{sortIndicator('rate')}
                  </button>
                </th>
                <th scope="col" className="py-1.5 text-right">
                  <button
                    onClick={() => toggleSort('count')}
                    className="uppercase tracking-wide hover:text-slate-800"
                    aria-label="Sort by count"
                  >
                    Count{sortIndicator('count')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r, i) => {
                const rateSuppressed = r.rate.v == null
                const countSuppressed = r.count.v == null
                return (
                  <tr
                    key={r.code}
                    className={'border-b border-slate-100 ' + (r.footprint ? 'bg-red-50' : '')}
                  >
                    <td className="py-1 pr-3 text-slate-400">{i + 1}</td>
                    <td
                      className={
                        'py-1 pr-3 ' + (r.footprint ? 'font-semibold text-red-900' : 'text-slate-700')
                      }
                    >
                      {r.name}
                    </td>
                    <td className="py-1 pr-3 text-slate-500">{r.region ?? NA}</td>
                    <td
                      className={
                        'py-1 pr-3 text-right font-medium ' +
                        (rateSuppressed ? 'italic text-slate-400' : 'text-slate-900')
                      }
                      title={rateSuppressed ? r.rate.f : undefined}
                    >
                      {formatCell(r.rate, formatRate)}
                    </td>
                    <td
                      className={
                        'py-1 text-right ' + (countSuppressed ? 'italic text-slate-400' : 'text-slate-700')
                      }
                      title={countSuppressed ? r.count.f : undefined}
                    >
                      {formatCell(r.count, formatCount)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600 print:break-inside-avoid">
        <p className="font-semibold text-slate-700">Reading this map</p>
        <p className="mt-1">
          These are official statistics in development. EHE recording became mandatory from autumn
          2024, having been voluntary (with a 93 to 100 per cent response rate) from autumn 2022, so
          part of the apparent growth between authorities and over time is improved coverage rather
          than more children. Rates use the ONS mid-year 5 to 16 population as the denominator and
          are published to one decimal place; small differences between authorities can reflect
          recording practice as much as real difference. Never compare this autumn snapshot against a
          spring or summer census: the count rises within the school year and resets each September.
        </p>
        <p className="mt-2">
          Source:{' '}
          <a href={DFE_RELEASE_URL} className="text-blue-700 underline" target="_blank" rel="noreferrer">
            DfE, Elective home education
          </a>
          . Open Government Licence v3.0.
        </p>
        <p className="mt-1">
          Boundaries: Counties and Unitary Authorities (December 2023) from the ONS Open Geography Portal.
          Source: Office for National Statistics licensed under the Open Government Licence v3.0. Contains OS
          data (c) Crown copyright and database right 2023.
        </p>
      </div>
    </div>
  )
}

// @vitest-environment jsdom
// Render smoke tests: mount each of the 10 views against the REAL generated JSON
// and assert it renders without throwing and surfaces a distinctive fragment.
// This catches runtime errors (null access, bad selection, chart maths) that the
// typecheck and the recon suite cannot see. Ported from the NEETS dashboard
// pattern, adapted for this app's self-loading views (they fetch their own data
// via dataService rather than receiving it as props).
//
// The views load asynchronously through the real dataService, so we:
//   1. stub ResizeObserver (jsdom lacks it; the SVG charts need it present),
//   2. serve /processed/** and /geo/** from disk via a fetch shim, and
//   3. prime the dataService version gate by calling loadMetadata() once,
// then waitFor each view's post-load fragment.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadMetadata } from './services/dataService'
import { HeadlinesView } from './components/views/HeadlinesView'
import { NationalView } from './components/views/NationalView'
import { RegionalView } from './components/views/RegionalView'
import { FootprintView } from './components/views/FootprintView'
import { MapView } from './components/views/MapView'
import { FlowsView } from './components/views/FlowsView'
import { YearGroupsView } from './components/views/YearGroupsView'
import { ReasonsView } from './components/views/ReasonsView'
import { ExplorerView } from './components/views/ExplorerView'
import { MethodologyView } from './components/views/MethodologyView'

// jsdom lacks ResizeObserver; the width-measuring charts need it present.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO

const PUBLIC = join(process.cwd(), 'public')

// Serve processed JSON and the geo boundary off disk. The dataService (and
// MapView's direct geojson fetch) only ever request same-origin absolute paths
// like /processed/totals.json and /geo/ctyua_2023_buc.geojson.
globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const rel = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '')
  const file = join(PUBLIC, rel)
  if (!existsSync(file)) {
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as Response
  }
  const text = readFileSync(file, 'utf-8')
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(text),
    text: async () => text,
  } as Response
}) as typeof fetch

beforeAll(async () => {
  expect(
    existsSync(join(PUBLIC, 'processed', 'metadata.json')),
    'run `npm run preprocess` first',
  ).toBe(true)
  // Resolve the dataService version gate so loadProcessed() proceeds to fetch.
  await loadMetadata()
})

afterEach(() => cleanup())

// waitFor a post-load fragment: every fragment below only renders once the
// view's real data has loaded, so a passing assertion proves the data-processing
// path ran without throwing (not merely that the shell mounted).
async function expectFragment(node: React.ReactElement, re: RegExp) {
  render(node)
  await waitFor(
    () => {
      expect(document.body.textContent ?? '').toMatch(re)
    },
    { timeout: 5000 },
  )
}

describe('all 10 views render against the real generated JSON', () => {
  it('headlines: EHE narrative and findings', async () => {
    await expectFragment(<HeadlinesView />, /The short version/i)
  })

  it('national: the sawtooth and maturity caveat', async () => {
    await expectFragment(<NationalView />, /Collection maturity caveat/i)
  })

  it('regional: South West vs England trend', async () => {
    await expectFragment(<RegionalView />, /South West vs England, autumn to autumn/i)
  })

  it('footprint: WeST footprint and Plymouth callout', async () => {
    await expectFragment(<FootprintView />, /Plymouth: the fastest mover/i)
  })

  it('map: choropleth with paired ranked table', async () => {
    await expectFragment(<MapView />, /Ranked local authorities/i)
  })

  it('flows: stocks, flows and enforcement', async () => {
    await expectFragment(<FlowsView />, /Stocks, Flows and Enforcement/i)
  })

  it('yeargroups: the age gradient', async () => {
    await expectFragment(<YearGroupsView />, /Years 10 and 11 counts, autumn to autumn/i)
  })

  it('reasons: the mental-health crossover', async () => {
    await expectFragment(<ReasonsView />, /mental health overtakes philosophical/i)
  })

  it('explorer: filterable table over both datasets', async () => {
    await expectFragment(<ExplorerView />, /Population \(back-out\)/i)
  })

  it('methodology: census-date vs at-any-point definitions', async () => {
    await expectFragment(<MethodologyView />, /census-date stock vs at-any-point flow/i)
  })
})

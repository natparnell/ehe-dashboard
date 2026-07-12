import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { UpdateBanner } from './components/UpdateBanner'
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
import { getView, DEFAULT_VIEW, type ViewId } from './views'
import { loadMetadata } from './services/dataService'
import { formatBuildStamp } from './utils/formatting'
import { OFFICIAL_STATS_BADGE } from './constants'
import type { Metadata } from './types'

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>(DEFAULT_VIEW)
  const [metadata, setMetadata] = useState<Metadata | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void loadMetadata().then((m) => {
      if (!alive) return
      setMetadata(m)
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

  const meta = getView(activeView)

  function renderView() {
    switch (activeView) {
      case 'headlines':
        return <HeadlinesView />
      case 'national':
        return <NationalView />
      case 'regional':
        return <RegionalView />
      case 'footprint':
        return <FootprintView />
      case 'map':
        return <MapView />
      case 'flows':
        return <FlowsView />
      case 'yeargroups':
        return <YearGroupsView />
      case 'reasons':
        return <ReasonsView />
      case 'explorer':
        return <ExplorerView />
      case 'methodology':
        return <MethodologyView />
    }
  }

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 print:block print:h-auto">
      <UpdateBanner />
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      <main className="flex-1 overflow-y-auto pt-12 md:pt-0 print:overflow-visible print:pt-0">
        <div className="mx-auto max-w-[1400px] space-y-4 p-6">
          <header className="flex items-baseline justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{meta.label}</h1>
              <p className="text-sm text-slate-500">{OFFICIAL_STATS_BADGE}</p>
            </div>
            <span className="text-xs text-slate-400">
              {!ready
                ? 'Loading'
                : metadata
                  ? `Data build ${formatBuildStamp(metadata.generated_at)}`
                  : 'Shell preview (no data build yet)'}
            </span>
          </header>
          {renderView()}
        </div>
      </main>
    </div>
  )
}

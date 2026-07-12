import { useState } from 'react'
import { ExternalLink, Menu, X } from 'lucide-react'
import { VIEWS, VIEW_GROUPS, type ViewId } from '../views'
import { DFE_RELEASE_URL } from '../constants'

interface Props {
  activeView: ViewId
  onViewChange: (v: ViewId) => void
}

// Navigation derived entirely from the views registry: one entry per canonical
// view, grouped Start here / Places / Questions / Reference (spec section 5).
// A fixed 224px column on md+ viewports; below that it collapses to a top bar
// with a hamburger that opens an off-canvas drawer, so the primary charts are
// not squeezed into ~100px on a phone.
export function Sidebar({ activeView, onViewChange }: Props) {
  const [open, setOpen] = useState(false)

  const navBody = (
    <>
      <div className="px-4 py-5">
        <div className="text-sm font-bold tracking-wide text-white">Elective home education</div>
        <div className="text-xs text-slate-400">England, South West and the WeST footprint</div>
      </div>
      <div className="flex-1 px-2 pb-6">
        {VIEW_GROUPS.map((group) => (
          <div key={group} className="mb-4">
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {group}
            </div>
            {VIEWS.filter((v) => v.group === group).map((v) => {
              const Icon = v.icon
              const active = v.id === activeView
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    onViewChange(v.id)
                    setOpen(false)
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ' +
                    (active
                      ? 'bg-primary-600 font-medium text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white')
                  }
                >
                  <Icon size={16} className="shrink-0" aria-hidden="true" />
                  <span className="truncate">{v.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="px-2 pb-3">
        <a
          href={DFE_RELEASE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <ExternalLink size={16} className="shrink-0" aria-hidden="true" />
          <span className="truncate">View the DfE release</span>
        </a>
      </div>
      <div className="px-4 py-3 text-[11px] leading-snug text-slate-500">
        DfE official statistics in development, Open Government Licence.
      </div>
    </>
  )

  return (
    <>
      {/* Mobile top bar: fixed, so it stays out of the desktop flex row */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 bg-slate-900 px-4 py-3 text-white md:hidden print:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="rounded p-1 hover:bg-slate-800"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <span className="text-sm font-bold tracking-wide">Elective home education</span>
      </div>

      {/* Desktop sidebar */}
      <nav className="hidden h-screen w-56 shrink-0 flex-col overflow-y-auto bg-slate-900 text-slate-100 md:flex print:hidden">
        {navBody}
      </nav>

      {/* Mobile off-canvas drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden print:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <nav className="absolute left-0 top-0 flex h-full w-64 flex-col overflow-y-auto bg-slate-900 text-slate-100">
            <div className="flex justify-end px-2 pt-2">
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            {navBody}
          </nav>
        </div>
      )}
    </>
  )
}

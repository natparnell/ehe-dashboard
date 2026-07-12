import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

// Polls /version.json and prompts a reload when the deployed build changes. It
// checks on mount, on tab focus, and every 60s. In dev there is no version.json,
// so it silently stays hidden.
export function UpdateBanner() {
  const [stale, setStale] = useState(false)
  const seen = useRef<string | null>(null)

  useEffect(() => {
    let alive = true

    async function check() {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' })
        if (!res.ok) return
        const { generated_at } = (await res.json()) as { generated_at: string }
        if (!generated_at) return
        if (seen.current === null) {
          seen.current = generated_at
        } else if (seen.current !== generated_at && alive) {
          setStale(true)
        }
      } catch {
        /* offline or no version.json in dev: ignore */
      }
    }

    void check()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    const id = window.setInterval(check, 60_000)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(id)
    }
  }, [])

  if (!stale) return null
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-primary-600 px-4 py-2 text-sm text-white print:hidden">
      <RefreshCw size={15} aria-hidden="true" />
      <span>A new version of the data is available.</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded bg-white/20 px-2.5 py-0.5 font-medium hover:bg-white/30"
      >
        Reload
      </button>
    </div>
  )
}

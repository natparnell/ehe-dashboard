import { useState, type RefObject } from 'react'
import { Download } from 'lucide-react'
import { toPng } from 'html-to-image'

// PNG export of a whole chart card (spec section 7). Because the capture
// includes the whole card, the title, subtitle and footnote caveat travel with
// the image, so an exported chart cannot be quoted out of its caveat. The
// button itself is skipped via the data-html-to-image-ignore hook.
interface Props {
  targetRef: RefObject<HTMLElement | null>
  filename: string
}

export function ChartDownload({ targetRef, filename }: Props) {
  const [busy, setBusy] = useState(false)
  async function run() {
    if (!targetRef.current || busy) return
    setBusy(true)
    try {
      const url = await toPng(targetRef.current, {
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        cacheBust: true,
        filter: (node) =>
          !(node instanceof HTMLElement && node.dataset.htmlToImageIgnore !== undefined),
      })
      const a = document.createElement('a')
      a.href = url
      a.download = filename.endsWith('.png') ? filename : `${filename}.png`
      a.click()
    } catch {
      /* export failed (rare); silently ignore so the UI never breaks */
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      data-html-to-image-ignore
      onClick={run}
      disabled={busy}
      aria-label="Download chart as PNG"
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50 print:hidden"
    >
      <Download size={13} aria-hidden="true" />
      {busy ? 'Saving' : 'PNG'}
    </button>
  )
}

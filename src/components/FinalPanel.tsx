import type { FinalMuxStatus } from '../hooks/useFinalMux'

interface Props {
  state: FinalMuxStatus
}

export function FinalPanel({ state }: Props) {
  if (state.status === 'idle') return null

  if (state.status === 'muxing') {
    const pct = Math.round(state.progress * 100)
    const stage = state.total > 1 ? `Variant ${state.current}/${state.total} — ` : ''
    return (
      <div className="mt-4 rounded border border-gray-700 bg-gray-900 p-4 text-gray-300">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-amber-500" />
          <span className="text-sm">{stage}Finalizing video — encoding with audio and watermark… {pct}%</span>
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="mt-4 rounded border border-red-700 bg-red-950/40 p-4 text-red-300">
        <div className="text-sm font-medium">Final mux failed</div>
        <div className="mt-1 text-xs text-red-200/80">{state.error}</div>
      </div>
    )
  }

  // success — one card per variant, best-match (index 0) gets amber accent
  return (
    <div className="mt-4 space-y-4">
      {state.results.map((r, i) => {
        const sizeMb = (r.outputBlob.size / 1024 / 1024).toFixed(2)
        const handleDownload = () => {
          const a = document.createElement('a')
          a.href = r.outputUrl
          a.download = `silent-reel-${Date.now()}-variant-${i + 1}.mp4`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }
        const isBest = i === 0
        return (
          <div
            key={i}
            className={`rounded border p-4 text-gray-200 ${
              isBest ? 'border-amber-700/40 bg-amber-950/10' : 'border-gray-700 bg-gray-900'
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
                Final video — variant {i + 1}
                {isBest && <span className="text-xs text-amber-400">★ best match</span>}
              </h3>
              <span className="text-xs text-gray-500">
                {sizeMb} MB · {r.durationSec.toFixed(1)}s
              </span>
            </div>
            <video
              src={r.outputUrl}
              controls
              className="max-h-[60vh] max-w-full w-auto h-auto rounded mb-3 mx-auto block"
            />
            <button
              onClick={handleDownload}
              className="w-full rounded bg-amber-600 hover:bg-amber-500 transition px-4 py-3 text-sm font-medium text-black"
            >
              Download variant {i + 1}
            </button>
          </div>
        )
      })}
    </div>
  )
}

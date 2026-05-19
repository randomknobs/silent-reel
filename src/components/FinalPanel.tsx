import type { FinalMuxStatus } from '../hooks/useFinalMux'

interface Props {
  state: FinalMuxStatus
}

export function FinalPanel({ state }: Props) {
  if (state.status === 'idle') return null

  if (state.status === 'muxing') {
    const pct = Math.round(state.progress * 100)
    return (
      <div className="mt-4 rounded border border-gray-700 bg-gray-900 p-4 text-gray-300">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-amber-500" />
          <span className="text-sm">Finalizing video — encoding with audio and watermark… {pct}%</span>
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

  // success
  const sizeMb = (state.result.outputBlob.size / 1024 / 1024).toFixed(2)
  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = state.result.outputUrl
    a.download = `silent-reel-${Date.now()}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="mt-4 rounded border border-gray-700 bg-gray-900 p-4 text-gray-200">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider">Final video</h3>
        <span className="text-xs text-gray-500">
          {sizeMb} MB · {state.result.durationSec.toFixed(1)}s
        </span>
      </div>

      <video
        src={state.result.outputUrl}
        controls
        className="max-h-[60vh] max-w-full w-auto h-auto rounded mb-3 mx-auto block"
      />

      <button
        onClick={handleDownload}
        className="w-full rounded bg-amber-600 hover:bg-amber-500 transition px-4 py-3 text-sm font-medium text-black"
      >
        Download MP4
      </button>
    </div>
  )
}

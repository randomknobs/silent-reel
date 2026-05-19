import type { SonificationStatus } from '../hooks/useSonification'

interface Props {
  state: SonificationStatus
}

export function SonificationPanel({ state }: Props) {
  if (state.status === 'idle') return null

  if (state.status === 'running') {
    const stageLabel = {
      extract: 'Extracting brightness curve',
      synth:   'Synthesizing voice',
      encode:  'Encoding MP3',
    }[state.stage]
    const pct = Math.round(state.progress * 100)

    return (
      <div className="mt-4 rounded border border-gray-700 bg-gray-900 p-4 text-gray-300">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-blue-500" />
          <span className="text-sm">{stageLabel}… {pct}%</span>
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="mt-4 rounded border border-red-700 bg-red-950/40 p-4 text-red-300">
        <div className="text-sm font-medium">Sonification failed</div>
        <div className="mt-1 text-xs text-red-200/80">{state.error}</div>
      </div>
    )
  }

  const r = state.result
  return (
    <div className="mt-4 rounded border border-gray-700 bg-gray-900 p-4 text-gray-200">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider">Sonification</h3>
        <span className="text-xs text-gray-500">
          {(r.mp3Blob.size / 1024).toFixed(1)} KB · {r.durationSec.toFixed(2)}s · {r.extractInfo.frames} frames
        </span>
      </div>

      <audio src={state.objectUrl} controls className="w-full" />

      <div className="mt-3 text-xs text-gray-500">
        Active pixel sampled at{' '}
        {r.extractInfo.pixel
          ? `(${r.extractInfo.pixel.x}, ${r.extractInfo.pixel.y}) of ${r.extractInfo.dims.w}×${r.extractInfo.dims.h}`
          : 'aggregate frame'}
        {' '}· {r.extractInfo.fps.toFixed(1)} fps
      </div>
    </div>
  )
}

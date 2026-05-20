import type { SunoGenStatus } from '../hooks/useSunoGeneration'

interface Props {
  state: SunoGenStatus
}

export function SunoPanel({ state }: Props) {
  if (state.status === 'idle') return null

  if (state.status === 'uploading') {
    return (
      <div className="mt-4 rounded border border-gray-700 bg-gray-900 p-4 text-gray-300">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-purple-500" />
          <span className="text-sm">Uploading sonification to Kie…</span>
        </div>
      </div>
    )
  }

  if (state.status === 'submitting') {
    return (
      <div className="mt-4 rounded border border-gray-700 bg-gray-900 p-4 text-gray-300">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-purple-500" />
          <span className="text-sm">Submitting cover job to Suno…</span>
        </div>
      </div>
    )
  }

  if (state.status === 'generating') {
    const dots = '.'.repeat((state.pollAttempt % 4) + 1)
    return (
      <div className="mt-4 rounded border border-gray-700 bg-gray-900 p-4 text-gray-300">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 animate-pulse rounded-full bg-purple-500" />
            <span className="text-sm">Suno generating{dots}</span>
          </div>
          <span className="text-xs text-gray-500">
            {state.sunoStatus} · poll {state.pollAttempt}/72
          </span>
        </div>

        {state.tracks.length > 0 && (
          <div className="mt-3 text-xs text-gray-400">
            Streaming preview available — final still rendering:
            {state.tracks.map((t, i) => (
              <div key={i} className="mt-2">
                <div className="text-xs text-gray-300 mb-1">{t.title}</div>
                <audio src={t.streamUrl} controls className="w-full" />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (state.status === 'aligning') {
    return (
      <div className="mt-4 rounded border border-gray-700 bg-gray-900 p-4 text-gray-300">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-purple-500" />
          <span className="text-sm">Aligning Suno output to sonification timing…</span>
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="mt-4 rounded border border-red-700 bg-red-950/40 p-4 text-red-300">
        <div className="text-sm font-medium">Suno generation failed</div>
        <div className="mt-1 text-xs text-red-200/80">{state.error}</div>
      </div>
    )
  }

  // success
  return (
    <div className="mt-4 rounded border border-gray-700 bg-gray-900 p-4 text-gray-200">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider">Suno Cover (Aligned)</h3>
        <span className="text-xs text-gray-500">
          via {state.modelUsed} · {state.alignments.length} variant{state.alignments.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-4">
        {state.alignments.map((a, i) => {
          const track = state.tracks[a.trackIndex]
          const isBest = i === 0
          const handleDownload = () => {
            const link = document.createElement('a')
            link.href = a.alignedUrl
            link.download = `silent-reel-suno-${a.trackIndex + 1}.mp3`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
          }
          return (
            <div
              key={i}
              className={`space-y-2 ${isBest ? 'rounded border border-amber-700/40 bg-amber-950/10 p-3' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm flex items-center gap-2">
                  {track.title}
                  {isBest && <span className="text-xs text-amber-400">★ best match</span>}
                </div>
                <span className="text-xs text-gray-500">
                  score {a.result.score.toFixed(1)} · lag {a.result.lagSec.toFixed(2)}s
                </span>
              </div>
              <audio src={a.alignedUrl} controls className="w-full" />
              <button
                onClick={handleDownload}
                className="text-xs text-gray-400 hover:text-gray-200 transition underline"
              >
                ↓ download variant {a.trackIndex + 1}
              </button>
            </div>
          )
        })}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-gray-500">
          Show original Suno output ({state.tracks.length} track{state.tracks.length === 1 ? '' : 's'}, full length)
        </summary>
        <div className="mt-2 space-y-3">
          {state.tracks.map((t, i) => (
            <div key={i} className="space-y-1">
              <div className="text-xs text-gray-400">{t.title} · {t.duration.toFixed(1)}s</div>
              <audio src={t.audioUrl} controls className="w-full" />
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

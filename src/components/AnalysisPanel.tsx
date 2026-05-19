import type { AnalysisStatus } from '../hooks/useSceneAnalysis'

interface Props {
  state: AnalysisStatus
}

export function AnalysisPanel({ state }: Props) {
  if (state.status === 'idle') return null

  if (state.status === 'analyzing') {
    return (
      <div className="mt-6 rounded border border-gray-700 bg-gray-900 p-4 text-gray-300">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-pulse rounded-full bg-yellow-500" />
          <span className="text-sm">Analyzing scene with Gemini…</span>
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="mt-6 rounded border border-red-700 bg-red-950/40 p-4 text-red-300">
        <div className="text-sm font-medium">Analysis failed</div>
        <div className="mt-1 text-xs text-red-200/80">{state.error}</div>
      </div>
    )
  }

  // success
  const a = state.analysis
  return (
    <div className="mt-6 rounded border border-gray-700 bg-gray-900 p-4 text-gray-200">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider">Scene Analysis</h3>
        <span className="text-xs text-gray-500">via {state.modelUsed}</span>
      </div>

      <div className="space-y-2 text-sm">
        <div><span className="text-gray-400">Genre:</span> {a.cinema_genre}</div>
        <div><span className="text-gray-400">Mood:</span> {a.mood}</div>
        <div className="text-gray-300 italic">"{a.scene_description}"</div>

        <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 pt-2">
          <div>Setting: <span className="text-gray-200">{a.setting}</span></div>
          <div>Energy: <span className="text-gray-200">{a.energy}</span></div>
          <div>Pace: <span className="text-gray-200">{a.pace}</span></div>
          <div>BPM: <span className="text-gray-200">{a.estimated_bpm}</span></div>
          <div>Scale: <span className="text-gray-200">{a.recommended_scale}</span></div>
          <div>Density: <span className="text-gray-200">{a.recommended_density}</span></div>
        </div>

        <div className="pt-2">
          <div className="text-xs text-gray-400 mb-1">Instruments:</div>
          <div className="text-xs">{a.instruments?.join(', ')}</div>
        </div>

        <div className="pt-2">
          <div className="text-xs text-gray-400 mb-1">Music prompt (for Suno, Phase 4):</div>
          <div className="text-xs bg-gray-950 rounded p-2 font-mono text-gray-300">{a.music_prompt}</div>
        </div>

        {a.key_moments && a.key_moments.length > 0 && (
          <details className="pt-2">
            <summary className="text-xs text-gray-400 cursor-pointer">Key moments ({a.key_moments.length})</summary>
            <ul className="mt-1 space-y-1 text-xs pl-3">
              {a.key_moments.map((m, i) => (
                <li key={i}>
                  <span className="text-gray-400">{m.time}</span> — {m.event} <span className="text-gray-500">({m.musical_cue})</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <details className="pt-2">
          <summary className="text-xs text-gray-500 cursor-pointer">Raw JSON</summary>
          <pre className="mt-1 text-xs bg-gray-950 rounded p-2 overflow-x-auto text-gray-400">
{JSON.stringify(a, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  )
}

import { useCallback, useState } from 'react'
import { muxVideoWithAudio } from '../lib/finalMux'
import type { MuxResult } from '../lib/finalMux'

export type FinalMuxStatus =
  | { status: 'idle' }
  | { status: 'muxing'; progress: number }
  | { status: 'success'; result: MuxResult }
  | { status: 'error'; error: string }

export function useFinalMux() {
  const [state, setState] = useState<FinalMuxStatus>({ status: 'idle' })

  const run = useCallback(async (videoBlob: Blob, audioBlob: Blob) => {
    setState({ status: 'muxing', progress: 0 })
    try {
      const result = await muxVideoWithAudio(videoBlob, audioBlob, {
        onProgress: (p) => setState({ status: 'muxing', progress: p.ratio }),
      })
      setState({ status: 'success', result })
    } catch (err) {
      console.error('[final-mux] failed:', err)
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Final mux failed',
      })
    }
  }, [])

  const reset = useCallback(() => {
    setState((prev) => {
      if (prev.status === 'success') URL.revokeObjectURL(prev.result.outputUrl)
      return { status: 'idle' }
    })
  }, [])

  return { state, run, reset }
}

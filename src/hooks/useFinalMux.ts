import { useCallback, useState } from 'react'
import { muxVideoWithAudio } from '../lib/finalMux'
import type { MuxResult } from '../lib/finalMux'

export type FinalMuxStatus =
  | { status: 'idle' }
  | { status: 'muxing'; current: number; total: number; progress: number }
  | { status: 'success'; results: MuxResult[] }
  | { status: 'error'; error: string }

export function useFinalMux() {
  const [state, setState] = useState<FinalMuxStatus>({ status: 'idle' })

  const run = useCallback(async (videoBlob: Blob, audioBlobs: Blob[]) => {
    if (audioBlobs.length === 0) {
      setState({ status: 'error', error: 'No audio variants to mux' })
      return
    }
    setState({ status: 'muxing', current: 1, total: audioBlobs.length, progress: 0 })
    const results: MuxResult[] = []
    try {
      for (let i = 0; i < audioBlobs.length; i++) {
        setState({ status: 'muxing', current: i + 1, total: audioBlobs.length, progress: 0 })
        const result = await muxVideoWithAudio(videoBlob, audioBlobs[i], {
          onProgress: (p) => setState({
            status: 'muxing',
            current: i + 1,
            total: audioBlobs.length,
            progress: p.ratio,
          }),
        })
        results.push(result)
      }
      setState({ status: 'success', results })
    } catch (err) {
      console.error('[final-mux] failed:', err)
      // Cleanup partial successes
      results.forEach((r) => URL.revokeObjectURL(r.outputUrl))
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Final mux failed',
      })
    }
  }, [])

  const reset = useCallback(() => {
    setState((prev) => {
      if (prev.status === 'success') {
        prev.results.forEach((r) => URL.revokeObjectURL(r.outputUrl))
      }
      return { status: 'idle' }
    })
  }, [])

  return { state, run, reset }
}

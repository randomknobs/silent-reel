import { useCallback, useState } from 'react'
import { sonifyVideoToMp3 } from '../lib/sonify'
import type { SonifyOpts, SonifyProgress, SonifyResult } from '../types/sonify'

export type SonificationStatus =
  | { status: 'idle' }
  | { status: 'running'; stage: SonifyProgress['stage']; progress: number }
  | { status: 'success'; result: SonifyResult; objectUrl: string }
  | { status: 'error'; error: string }

export function useSonification() {
  const [state, setState] = useState<SonificationStatus>({ status: 'idle' })

  const run = useCallback(async (videoBlob: Blob, analysis: SonifyOpts['analysis'] | null) => {
    setState({ status: 'running', stage: 'extract', progress: 0 })

    try {
      const result = await sonifyVideoToMp3(videoBlob, analysis, {
        onProgress: (p: SonifyProgress) => {
          setState({ status: 'running', stage: p.stage, progress: p.progress })
        },
      })

      const objectUrl = URL.createObjectURL(result.mp3Blob)
      setState({ status: 'success', result, objectUrl })
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown sonification error',
      })
    }
  }, [])

  const reset = useCallback(() => {
    setState((prev) => {
      if (prev.status === 'success') URL.revokeObjectURL(prev.objectUrl)
      return { status: 'idle' }
    })
  }, [])

  return { state, run, reset }
}

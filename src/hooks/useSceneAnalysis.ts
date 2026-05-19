import { useCallback, useState } from 'react'
import type { AnalyzeResponse, SceneAnalysis } from '../types/analysis'
import { compressForAnalysis } from '../lib/videoPipeline'

export type AnalysisStatus =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'success'; analysis: SceneAnalysis; modelUsed: string; proxyBlob: Blob }
  | { status: 'error'; error: string }

const MAX_INLINE_VIDEO_BYTES = 4.5 * 1024 * 1024  // ~4.5 MB raw, ~6 MB base64

export function useSceneAnalysis() {
  const [state, setState] = useState<AnalysisStatus>({ status: 'idle' })

  const analyze = useCallback(async (videoBlob: Blob) => {
    setState({ status: 'analyzing' })

    try {
      // Step 1: compress to a Gemini-sized proxy (separate from user's full-quality blob)
      const compressedBlob = await compressForAnalysis(videoBlob)

      if (compressedBlob.size > MAX_INLINE_VIDEO_BYTES) {
        setState({
          status: 'error',
          error: `Even compressed, the video is ${(compressedBlob.size / 1024 / 1024).toFixed(1)} MB — exceeds 4.5 MB inline limit. Try a shorter clip.`,
        })
        return
      }

      // Step 2: blob → base64 in chunks (operate on COMPRESSED, not original)
      const arrayBuffer = await compressedBlob.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      const chunkSize = 8192
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
      }
      const videoBase64 = btoa(binary)

      const res = await fetch('/api/gemini-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoBase64,
          mimeType: compressedBlob.type || 'video/mp4',
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(errData.error || `Analysis failed: ${res.status}`)
      }

      const data: AnalyzeResponse = await res.json()
      setState({
        status: 'success',
        analysis: data.analysis,
        modelUsed: data.modelUsed,
        proxyBlob: compressedBlob,
      })
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown analysis error',
      })
    }
  }, [])

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { state, analyze, reset }
}

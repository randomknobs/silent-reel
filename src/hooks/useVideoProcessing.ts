import { useCallback, useState } from 'react'
import { applyStyle } from '../lib/videoPipeline'
import { useSceneAnalysis } from './useSceneAnalysis'

type Status = 'idle' | 'loading-ffmpeg' | 'processing' | 'done' | 'error'

export interface VideoProcessingState {
  status: Status
  progress: number          // 0..1, only meaningful when status === 'processing'
  styledUrl: string | null
  styledBlob: Blob | null
  error: string | null
}

const UNSUPPORTED_CODEC_MESSAGE = `Couldn't process this video. Browser ffmpeg doesn't support HEVC (H.265 — the default codec on iPhone).

Convert your file first:
ffmpeg -i input.mov -c:v libx264 -pix_fmt yuv420p -an output.mp4

Or try this test sample to verify everything else works:
https://download.samplelib.com/mp4/sample-5s.mp4`

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error'
  const msg = err.message
  // Timeout or non-zero exit code from ffmpeg almost always means the input codec
  // (HEVC, ProRes, etc.) isn't decodable by the wasm build.
  if (msg === 'FFMPEG_TIMEOUT' || /^ffmpeg exited with code [^0]/.test(msg)) {
    return UNSUPPORTED_CODEC_MESSAGE
  }
  return msg
}

export function useVideoProcessing() {
  const [state, setState] = useState<VideoProcessingState>({
    status: 'idle',
    progress: 0,
    styledUrl: null,
    styledBlob: null,
    error: null,
  })

  const sceneAnalysis = useSceneAnalysis()

  const process = useCallback(async (file: File) => {
    // Revoke previous URL + clear any prior analysis to avoid showing stale results
    setState((s) => {
      if (s.styledUrl) URL.revokeObjectURL(s.styledUrl)
      return {
        status: 'loading-ffmpeg',
        progress: 0,
        styledUrl: null,
        styledBlob: null,
        error: null,
      }
    })
    sceneAnalysis.reset()

    try {
      setState((s) => ({ ...s, status: 'processing' }))
      const styledBlob = await applyStyle(file, {
        onProgress: ({ progress }) => {
          setState((s) => ({ ...s, progress }))
        },
      })
      const styledUrl = URL.createObjectURL(styledBlob)
      setState((s) => ({
        ...s,
        status: 'done',
        progress: 1,
        styledBlob,
        styledUrl,
      }))

      // Kick off Gemini analysis in the background — does not block the preview
      sceneAnalysis.analyze(styledBlob)
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: describeError(err),
      }))
    }
  }, [sceneAnalysis])

  const reset = useCallback(() => {
    setState((s) => {
      if (s.styledUrl) URL.revokeObjectURL(s.styledUrl)
      return {
        status: 'idle',
        progress: 0,
        styledUrl: null,
        styledBlob: null,
        error: null,
      }
    })
    sceneAnalysis.reset()
  }, [sceneAnalysis])

  return { state, process, reset, analysis: sceneAnalysis.state }
}

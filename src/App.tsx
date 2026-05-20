import { useCallback, useEffect } from 'react'
import { UploadZone } from './components/UploadZone'
import { ProcessingStatus } from './components/ProcessingStatus'
import { VideoPreview } from './components/VideoPreview'
import { AnalysisPanel } from './components/AnalysisPanel'
import { SonificationPanel } from './components/SonificationPanel'
import { SunoPanel } from './components/SunoPanel'
import { FinalPanel } from './components/FinalPanel'
import { useVideoProcessing } from './hooks/useVideoProcessing'
import { useSonification } from './hooks/useSonification'
import { useSunoGeneration } from './hooks/useSunoGeneration'
import { useFinalMux } from './hooks/useFinalMux'

export default function App() {
  const { state, process, reset, analysis } = useVideoProcessing()
  const sonification = useSonification()
  const sunoGen = useSunoGeneration()
  const finalMux = useFinalMux()

  // Trigger sonification as soon as Gemini analysis succeeds. We sonify the
  // CLEAN analysis proxy (h.264 of the original content, downscaled, NO film
  // artifacts). Brightness curve tracks real content motion rather than the
  // added grain/flicker/dust. Runs in parallel with styling — does not wait
  // for styling to finish.
  useEffect(() => {
    if (
      analysis.status === 'success' &&
      sonification.state.status === 'idle'
    ) {
      sonification.run(analysis.proxyBlob, analysis.analysis)
    }
  }, [analysis, sonification])

  // Once sonification succeeds, kick Suno cover-generation pipeline (upload → submit → poll)
  useEffect(() => {
    if (
      sonification.state.status === 'success' &&
      analysis.status === 'success' &&
      sunoGen.state.status === 'idle'
    ) {
      sunoGen.run(
        sonification.state.result.mp3Blob,
        analysis.analysis,
        sonification.state.result.durationSec,
      )
    }
  }, [sonification.state, analysis, sunoGen])

  // After Suno alignment finishes, run final mux: styled video + aligned audio + watermark
  useEffect(() => {
    if (
      sunoGen.state.status === 'success' &&
      state.status === 'done' &&
      state.styledBlob &&
      finalMux.state.status === 'idle'
    ) {
      // Use the best-match aligned track (already sorted by correlation score in useSunoGeneration)
      finalMux.run(state.styledBlob, sunoGen.state.alignments[0].result.alignedBlob)
    }
  }, [sunoGen.state, state.status, state.styledBlob, finalMux])

  const handleReset = useCallback(() => {
    finalMux.reset()
    sunoGen.reset()
    sonification.reset()
    reset()
  }, [reset, sonification, sunoGen, finalMux])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-5xl font-serif mb-2 tracking-wide">SILENT REEL</h1>
      <p className="text-neutral-500 text-sm mb-12 italic">
        Your moving picture, transformed.
      </p>

      {state.status === 'idle' && (
        <UploadZone onFile={process} />
      )}

      {(state.status === 'loading-ffmpeg' || state.status === 'processing') && (
        <ProcessingStatus status={state.status} progress={state.progress} />
      )}

      {state.status === 'done' && state.styledUrl && state.styledBlob && (
        <div className="w-full max-w-3xl flex flex-col items-center">
          <VideoPreview
            styledUrl={state.styledUrl}
            styledBlob={state.styledBlob}
            onReset={handleReset}
          />
          <div className="w-full">
            <AnalysisPanel state={analysis} />
            <SonificationPanel state={sonification.state} />
            <SunoPanel state={sunoGen.state} />
            <FinalPanel state={finalMux.state} />
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="flex flex-col items-center">
          <div className="whitespace-pre-line text-red-400 text-sm max-w-2xl text-left mb-6">
            {state.error}
          </div>
          <button
            onClick={handleReset}
            className="px-6 py-3 border border-neutral-700 rounded hover:border-neutral-500"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

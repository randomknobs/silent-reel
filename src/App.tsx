import { useCallback, useEffect } from 'react'
import { UploadZone } from './components/UploadZone'
import { ProcessingStatus } from './components/ProcessingStatus'
import { VideoPreview } from './components/VideoPreview'
import { AnalysisPanel } from './components/AnalysisPanel'
import { SonificationPanel } from './components/SonificationPanel'
import { SunoPanel } from './components/SunoPanel'
import { useVideoProcessing } from './hooks/useVideoProcessing'
import { useSonification } from './hooks/useSonification'
import { useSunoGeneration } from './hooks/useSunoGeneration'

export default function App() {
  const { state, process, reset, analysis } = useVideoProcessing()
  const sonification = useSonification()
  const sunoGen = useSunoGeneration()

  // Trigger sonification once analysis succeeds. Runs in parallel with the
  // video preview being visible — does not block anything else.
  useEffect(() => {
    console.log('[sonif-trigger] check:', {
      analysisStatus: analysis.status,
      processingStatus: state.status,
      hasStyledBlob: !!state.styledBlob,
      sonificationStatus: sonification.state.status,
    })

    if (
      analysis.status === 'success' &&
      state.status === 'done' &&
      state.styledBlob &&
      sonification.state.status === 'idle'
    ) {
      console.log('[sonif-trigger] FIRING with blob', state.styledBlob)
      sonification.run(state.styledBlob, analysis.analysis)
    }
  }, [analysis, state.status, state.styledBlob, sonification])

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

  const handleReset = useCallback(() => {
    sunoGen.reset()
    sonification.reset()
    reset()
  }, [reset, sonification, sunoGen])

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

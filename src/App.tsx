import { UploadZone } from './components/UploadZone'
import { ProcessingStatus } from './components/ProcessingStatus'
import { VideoPreview } from './components/VideoPreview'
import { AnalysisPanel } from './components/AnalysisPanel'
import { useVideoProcessing } from './hooks/useVideoProcessing'

export default function App() {
  const { state, process, reset, analysis } = useVideoProcessing()

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
            onReset={reset}
          />
          <div className="w-full">
            <AnalysisPanel state={analysis} />
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="flex flex-col items-center">
          <div className="whitespace-pre-line text-red-400 text-sm max-w-2xl text-left mb-6">
            {state.error}
          </div>
          <button
            onClick={reset}
            className="px-6 py-3 border border-neutral-700 rounded hover:border-neutral-500"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

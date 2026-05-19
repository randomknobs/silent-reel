interface Props {
  status: 'loading-ffmpeg' | 'processing'
  progress: number
}

export function ProcessingStatus({ status, progress }: Props) {
  const label = status === 'loading-ffmpeg'
    ? 'Loading ffmpeg…'
    : `Processing… ${Math.round(progress * 100)}%`

  return (
    <div className="w-full max-w-2xl">
      <div className="text-neutral-400 text-sm mb-3 text-center italic">
        {label}
      </div>
      <div className="h-1 bg-neutral-900 rounded overflow-hidden">
        <div
          className="h-full bg-neutral-400 transition-all duration-200"
          style={{ width: status === 'loading-ffmpeg' ? '15%' : `${progress * 100}%` }}
        />
      </div>
    </div>
  )
}

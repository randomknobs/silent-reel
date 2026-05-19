interface Props {
  styledUrl: string
  styledBlob: Blob
  onReset: () => void
}

export function VideoPreview({ styledUrl, styledBlob, onReset }: Props) {
  const handleDownload = () => {
    const url = URL.createObjectURL(styledBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `silent-reel-${Date.now()}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="w-full max-w-3xl flex flex-col items-center">
      <video
        src={styledUrl}
        controls
        autoPlay
        className="max-h-[60vh] max-w-full w-auto h-auto rounded border border-neutral-800 mb-8"
      />

      <div className="flex gap-4 justify-center">
        <button
          onClick={handleDownload}
          className="px-6 py-3 bg-neutral-100 text-neutral-900 rounded hover:bg-white transition-colors"
        >
          Download
        </button>
        <button
          onClick={onReset}
          className="px-6 py-3 border border-neutral-700 rounded hover:border-neutral-500 transition-colors"
        >
          Process another
        </button>
      </div>
    </div>
  )
}

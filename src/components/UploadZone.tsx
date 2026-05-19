import { useCallback, useState } from 'react'

interface Props {
  onFile: (file: File) => void
}

export function UploadZone({ onFile }: Props) {
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files[0]
      if (!file?.type.startsWith('video/')) return
      if (file.size > 150 * 1024 * 1024) {
        alert('File is too large (max 150 MB). Try a shorter or lower-resolution video.')
        return
      }
      onFile(file)
    },
    [onFile]
  )

  return (
    <label
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      className={`
        w-full max-w-2xl border-2 border-dashed rounded-lg p-16 text-center
        cursor-pointer transition-colors
        ${dragOver
          ? 'border-neutral-300 bg-neutral-900'
          : 'border-neutral-700 hover:border-neutral-500'}
      `}
    >
      <input
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          if (f.size > 150 * 1024 * 1024) {
            alert('File is too large (max 150 MB). Try a shorter or lower-resolution video.')
            return
          }
          onFile(f)
        }}
      />
      <div className="text-neutral-400">
        <div className="text-lg mb-2">Drop your video here</div>
        <div className="text-xs text-neutral-600">MP4, up to 60 seconds</div>
      </div>
    </label>
  )
}

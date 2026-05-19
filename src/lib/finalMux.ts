import { fetchFile } from '@ffmpeg/util'
import { getFFmpeg } from './ffmpeg'

export interface MuxProgress {
  ratio: number  // 0..1
}

export interface MuxResult {
  outputBlob: Blob
  outputUrl: string
  durationSec: number
}

const WATERMARK_TEXT = 'Made with Silent Reel'

const IN_VIDEO = 'mux_in.mp4'
const IN_AUDIO = 'mux_in.mp3'
const FONT     = 'mux_font.ttf'
const OUT      = 'mux_out.mp4'

/**
 * Mux a video file with an audio file, burning a text watermark into the
 * lower-right corner. Re-encodes video via libx264 because drawtext requires
 * filtering. Audio re-encoded to AAC for MP4 container compatibility.
 */
export async function muxVideoWithAudio(
  videoBlob: Blob,
  audioBlob: Blob,
  opts: { onProgress?: (p: MuxProgress) => void } = {},
): Promise<MuxResult> {
  const onProgress = opts.onProgress ?? (() => {})

  const ff = await getFFmpeg()

  // 1. Write inputs to FFmpeg virtual FS
  const videoBytes = await fetchFile(videoBlob)
  const audioBytes = await fetchFile(audioBlob)
  await ff.writeFile(IN_VIDEO, videoBytes)
  await ff.writeFile(IN_AUDIO, audioBytes)

  // 2. Load font for watermark (served from /public)
  const fontRes = await fetch('/fonts/serif.ttf')
  if (!fontRes.ok) throw new Error(`Font load failed: ${fontRes.status}`)
  const fontBytes = new Uint8Array(await fontRes.arrayBuffer())
  await ff.writeFile(FONT, fontBytes)

  // 3. Set up progress listener
  const onFfmpegProgress = ({ progress }: { progress: number; time: number }) => {
    onProgress({ ratio: Math.max(0, Math.min(1, progress)) })
  }
  ff.on('progress', onFfmpegProgress)

  try {
    // 4. Build the drawtext filter — lower-right corner, semi-transparent box
    const watermark =
      `drawtext=fontfile=${FONT}:` +
      `text='${WATERMARK_TEXT}':` +
      `x=w-tw-20:y=h-th-20:` +
      `fontsize=18:` +
      `fontcolor=white@0.7:` +
      `box=1:boxcolor=black@0.4:boxborderw=5`

    // 5. Run mux + watermark
    await ff.exec([
      '-i', IN_VIDEO,
      '-i', IN_AUDIO,
      '-map', '0:v',
      '-map', '1:a',
      '-threads', '1',           // same libx264 WASM-MT precaution as Phase 1
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      '-vf', watermark,
      '-movflags', '+faststart',  // for browser streaming
      OUT,
    ])

    // 6. Read result
    const data = await ff.readFile(OUT)
    const outBytes = (data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))) as Uint8Array<ArrayBuffer>
    const outputBlob = new Blob([outBytes], { type: 'video/mp4' })
    const outputUrl = URL.createObjectURL(outputBlob)

    // Probe duration via temporary video element
    const tempVideo = document.createElement('video')
    tempVideo.src = outputUrl
    await new Promise<void>((resolve, reject) => {
      tempVideo.onloadedmetadata = () => resolve()
      tempVideo.onerror = () => reject(new Error('output metadata failed'))
      setTimeout(() => reject(new Error('output metadata timeout')), 5000)
    })
    const durationSec = tempVideo.duration

    return { outputBlob, outputUrl, durationSec }
  } finally {
    ff.off('progress', onFfmpegProgress)
    // Cleanup virtual FS
    try { await ff.deleteFile(IN_VIDEO) } catch {}
    try { await ff.deleteFile(IN_AUDIO) } catch {}
    try { await ff.deleteFile(FONT) } catch {}
    try { await ff.deleteFile(OUT) } catch {}
  }
}

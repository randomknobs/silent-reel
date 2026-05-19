import { fetchFile } from '@ffmpeg/util'
import { getFFmpeg } from './ffmpeg'

export interface ProcessingProgress {
  /** 0..1 */
  progress: number
  /** seconds of source video processed */
  time: number
}

export interface StyleOptions {
  contrast?: number          // default 1.2
  brightness?: number        // default -0.05
  noiseStrength?: number     // default 18
  onProgress?: (p: ProcessingProgress) => void
}

const INPUT_NAME = 'input.mp4'
const OUTPUT_NAME = 'styled.mp4'

/**
 * Apply the silent-film style filter chain to a video Blob.
 * Returns a new Blob (MP4, H.264, no audio).
 */
export async function applyStyle(
  videoBlob: Blob,
  opts: StyleOptions = {}
): Promise<Blob> {
  const contrast = opts.contrast ?? 1.2
  const brightness = opts.brightness ?? -0.05
  const noiseStrength = opts.noiseStrength ?? 18

  const ff = await getFFmpeg()

  // Wire progress callback (ffmpeg emits per-frame)
  const progressHandler = ({ progress, time }: { progress: number; time: number }) => {
    opts.onProgress?.({
      progress: Math.max(0, Math.min(1, progress)),
      // time is in microseconds in v0.12.x
      time: time / 1_000_000,
    })
  }
  ff.on('progress', progressHandler)

  try {
    // Load input into ffmpeg's virtual FS
    await ff.writeFile(INPUT_NAME, await fetchFile(videoBlob))

    const filterChain = [
      'hue=s=0',
      `eq=contrast=${contrast}:brightness=${brightness}`,
      `noise=alls=${noiseStrength}:allf=t+u`,
      'vignette',
    ].join(',')

    // 3-minute timeout — unsupported codecs (e.g. HEVC) make ffmpeg.wasm hang at frame 1
    // instead of erroring out. The timeout converts the hang into a user-visible error.
    const exitCode = await Promise.race([
      ff.exec([
        '-i', INPUT_NAME,
        '-vf', filterChain,
        '-an',
        '-threads', '1',           // libx264 in WASM-MT deadlocks when threads > 1
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        OUTPUT_NAME,
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('FFMPEG_TIMEOUT')), 3 * 60 * 1000)
      ),
    ])

    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode}`)
    }

    const data = await ff.readFile(OUTPUT_NAME)
    // v0.12.x returns Uint8Array. TS 6 generic ArrayBufferLike defeats Blob's BlobPart inference,
    // but ffmpeg-wasm's output is always ArrayBuffer-backed (never SharedArrayBuffer-backed) so the cast is safe.
    const bytes = (data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))) as Uint8Array<ArrayBuffer>

    return new Blob([bytes], { type: 'video/mp4' })
  } finally {
    ff.off('progress', progressHandler)
    // Best-effort cleanup of virtual FS — non-fatal if it fails
    try { await ff.deleteFile(INPUT_NAME) } catch {}
    try { await ff.deleteFile(OUTPUT_NAME) } catch {}
  }
}

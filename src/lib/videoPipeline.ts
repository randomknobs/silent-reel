import { fetchFile } from '@ffmpeg/util'
import { getFFmpeg } from './ffmpeg'

// Downscale incoming frames before the geq-heavy filter chain runs.
// geq cost is per-pixel, so cutting longest side from 1080p → 720p quarters the work.
const IS_MOBILE = typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

const MAX_DIMENSION = IS_MOBILE ? 480 : 720

export interface ProcessingProgress {
  /** 0..1 */
  progress: number
  /** seconds of source video processed */
  time: number
}

export interface StyleOptions {
  contrast?: number          // default 1.25
  brightness?: number        // default -0.05
  noiseStrength?: number     // default 24
  onProgress?: (p: ProcessingProgress) => void
}

export interface VideoMetadata {
  duration: number   // seconds
  width: number      // pixels
  height: number     // pixels
}

const INPUT_NAME = 'input.mp4'
const OUTPUT_NAME = 'styled.mp4'

/**
 * Read video metadata from a Blob via a hidden <video> element.
 * Used to parameterize the procedural scratch generator.
 */
export async function getVideoMetadata(blob: Blob): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    const url = URL.createObjectURL(blob)

    const cleanup = () => URL.revokeObjectURL(url)

    video.onloadedmetadata = () => {
      cleanup()
      if (
        Number.isFinite(video.duration) && video.duration > 0 &&
        video.videoWidth > 0 && video.videoHeight > 0
      ) {
        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        })
      } else {
        reject(new Error('Could not determine video metadata'))
      }
    }
    video.onerror = () => {
      cleanup()
      reject(new Error('Could not load video metadata'))
    }
    video.src = url
  })
}

interface DotSpec {
  x: number
  y: number
  size: number
  tStart: number
  tEnd: number
  alpha: number
}

function generateDots(width: number, height: number, duration: number): DotSpec[] {
  const numDots = Math.max(30, Math.round(duration * 17.5))
  const dots: DotSpec[] = []

  for (let i = 0; i < numDots; i++) {
    const lifetime = 0.08 + Math.random() * 0.25
    const tStart = Math.random() * Math.max(0.01, duration - lifetime)
    const sizeRand = Math.random() * Math.random()  // bias toward small
    const size = 2 + Math.floor(sizeRand * 6)        // 2–8 px max
    dots.push({
      x: Math.floor(Math.random() * Math.max(1, width - size)),
      y: Math.floor(Math.random() * Math.max(1, height - size)),
      size,
      tStart,
      tEnd: tStart + lifetime,
      alpha: 0.75 + Math.random() * 0.25,
    })
  }

  return dots
}

function buildDrawboxFilters(dots: DotSpec[]): string[] {
  return dots.map((d) =>
    `drawbox=x=${d.x}:y=${d.y}:w=${d.size}:h=${d.size}` +
    `:color=white@${d.alpha.toFixed(2)}:t=fill` +
    `:enable='between(t,${d.tStart.toFixed(3)},${d.tEnd.toFixed(3)})'`
  )
}

/**
 * Apply the silent-film style filter chain to a video Blob.
 * Returns a new Blob (MP4, H.264, no audio).
 */
export async function applyStyle(
  videoBlob: Blob,
  opts: StyleOptions = {}
): Promise<Blob> {
  const contrast = opts.contrast ?? 1.25
  const brightness = opts.brightness ?? -0.05
  const noiseStrength = opts.noiseStrength ?? 24

  const ff = await getFFmpeg()

  // Get original dimensions + duration. Width/height drive scratch positioning;
  // duration drives dot scheduling.
  const { duration, width: origWidth, height: origHeight } = await getVideoMetadata(videoBlob)

  // Compute output dimensions: downscale only, never upscale.
  // yuv420p requires even dimensions, so round to even.
  const longestSide = Math.max(origWidth, origHeight)
  const scaleFactor = longestSide > MAX_DIMENSION ? MAX_DIMENSION / longestSide : 1
  const outWidth  = Math.round(origWidth  * scaleFactor / 2) * 2
  const outHeight = Math.round(origHeight * scaleFactor / 2) * 2

  if (import.meta.env.DEV) {
    console.log(
      `[scale] ${origWidth}×${origHeight} → ${outWidth}×${outHeight} (mobile=${IS_MOBILE})`
    )
  }

  // Generate dust dots in OUTPUT coordinate space (post-scale)
  const dots = generateDots(outWidth, outHeight, duration)
  const drawboxFilters = buildDrawboxFilters(dots)

  if (import.meta.env.DEV) {
    console.log(`[dots] ${dots.length} dots`)
  }

  // Flicker expressions: slow projector-pulse drift (0.7 Hz) + faster film-stock
  // instability (3.3 Hz), superimposed. Lowercase t — eq's time var.
  const brightnessExpr =
    `${brightness}+0.04*sin(2*PI*t*0.7)+0.02*sin(2*PI*t*3.3)`
  const contrastExpr =
    `${contrast}+0.08*sin(2*PI*t*0.5)`

  const filterChain = [
    // Downscale FIRST — everything downstream pays per-pixel cost
    `scale=${outWidth}:${outHeight}`,
    'hue=s=0',
    `eq=contrast='${contrastExpr}':brightness='${brightnessExpr}':eval=frame`,
    // Two-layer grain: temporal+uniform base + a uniform-only flicker accent layer
    `noise=alls=${noiseStrength}:allf=t+u`,
    'noise=alls=10:allf=u',
    // Procedural dust dots — one drawbox per dot, gated by its lifetime
    ...drawboxFilters,
    'vignette',
  ].join(',')

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

    if (import.meta.env.DEV) {
      console.log('[filterChain]', filterChain)
    }

    const args = [
      '-i', INPUT_NAME,
      '-vf', filterChain,
      '-an',
      '-threads', '1',           // libx264 in WASM-MT deadlocks when threads > 1
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      OUTPUT_NAME,
    ]

    // 3-minute timeout — unsupported codecs (e.g. HEVC) make ffmpeg.wasm hang at frame 1
    // instead of erroring out. The timeout converts the hang into a user-visible error.
    const exitCode = await Promise.race([
      ff.exec(args),
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

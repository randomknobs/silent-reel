import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

const CORE_VERSION = '0.12.10'
const BASE_URL = `https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/esm`

let instance: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

/**
 * Lazily load and return a shared FFmpeg instance.
 * Multi-threaded core requires COOP/COEP headers + SharedArrayBuffer.
 */
export async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error(
        'SharedArrayBuffer is not available. COOP/COEP headers may be missing — required for multi-threaded ffmpeg.wasm.'
      )
    }

    const ff = new FFmpeg()

    // Log ffmpeg's own output to console for debugging filter chains
    ff.on('log', ({ message }) => {
      if (message.includes('Error') || message.includes('error')) {
        console.error('[ffmpeg]', message)
      }
    })

    await ff.load({
      coreURL: await toBlobURL(`${BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
      workerURL: await toBlobURL(`${BASE_URL}/ffmpeg-core.worker.js`, 'text/javascript'),
    })

    instance = ff
    return ff
  })()

  return loadPromise
}

export function isFFmpegLoaded(): boolean {
  return instance !== null
}

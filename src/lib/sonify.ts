import { Mp3Encoder } from '@breezystack/lamejs'
import type {
  BrightnessResult,
  ExtractOpts,
  Scale,
  SonifyEvent,
  SonifyOpts,
  SonifyProgress,
  SonifyResult,
} from '../types/sonify'

// ── Constants ────────────────────────────────────────────────────────────────

const SCALES: Record<Scale, number[]> = {
  major:              [0, 2, 4, 5, 7, 9, 11],
  minor:              [0, 2, 3, 5, 7, 8, 10],
  major_pentatonic:   [0, 2, 4, 7, 9],
  minor_pentatonic:   [0, 3, 5, 7, 10],
  blues:              [0, 3, 5, 6, 7, 10],
  dorian:             [0, 2, 3, 5, 7, 9, 10],
  phrygian:           [0, 1, 3, 5, 7, 8, 10],
  phrygian_dominant:  [0, 1, 4, 5, 7, 8, 10],
  lydian:             [0, 2, 4, 6, 7, 9, 11],
  mixolydian:         [0, 2, 4, 5, 7, 9, 10],
  harmonic_minor:     [0, 2, 3, 5, 7, 8, 11],
  whole_tone:         [0, 2, 4, 6, 8, 10],
  chromatic:          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  japanese_hirajoshi: [0, 2, 3, 7, 8],
}

const DENSITY_TO_THRESHOLD: Record<string, number> = {
  sparse: 0.08,
  medium: 0.05,
  dense:  0.03,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function gaussianFilter1d(input: Float32Array, sigma: number): Float32Array {
  if (sigma <= 0) return input
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernelSize = 2 * radius + 1
  const kernel = new Float32Array(kernelSize)
  let sum = 0
  for (let i = 0; i < kernelSize; i++) {
    const x = i - radius
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma))
    sum += kernel[i]
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= sum

  const output = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) {
    let acc = 0
    for (let j = -radius; j <= radius; j++) {
      const idx = Math.min(input.length - 1, Math.max(0, i + j))
      acc += input[idx] * kernel[j + radius]
    }
    output[i] = acc
  }
  return output
}

function expandScale(scaleName: Scale, baseMidi: number, topMidi: number): number[] {
  const intervals = SCALES[scaleName] || SCALES.major_pentatonic
  const notes: number[] = []
  for (let octave = 0; octave < 11; octave++) {
    let any = false
    for (const iv of intervals) {
      const m = baseMidi + iv + octave * 12
      if (m > topMidi) break
      if (m >= baseMidi) { notes.push(m); any = true }
    }
    if (!any && octave > 0) break
  }
  return notes
}

function quantizeBrightnessToMidi(b: number, scaleNotes: number[]): number {
  const idx = Math.min(scaleNotes.length - 1, Math.max(0, Math.floor(b * scaleNotes.length)))
  return scaleNotes[idx]
}

function detectOnsets(brightness: Float32Array, fps: number, threshold: number, minGapMs: number): number[] {
  const onsets: number[] = []
  if (brightness.length < 3) return onsets
  const N = brightness.length
  const deriv = new Float32Array(N)
  for (let i = 1; i < N - 1; i++) {
    deriv[i] = (brightness[i + 1] - brightness[i - 1]) * 0.5 * fps
  }
  const minGap = Math.max(1, Math.round((minGapMs / 1000) * fps))
  let last = -minGap - 1
  for (let i = 1; i < N - 1; i++) {
    const a = Math.abs(deriv[i])
    if (a > threshold && (i - last) >= minGap) {
      if (a >= Math.abs(deriv[i - 1]) && a >= Math.abs(deriv[i + 1])) {
        onsets.push(i)
        last = i
      }
    }
  }
  return onsets
}

function parseTimeString(s: unknown): number {
  if (typeof s === 'number') return s
  if (typeof s !== 'string') return 0
  const trimmed = s.trim()
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => parseFloat(p) || 0)
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  return parseFloat(trimmed) || 0
}

function refineKeyMoment(brightness: Float32Array, fps: number, timeSec: number, windowSec: number): number {
  const N = brightness.length
  const center = Math.round(timeSec * fps)
  const radius = Math.round(windowSec * fps)
  const lo = Math.max(1, center - radius)
  const hi = Math.min(N - 2, center + radius)
  let bestIdx = Math.max(1, Math.min(N - 2, center))
  let bestVal = -1
  for (let i = lo; i <= hi; i++) {
    const d = Math.abs(brightness[i + 1] - brightness[i - 1])
    if (d > bestVal) { bestVal = d; bestIdx = i }
  }
  return bestIdx
}

// ── Brightness extraction ────────────────────────────────────────────────────

export async function extractBrightnessFromVideo(videoBlob: Blob, opts: ExtractOpts = {}): Promise<BrightnessResult> {
  const downscale       = opts.downscale       ?? 8
  const centerFraction  = opts.centerFraction  ?? 0.5
  const smoothSigma     = opts.smoothSigma     ?? 2.0
  const sampleMode      = opts.sampleMode      ?? 'active'
  const onProgress      = opts.onProgress      ?? (() => {})

  // Offscreen near-invisible <video> element — Chrome won't pause it as
  // background-only media if it's attached to DOM with non-zero size.
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.style.cssText =
    'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.001;pointer-events:none;z-index:-9999;'
  document.body.appendChild(video)
  video.src = URL.createObjectURL(videoBlob)

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('failed to load video for brightness extraction'))
      setTimeout(() => reject(new Error('metadata load timeout')), 15000)
    })

    const fullW = video.videoWidth
    const fullH = video.videoHeight
    const dsW = Math.max(1, Math.floor(fullW / downscale))
    const dsH = Math.max(1, Math.floor(fullH / downscale))

    const canvas = document.createElement('canvas')
    canvas.width = dsW
    canvas.height = dsH
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('canvas 2d context not available')

    const frames: Uint8Array[] = []
    const frameTimes: number[] = []
    const activityMap = new Float32Array(dsW * dsH)
    let lastGray: Uint8Array | null = null

    const useVFC = typeof video.requestVideoFrameCallback === 'function'

    const captureFrame = (mediaTime: number) => {
      ctx.drawImage(video, 0, 0, dsW, dsH)
      const imgData = ctx.getImageData(0, 0, dsW, dsH)
      const rgba = imgData.data
      const gray = new Uint8Array(dsW * dsH)
      for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        gray[i] = (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) | 0
      }
      if (lastGray) {
        for (let i = 0; i < gray.length; i++) {
          activityMap[i] += Math.abs(gray[i] - lastGray[i])
        }
      }
      frames.push(gray)
      frameTimes.push(mediaTime)
      lastGray = gray
      onProgress(Math.min(1, mediaTime / (video.duration || 1)))
    }

    if (useVFC) {
      await new Promise<void>((resolve, reject) => {
        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
          captureFrame(metadata.mediaTime)
          if (!video.ended && !video.paused) {
            video.requestVideoFrameCallback(onFrame)
          }
        }
        video.requestVideoFrameCallback(onFrame)
        video.onended = () => resolve()
        video.onerror = () => reject(new Error('video playback error'))
        setTimeout(() => reject(new Error('extraction timeout')), (video.duration + 30) * 1000)
        video.play().catch(reject)
      })
    } else {
      await new Promise<void>((resolve, reject) => {
        let stopped = false
        const intervalMs = 1000 / 30
        const tick = () => {
          if (stopped || video.ended) return
          captureFrame(video.currentTime)
          setTimeout(tick, intervalMs)
        }
        video.onended = () => { stopped = true; resolve() }
        video.onerror = () => reject(new Error('video playback error'))
        setTimeout(() => { stopped = true; reject(new Error('extraction timeout')) }, (video.duration + 30) * 1000)
        video.play().catch(reject)
        tick()
      })
    }

    let fps = 30
    if (frameTimes.length >= 2) {
      const span = frameTimes[frameTimes.length - 1] - frameTimes[0]
      if (span > 0) fps = (frameTimes.length - 1) / span
    }

    let pixel: { x: number; y: number } | null = null
    let brightness: Float32Array

    if (sampleMode === 'full') {
      brightness = new Float32Array(frames.length)
      for (let i = 0; i < frames.length; i++) {
        let sum = 0
        const fr = frames[i]
        for (let j = 0; j < fr.length; j++) sum += fr[j]
        brightness[i] = (sum / fr.length) / 255
      }
    } else if (sampleMode === 'center') {
      const cx = dsW >> 1
      const cy = dsH >> 1
      pixel = { x: cx * downscale, y: cy * downscale }
      brightness = new Float32Array(frames.length)
      for (let i = 0; i < frames.length; i++) {
        brightness[i] = frames[i][cy * dsW + cx] / 255
      }
    } else {
      // 'active' — max-activity pixel in central region
      const yMin = Math.floor(dsH * (1 - centerFraction) / 2)
      const yMax = Math.ceil(dsH * (1 + centerFraction) / 2)
      const xMin = Math.floor(dsW * (1 - centerFraction) / 2)
      const xMax = Math.ceil(dsW * (1 + centerFraction) / 2)

      let bestActivity = -1
      let bestX = (xMin + xMax) >> 1
      let bestY = (yMin + yMax) >> 1
      for (let y = yMin; y < yMax; y++) {
        for (let x = xMin; x < xMax; x++) {
          const a = activityMap[y * dsW + x]
          if (a > bestActivity) {
            bestActivity = a
            bestX = x
            bestY = y
          }
        }
      }
      pixel = { x: bestX * downscale, y: bestY * downscale }

      brightness = new Float32Array(frames.length)
      const pixelIdx = bestY * dsW + bestX
      for (let i = 0; i < frames.length; i++) {
        brightness[i] = frames[i][pixelIdx] / 255
      }

      if (import.meta.env.DEV) {
        console.log(
          `[brightness] active pixel ~(${pixel.x}, ${pixel.y}) of ${fullW}×${fullH}, ` +
          `activity score: ${bestActivity.toFixed(2)}`,
        )
      }
    }

    if (smoothSigma > 0) {
      brightness = gaussianFilter1d(brightness, smoothSigma)
    }

    return {
      brightness,
      fps,
      pixel,
      dims: { w: fullW, h: fullH },
    }
  } finally {
    URL.revokeObjectURL(video.src)
    try { video.remove() } catch (_) { /* noop */ }
  }
}

// ── Voice synthesis ──────────────────────────────────────────────────────────

function scheduleSonifyVoice(
  ctx: OfflineAudioContext,
  freq: number,
  startTime: number,
  dur: number,
  dest: AudioNode,
  amplitude: number,
  attackSec: number = 0.008,
) {
  const amp = amplitude ?? 0.4
  const t = startTime
  const totalDur = Math.max(dur, 0.05)
  const attackT = attackSec
  const peakT = t + attackT
  const endT = t + totalDur
  const tailT = endT + 0.02

  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(amp, peakT)
  gain.gain.exponentialRampToValueAtTime(0.0001, endT)

  osc.connect(gain).connect(dest)
  osc.start(t)
  osc.stop(tailT)
}

export async function sonifyBrightness(
  brightnessResult: BrightnessResult,
  opts: SonifyOpts = {},
): Promise<AudioBuffer> {
  const brightness = brightnessResult.brightness
  const fps = brightnessResult.fps
  if (!brightness || !brightness.length || !fps) {
    throw new Error('sonifyBrightness: invalid brightnessResult')
  }

  const an = opts.analysis ?? null
  const scale: Scale = (opts.scale ?? an?.recommended_scale ?? 'major_pentatonic') as Scale
  const density = (opts.density ?? an?.recommended_density ?? 'medium')
  const rawKM = opts.keyMoments ?? an?.key_moments ?? []

  const duration = brightness.length / fps
  const keyMoments = (rawKM as Array<unknown>).map((km) => {
    if (typeof km === 'number') return km
    if (typeof km === 'string') return parseTimeString(km)
    if (km && typeof km === 'object') {
      const obj = km as { time?: unknown; timestamp?: unknown }
      if (obj.time !== undefined) return parseTimeString(obj.time)
      if (obj.timestamp !== undefined) return parseTimeString(obj.timestamp)
    }
    return -1
  }).filter((t) => t > 0 && t < duration)

  const threshold     = DENSITY_TO_THRESHOLD[density] ?? DENSITY_TO_THRESHOLD.medium
  const midiBase      = opts.midiBase      ?? 60
  const midiTop       = opts.midiTop       ?? 84
  const offsetMs      = opts.offsetMs      ?? -200
  const accentVolume  = opts.accentVolume  ?? 1.5
  const accentPauseMs = opts.accentPauseMs ?? 600
  const minDecayMs    = opts.minDecayMs    ?? 150
  const maxDecayMs    = opts.maxDecayMs    ?? 1500
  const sampleRate    = opts.sampleRate    ?? 44100
  const onProgress    = opts.onProgress    ?? (() => {})

  const scaleNotes = expandScale(scale, midiBase, midiTop)
  const offsetSec  = offsetMs / 1000

  const accentFrames = keyMoments.map((t) => refineKeyMoment(brightness, fps, t, 1.0))
  accentFrames.sort((a, b) => a - b)
  const accentSet = new Set(accentFrames)

  // Density-adaptive minimum gap between onsets — sparse breathes, dense fills.
  const DENSITY_TO_MIN_GAP_MS: Record<string, number> = {
    sparse: 350,   // ~3 events/sec max — leaves breathing room
    medium: 180,
    dense:  100,
  }
  const minGapMs = DENSITY_TO_MIN_GAP_MS[density] ?? 180
  const onsets = detectOnsets(brightness, fps, threshold, minGapMs)

  const accentPauseFrames = Math.round((accentPauseMs / 1000) * fps)
  function inAccentPause(frame: number): boolean {
    for (let i = 0; i < accentFrames.length; i++) {
      const af = accentFrames[i]
      if (frame > af && frame <= af + accentPauseFrames) return true
    }
    return false
  }

  const events: SonifyEvent[] = []
  for (const af of accentFrames) events.push({ type: 'chord', frame: af })
  for (const oi of onsets) {
    if (accentSet.has(oi)) continue
    if (inAccentPause(oi)) continue
    events.push({ type: 'note', frame: oi })
  }
  events.sort((a, b) => a.frame - b.frame)

  // Infer effective tempo from onset timing. Median IOI maps to BPM under
  // density-dependent subdivision: sparse onsets = quarters, medium = eighths,
  // dense = sixteenths. Pass this BPM to Suno later so its beat grid locks
  // to the same pulse our accents fall on.
  let inferredBpm: number | null = null
  if (onsets.length > 3) {
    const onsetTimes = onsets.map((f) => f / fps)
    const iois = onsetTimes.slice(1).map((t, i) => t - onsetTimes[i])
    iois.sort((a, b) => a - b)
    const medianIoi = iois[Math.floor(iois.length / 2)]

    const subdivPerBeat: Record<string, number> = {
      sparse: 1,    // onset = quarter note
      medium: 2,    // onset = eighth note
      dense:  4,    // onset = sixteenth note
    }
    const subdiv = subdivPerBeat[density] ?? 2
    const rawBpm = (60 / medianIoi) / subdiv
    inferredBpm = Math.round(Math.max(50, Math.min(180, rawBpm)))

    if (import.meta.env.DEV) {
      console.log(
        `[sonify] inferred tempo: ${inferredBpm} BPM ` +
        `(median IOI ${medianIoi.toFixed(3)}s, density=${density}, subdiv=${subdiv})`,
      )
    }
  }

  if (import.meta.env.DEV && events.length === 0) {
    console.warn('[sonify] no events to render; brightness curve may be too flat')
  }

  const releaseTailSec = 2.0
  const totalDuration = duration + releaseTailSec + Math.max(0, offsetSec)
  const totalFrames = Math.ceil(totalDuration * sampleRate)

  const offCtx = new OfflineAudioContext(1, totalFrames, sampleRate)

  const masterGain = offCtx.createGain()
  masterGain.gain.value = opts.masterGain ?? 0.5
  masterGain.connect(offCtx.destination)

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const tEv = ev.frame / fps + offsetSec
    if (tEv < 0) continue

    let nextT = duration
    if (i + 1 < events.length) nextT = events[i + 1].frame / fps + offsetSec
    const gap = nextT - tEv
    const decay = Math.max(minDecayMs / 1000, Math.min(maxDecayMs / 1000, gap))

    const b = Math.max(0, Math.min(1, brightness[ev.frame]))

    if (ev.type === 'note') {
      const midi = quantizeBrightnessToMidi(b, scaleNotes)
      const freq = midiToFreq(midi)
      // Velocity from onset strength — local brightness derivative magnitude.
      // Strong frame-to-frame changes → loud notes; subtle changes → quiet notes.
      // Creates micro-dynamic groove instead of flat 0.4 across all notes.
      const onsetStrength = ev.frame > 0 && ev.frame < brightness.length - 1
        ? Math.abs(brightness[ev.frame + 1] - brightness[ev.frame - 1]) * fps
        : 0.05
      // threshold (≈0.08 for sparse) is the "soft" baseline; 3×threshold is "loud".
      const amp = Math.max(0.15, Math.min(0.7, 0.15 + (onsetStrength / threshold) * 0.18))
      scheduleSonifyVoice(offCtx, freq, tEv, decay, masterGain, amp)
    } else {
      const baseIdx = Math.min(scaleNotes.length - 1, Math.max(0, Math.floor(b * scaleNotes.length)))
      // Root in middle register, third + fifth, plus octave below (weight) and
      // octave above (sparkle). Spreads accent across 3 octaves so it doesn't
      // compete with melody notes in the same register.
      const centerMidi = scaleNotes[baseIdx]
      const thirdMidi  = scaleNotes[Math.min(scaleNotes.length - 1, baseIdx + 2)]
      const fifthMidi  = scaleNotes[Math.min(scaleNotes.length - 1, baseIdx + 4)]
      const chordMidis = [
        centerMidi - 12,   // bass octave below — weight
        centerMidi,         // root
        thirdMidi,          // third
        fifthMidi,          // fifth
        centerMidi + 12,    // octave above — sparkle/click
      ]

      const accentGain = offCtx.createGain()
      accentGain.gain.value = accentVolume
      accentGain.connect(masterGain)
      const accentDecay = maxDecayMs / 1000
      const accentAttack = 0.002  // sharp percussive attack (2 ms vs default 8 ms)
      for (const midi of chordMidis) {
        scheduleSonifyVoice(offCtx, midiToFreq(midi), tEv, accentDecay, accentGain, 0.55, accentAttack)
      }
    }

    if ((i & 31) === 0) onProgress(i / Math.max(1, events.length))
  }

  if (import.meta.env.DEV) {
    console.log(
      `[sonify] scale=${scale} density=${density} threshold=${threshold}, ` +
      `${onsets.length} onsets + ${accentFrames.length} accents = ${events.length} events, ` +
      `rendering ${totalDuration.toFixed(2)}s at ${sampleRate}Hz mono`,
    )
  }

  const buf = await offCtx.startRendering()
  // Stash inferred BPM on the buffer — AudioBuffer doesn't carry metadata.
  ;(buf as unknown as { __inferredBpm?: number }).__inferredBpm = inferredBpm ?? undefined
  return buf
}

// ── MP3 encoding ─────────────────────────────────────────────────────────────

export function audioBufferToMp3Blob(buffer: AudioBuffer): Blob {
  const sr = buffer.sampleRate
  const len = buffer.length
  const mp3enc = new Mp3Encoder(1, sr, 128)
  const bs = 1152
  const mp3Data: Uint8Array[] = []
  const mono = new Int16Array(len)
  const numCh = buffer.numberOfChannels

  if (numCh === 1) {
    const ch = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) {
      mono[i] = Math.max(-32768, Math.min(32767, Math.floor(ch[i] * 32768)))
    }
  } else {
    const l = buffer.getChannelData(0)
    const r = buffer.getChannelData(1)
    for (let i = 0; i < len; i++) {
      mono[i] = Math.max(-32768, Math.min(32767, Math.floor(((l[i] + r[i]) / 2) * 32768)))
    }
  }

  for (let i = 0; i < mono.length; i += bs) {
    const chunk = mono.subarray(i, Math.min(i + bs, mono.length))
    const buf = mp3enc.encodeBuffer(chunk)
    if (buf.length > 0) mp3Data.push(buf)
  }
  const end = mp3enc.flush()
  if (end.length > 0) mp3Data.push(end)

  // TS 6 generic ArrayBufferLike defeats Blob's BlobPart inference for typed arrays.
  // lamejs always returns plain-ArrayBuffer-backed Uint8Array, so this cast is safe.
  return new Blob(mp3Data as Uint8Array<ArrayBuffer>[], { type: 'audio/mp3' })
}

// ── Top-level pipeline ───────────────────────────────────────────────────────

export async function sonifyVideoToMp3(
  videoBlob: Blob,
  analysis: SonifyOpts['analysis'] | null,
  opts: Omit<SonifyOpts, 'onProgress'> & {
    extractOpts?: ExtractOpts
    onProgress?: (p: SonifyProgress) => void
  } = {},
): Promise<SonifyResult> {
  const onProgress = opts.onProgress ?? (() => {})

  console.log('[sonify-start]', {
    blobSize: videoBlob.size,
    blobType: videoBlob.type,
    hasAnalysis: !!analysis,
    analysisFields: analysis ? Object.keys(analysis) : null,
  })

  onProgress({ stage: 'extract', progress: 0 })
  const r = await extractBrightnessFromVideo(videoBlob, {
    ...(opts.extractOpts || {}),
    onProgress: (p) => onProgress({ stage: 'extract', progress: p }),
  })

  onProgress({ stage: 'synth', progress: 0 })
  // Strip wrapper-level fields (extractOpts, staged onProgress) before forwarding to sonifyBrightness
  const { extractOpts: _ext, onProgress: _op, ...rest } = opts
  void _ext; void _op
  const synthOpts: SonifyOpts = {
    ...rest,
    analysis: analysis ?? rest.analysis,
    onProgress: (p: number) => onProgress({ stage: 'synth', progress: p }),
  }
  const buf = await sonifyBrightness(r, synthOpts)

  onProgress({ stage: 'encode', progress: 0 })
  const mp3Blob = audioBufferToMp3Blob(buf)
  onProgress({ stage: 'encode', progress: 1 })

  if (import.meta.env.DEV) {
    console.log(
      `[sonify] MP3 ready: ${(mp3Blob.size / 1024).toFixed(1)} KB, ${buf.duration.toFixed(2)}s`,
    )
  }

  return {
    mp3Blob,
    durationSec: buf.duration,
    sampleRate: buf.sampleRate,
    extractInfo: {
      fps: r.fps,
      pixel: r.pixel,
      dims: r.dims,
      frames: r.brightness.length,
    },
    inferredBpm: (buf as unknown as { __inferredBpm?: number }).__inferredBpm ?? null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ALIGNMENT — match Suno output timing to original sonification via
//  cross-correlation of onset envelopes.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Per-frame RMS energy followed by half-wave-rectified derivative.
 * Returns a Float32Array at targetFps temporal resolution.
 */
export function computeOnsetEnvelope(audioBuffer: AudioBuffer, targetFps = 100): Float32Array {
  const sampleRate = audioBuffer.sampleRate
  const samplesPerFrame = Math.max(1, Math.round(sampleRate / targetFps))
  const channel = audioBuffer.getChannelData(0)
  const numFrames = Math.floor(channel.length / samplesPerFrame)

  const energy = new Float32Array(numFrames)
  for (let i = 0; i < numFrames; i++) {
    const start = i * samplesPerFrame
    const end = Math.min(start + samplesPerFrame, channel.length)
    let sumSq = 0
    for (let j = start; j < end; j++) sumSq += channel[j] * channel[j]
    energy[i] = Math.sqrt(sumSq / (end - start))
  }

  const onset = new Float32Array(numFrames)
  for (let i = 1; i < numFrames; i++) {
    const d = energy[i] - energy[i - 1]
    onset[i] = d > 0 ? d : 0
  }
  return onset
}

/** Normalize a signal to zero mean, unit variance. */
export function zScoreNormalize(arr: Float32Array): Float32Array {
  const n = arr.length
  if (n === 0) return arr
  let mean = 0
  for (let i = 0; i < n; i++) mean += arr[i]
  mean /= n
  let variance = 0
  for (let i = 0; i < n; i++) {
    const d = arr[i] - mean
    variance += d * d
  }
  variance /= n
  const stddev = Math.sqrt(variance) || 1
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = (arr[i] - mean) / stddev
  return out
}

/**
 * Cross-correlate signal against reference. Returns best lag (in frames) and score.
 * For each lag value in [0, maxLagFrames], computes dot product of
 * signal[lag : lag + |reference|] with reference.
 */
export function crossCorrelate(
  signal: Float32Array,
  reference: Float32Array,
  maxLagFrames: number,
): { lag: number; score: number } {
  const refLen = reference.length
  const lagLimit = Math.min(maxLagFrames, Math.max(0, signal.length - refLen))
  let bestLag = 0
  let bestScore = -Infinity
  for (let lag = 0; lag <= lagLimit; lag++) {
    let score = 0
    for (let i = 0; i < refLen; i++) {
      score += signal[i + lag] * reference[i]
    }
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  return { lag: bestLag, score: bestScore }
}

/** Trim an AudioBuffer to [startSec, endSec], clamped to buffer range. */
export function trimAudioBufferRange(buf: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const sr = buf.sampleRate
  const startSample = Math.max(0, Math.floor(startSec * sr))
  const endSample = Math.min(buf.length, Math.floor(endSec * sr))
  const length = Math.max(1, endSample - startSample)
  const out = new AudioBuffer({
    numberOfChannels: buf.numberOfChannels,
    length,
    sampleRate: sr,
  })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch)
    const dst = out.getChannelData(ch)
    dst.set(src.subarray(startSample, endSample))
  }
  return out
}

export interface AlignmentResult {
  alignedBlob: Blob
  lagSec: number
  score: number
  sunoOriginalDuration: number
  alignedDuration: number
}

/**
 * Align a Suno track to a sonification reference. Fetches the Suno URL,
 * decodes, cross-correlates onset envelopes, and trims to the matching window.
 */
export async function alignSunoToSonification(
  sunoUrl: string,
  sonifiedMp3Blob: Blob,
  opts: { maxLagSec?: number; envFps?: number } = {},
): Promise<AlignmentResult> {
  const maxLagSec = opts.maxLagSec ?? 30
  const envFps = opts.envFps ?? 100

  // 1. Download Suno track
  const sunoRes = await fetch(sunoUrl)
  if (!sunoRes.ok) throw new Error(`Suno track fetch failed: ${sunoRes.status}`)
  const sunoArrBuf = await sunoRes.arrayBuffer()

  // 2. Decode both audios
  const audioCtx = new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  const sunoBuf = await audioCtx.decodeAudioData(sunoArrBuf.slice(0))
  const sonifiedArr = await sonifiedMp3Blob.arrayBuffer()
  const sonifiedBuf = await audioCtx.decodeAudioData(sonifiedArr)

  // 3. Onset envelopes, normalized
  const sunoEnv = zScoreNormalize(computeOnsetEnvelope(sunoBuf, envFps))
  const sonEnv = zScoreNormalize(computeOnsetEnvelope(sonifiedBuf, envFps))

  // Edge case: Suno V5 sometimes generates variants shorter than the sonification.
  // Standard cross-correlation (Suno as signal, sonification as reference) breaks
  // because signal.length < reference.length. Flip: use Suno envelope as the
  // SHORT pattern, search where it best fits within sonification. Then keep
  // Suno as-is (no trimming) — it's already shorter than the target window.
  if (sunoBuf.duration < sonifiedBuf.duration - 0.5) {
    const maxFlipLag = Math.max(0, sonEnv.length - sunoEnv.length)
    const { lag: lagFrames, score } = crossCorrelate(sonEnv, sunoEnv, maxFlipLag)
    const lagSec = lagFrames / envFps

    if (import.meta.env.DEV) {
      console.log(
        `[align] Suno (${sunoBuf.duration.toFixed(1)}s) shorter than sonification ` +
        `(${sonifiedBuf.duration.toFixed(1)}s); using as-is. score=${score.toFixed(2)}, ` +
        `inferred lag=${lagSec.toFixed(2)}s`,
      )
    }

    return {
      alignedBlob: audioBufferToMp3Blob(sunoBuf),
      lagSec,
      score,
      sunoOriginalDuration: sunoBuf.duration,
      alignedDuration: sunoBuf.duration,
    }
  }

  // 4. Standard case: Suno >= sonification, slide sonification across Suno
  const maxLagFrames = Math.round(maxLagSec * envFps)
  const { lag: lagFrames, score } = crossCorrelate(sunoEnv, sonEnv, maxLagFrames)
  const lagSec = lagFrames / envFps

  if (import.meta.env.DEV) {
    console.log(`[align] lag=${lagSec.toFixed(2)}s, score=${score.toFixed(2)}`)
  }

  // 5. Trim Suno buffer to [lagSec, lagSec + sonifiedDuration]
  const endSec = Math.min(lagSec + sonifiedBuf.duration, sunoBuf.duration)
  const aligned = trimAudioBufferRange(sunoBuf, lagSec, endSec)

  return {
    alignedBlob: audioBufferToMp3Blob(aligned),
    lagSec,
    score,
    sunoOriginalDuration: sunoBuf.duration,
    alignedDuration: aligned.duration,
  }
}

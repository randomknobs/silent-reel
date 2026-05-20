export type Scale =
  | 'major'
  | 'minor'
  | 'major_pentatonic'
  | 'minor_pentatonic'
  | 'blues'
  | 'dorian'
  | 'phrygian'
  | 'phrygian_dominant'
  | 'lydian'
  | 'mixolydian'
  | 'harmonic_minor'
  | 'whole_tone'
  | 'chromatic'
  | 'japanese_hirajoshi'

export type Density = 'sparse' | 'medium' | 'dense'

export type SampleMode = 'active' | 'center' | 'full'

export interface BrightnessResult {
  brightness: Float32Array
  fps: number
  pixel: { x: number; y: number } | null
  dims: { w: number; h: number }
}

export interface SonifyEvent {
  type: 'note' | 'chord'
  frame: number
}

export interface SonifyOpts {
  scale?: Scale
  density?: Density
  keyMoments?: Array<string | number | { time?: string | number; timestamp?: string | number }>
  analysis?: {
    recommended_scale?: Scale
    recommended_density?: Density
    key_moments?: Array<{ time: string; event: string; musical_cue: string }>
  }
  midiBase?: number
  midiTop?: number
  offsetMs?: number
  accentVolume?: number
  accentPauseMs?: number
  minDecayMs?: number
  maxDecayMs?: number
  sampleRate?: number
  masterGain?: number
  onProgress?: (progress: number) => void
}

export interface ExtractOpts {
  downscale?: number
  centerFraction?: number
  smoothSigma?: number
  sampleMode?: SampleMode
  onProgress?: (progress: number) => void
}

export interface SonifyResult {
  mp3Blob: Blob
  durationSec: number
  sampleRate: number
  extractInfo: {
    fps: number
    pixel: { x: number; y: number } | null
    dims: { w: number; h: number }
    frames: number
  }
  inferredBpm: number | null
}

export type SonifyProgressStage = 'extract' | 'synth' | 'encode'

export interface SonifyProgress {
  stage: SonifyProgressStage
  progress: number
}

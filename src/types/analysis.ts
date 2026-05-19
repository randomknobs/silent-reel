export interface KeyMoment {
  time: string          // e.g. "0:03"
  event: string         // visual description
  musical_cue: string   // suggested music response
}

export type CinemaGenre =
  | 'melodrama'
  | 'comedy'
  | 'adventure'
  | 'horror'
  | 'romance'
  | 'documentary'
  | 'slapstick'
  | 'tragedy'
  | 'mystery'
  | 'fantasy'

export type MusicalScale =
  | 'major'
  | 'major_pentatonic'
  | 'lydian'
  | 'mixolydian'
  | 'minor'
  | 'minor_pentatonic'
  | 'dorian'
  | 'harmonic_minor'
  | 'phrygian'
  | 'phrygian_dominant'
  | 'whole_tone'
  | 'chromatic'
  | 'japanese_hirajoshi'

export interface SceneAnalysis {
  mood: string
  cinema_genre: CinemaGenre
  scene_description: string
  setting: string
  energy: 'low' | 'medium' | 'high' | 'very_high'
  pace: 'slow' | 'medium' | 'fast' | 'variable'
  estimated_bpm: string
  genre_suggestions: string[]
  instruments: string[]
  production_style: string
  recommended_scale: MusicalScale
  alternative_scales: MusicalScale[]
  recommended_density: 'sparse' | 'medium' | 'dense'
  key_moments: KeyMoment[]
  music_prompt: string
}

export interface GeminiUsage {
  prompt_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

export interface AnalyzeResponse {
  analysis: SceneAnalysis
  usage: GeminiUsage
  modelUsed: string
}

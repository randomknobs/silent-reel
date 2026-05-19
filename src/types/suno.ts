export interface SunoTrack {
  title: string
  audioUrl: string
  streamUrl: string
  imageUrl: string
  imageLargeUrl: string
  duration: number
  ready: boolean
  sunoTags: string
}

export interface UploadResponse {
  uploadUrl: string
}

export interface CoverSubmitResponse {
  code?: number
  msg?: string
  data?: {
    taskId: string
  }
}

export type SunoStatus =
  | 'PENDING'
  | 'TEXT_SUCCESS'
  | 'FIRST_SUCCESS'
  | 'SUCCESS'
  | 'CREATE_TASK_FAILED'
  | 'GENERATE_AUDIO_FAILED'
  | 'CALLBACK_EXCEPTION'
  | 'SENSITIVE_WORD_ERROR'

export interface StatusResponse {
  status: SunoStatus
  tracks: SunoTrack[]
  _raw?: unknown
}

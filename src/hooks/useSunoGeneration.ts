import { useCallback, useState, useRef } from 'react'
import type { SunoTrack, SunoStatus } from '../types/suno'
import type { SceneAnalysis } from '../types/analysis'
import { alignSunoToSonification } from '../lib/sonify'
import type { AlignmentResult } from '../lib/sonify'

export type SunoGenStatus =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'submitting' }
  | { status: 'generating'; sunoStatus: SunoStatus; pollAttempt: number; tracks: SunoTrack[] }
  | { status: 'aligning'; tracks: SunoTrack[] }
  | { status: 'success'; tracks: SunoTrack[]; alignments: Array<{ trackIndex: number; result: AlignmentResult; alignedUrl: string }>; modelUsed: 'V5' }
  | { status: 'error'; error: string }

const POLL_INTERVAL_MS = 5000
const MAX_POLL_ATTEMPTS = 72  // = 6 minutes

export function useSunoGeneration() {
  const [state, setState] = useState<SunoGenStatus>({ status: 'idle' })
  const pollTimerRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const run = useCallback(async (
    sonifiedMp3: Blob,
    analysis: SceneAnalysis,
    sonifiedDurationSec: number,
    inferredBpm: number | null,
  ) => {
    stopPolling()
    setState({ status: 'uploading' })

    try {
      // Step 1: convert MP3 to base64 in chunks
      const arrayBuffer = await sonifiedMp3.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      const chunkSize = 8192
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
      }
      const audioBase64 = btoa(binary)

      // Step 2: upload to Kie CDN
      const uploadRes = await fetch('/api/file-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64 }),
      })
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({ error: `HTTP ${uploadRes.status}` }))
        throw new Error(`Upload failed: ${errData.error || uploadRes.status}`)
      }
      const { uploadUrl } = await uploadRes.json() as { uploadUrl: string }
      if (import.meta.env.DEV) console.log('[suno] uploaded to', uploadUrl)

      // Step 3: submit cover job
      setState({ status: 'submitting' })

      const sonifiedSec = Math.round(sonifiedDurationSec)
      const timingBlock =
        `Source audio is a rhythmic skeleton. Each transient marks a musical hit. ` +
        `Use dramatic pauses, rubato pacing, and dynamic variation. Cold open at 0:00, ` +
        `hard cut ending after ${sonifiedSec} seconds.`

      // If we measured an explicit tempo from the sonification, inject it as a
      // hard constraint — Suno will lock its beat grid to this BPM, ensuring its
      // kicks/snares fall on the same pulse our sonification accents do.
      const tempoBlock = inferredBpm !== null
        ? `\n\nTEMPO: exactly ${inferredBpm} BPM. Lock the beat grid to this tempo strictly.`
        : ''

      const finalPrompt = `${analysis.music_prompt}${tempoBlock}\n\n${timingBlock}`

      if (import.meta.env.DEV) {
        console.log(`[suno] tempo injection: ${inferredBpm ?? 'none'} BPM`)
      }
      const finalStyle = [
        analysis.cinema_genre,
        ...analysis.genre_suggestions,
        ...analysis.instruments,
      ].slice(0, 8).join(', ')
      const finalTitle = `Silent Reel — ${analysis.cinema_genre} (${analysis.estimated_bpm})`

      const submitRes = await fetch('/api/upload-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadUrl,
          prompt:       finalPrompt,
          style:        finalStyle,
          title:        finalTitle,
          instrumental: true,
        }),
      })
      if (!submitRes.ok) {
        const errData = await submitRes.json().catch(() => ({ msg: `HTTP ${submitRes.status}` }))
        throw new Error(`Cover submit failed: ${errData.msg || submitRes.status}`)
      }
      const submitData = await submitRes.json() as { data?: { taskId?: string }; msg?: string }
      const taskId = submitData?.data?.taskId
      if (!taskId) throw new Error(submitData?.msg || 'No taskId returned from Kie')
      if (import.meta.env.DEV) console.log('[suno] taskId:', taskId)

      // Step 4: poll status
      setState({ status: 'generating', sunoStatus: 'PENDING', pollAttempt: 0, tracks: [] })

      let attempts = 0
      pollTimerRef.current = window.setInterval(async () => {
        attempts++
        if (attempts > MAX_POLL_ATTEMPTS) {
          stopPolling()
          setState({ status: 'error', error: `Timeout after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s` })
          return
        }

        try {
          const statusRes = await fetch(`/api/status?taskId=${taskId}`)
          if (!statusRes.ok) {
            // Don't fail immediately on transient 5xx — keep polling
            console.warn('[suno] poll failed', statusRes.status)
            return
          }
          const data = await statusRes.json() as { status: SunoStatus; tracks: SunoTrack[] }
          const sunoStatus = (data.status || 'PENDING').toUpperCase() as SunoStatus
          const tracks = data.tracks || []

          if (import.meta.env.DEV) {
            console.log(`[suno] poll #${attempts} status=${sunoStatus} tracks=${tracks.length}`)
          }

          // Failure status codes
          if (
            sunoStatus === 'CREATE_TASK_FAILED' ||
            sunoStatus === 'GENERATE_AUDIO_FAILED' ||
            sunoStatus === 'CALLBACK_EXCEPTION' ||
            sunoStatus === 'SENSITIVE_WORD_ERROR'
          ) {
            stopPolling()
            setState({ status: 'error', error: `Suno failed: ${sunoStatus}` })
            return
          }

          // Still generating but tracks may be streaming
          if (sunoStatus !== 'SUCCESS') {
            setState({ status: 'generating', sunoStatus, pollAttempt: attempts, tracks })
            return
          }

          // SUCCESS — Suno finished, but its output may be 2-3 min and not exactly
          // timed to our sonification. Run cross-correlation alignment to find
          // the matching window and trim to that.
          stopPolling()
          if (tracks.length === 0) {
            setState({ status: 'error', error: 'Suno returned SUCCESS but no tracks' })
            return
          }

          setState({ status: 'aligning', tracks })

          try {
            // Align ALL tracks (Suno V5 returns 2 variants). Sort by correlation
            // score, expose all so the user can choose / download either.
            const alignmentPromises = tracks
              .filter(t => !!t.audioUrl)
              .map(async (t, idx) => {
                try {
                  const result = await alignSunoToSonification(t.audioUrl, sonifiedMp3)
                  return { trackIndex: idx, result, alignedUrl: URL.createObjectURL(result.alignedBlob) }
                } catch (e) {
                  console.warn(`[suno-align] track ${idx} failed:`, e)
                  return null
                }
              })

            const alignments = (await Promise.all(alignmentPromises))
              .filter((a): a is { trackIndex: number; result: AlignmentResult; alignedUrl: string } => a !== null)
              .sort((a, b) => b.result.score - a.result.score)

            if (alignments.length === 0) {
              throw new Error('All tracks failed to align')
            }

            if (import.meta.env.DEV) {
              alignments.forEach((a, i) => {
                console.log(
                  `[suno-align] rank #${i + 1}: track ${a.trackIndex + 1} ` +
                  `lag=${a.result.lagSec.toFixed(2)}s score=${a.result.score.toFixed(2)}`,
                )
              })
            }

            setState({ status: 'success', tracks, alignments, modelUsed: 'V5' })
          } catch (alignErr) {
            console.error('[suno-align] failed:', alignErr)
            setState({
              status: 'error',
              error: `Alignment failed: ${alignErr instanceof Error ? alignErr.message : 'unknown'}`,
            })
          }
        } catch (err) {
          console.warn('[suno] poll error', err)
          // Don't fail immediately on network — keep trying
        }
      }, POLL_INTERVAL_MS)
    } catch (err) {
      stopPolling()
      console.error('[suno-error]', err)
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown Suno generation error',
      })
    }
  }, [stopPolling])

  const reset = useCallback(() => {
    stopPolling()
    setState((prev) => {
      if (prev.status === 'success') {
        prev.alignments.forEach(a => URL.revokeObjectURL(a.alignedUrl))
      }
      return { status: 'idle' }
    })
  }, [stopPolling])

  return { state, run, reset }
}

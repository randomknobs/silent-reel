# SILENT REEL — Phase 1.5 (Claude Code Handoff)

You are Claude Code running in CLI on Sasha's macOS machine, working in `~/Documents/GitHub/silent-reel/`. Phase 1 is complete and deployed (https://silent-reels.netlify.app) — drop video, get B&W + grain + vignette styled output. You have project memory from Phases 0 and 1 — don't re-bootstrap.

Phase 1.5 is **visual identity layer**: take the spartan "B&W + grain + vignette" look and turn it into something that feels like 1920s celluloid footage. No new APIs, no backend, no audio, no bundled assets. **Pure ffmpeg.wasm with smarter filters, including procedurally-generated film scratches that are randomized per video.**

After Phase 1.5, **stop**. Phase 2 (Gemini analysis) is a separate session.

---

## What Phase 1.5 delivers

Two visual upgrade passes, both pure filter changes (zero external assets):

**Part A — Filter polish:**
1. **Boosted grain** — `noise=alls=18` → `noise=alls=24` plus a second uniform-only layer
2. **Flicker** — `eq` filter with `eval=frame` and sine-based time expressions; brightness and contrast oscillate at low frequencies, simulating film-stock instability and projector pulse

**Part B — Procedural film scratches:**
3. **Random scratches per video** — JS generates 8-12 scratch specifications (column position, time window, thickness, intensity) with `Math.random()`, then builds a `geq` filter expression that injects those scratches into the luminance plane. Each video gets a unique scratch pattern. No bundled assets, no Pixabay, no licensing.

Explicitly dropped from earlier discussion: film burn / light leaks. Sasha's call — focus on scratches only for now.

---

## Out of scope (do NOT touch)

- Anything in `/api/*` or `netlify/functions/` (Phase 2: Gemini integration)
- Any AI / network calls — Phase 1.5 is 100% browser
- Music, audio, sonification (Phase 3+)
- Bundled video assets / `/public/effects/` directory — we explicitly rejected this approach in favor of procedural scratches
- Film burn / light leaks — explicitly dropped from this phase
- HEVC / unsupported format auto-conversion (separate phase if ever needed)

If you find yourself writing `fetch('/api/...')` or `await ff.writeFile('scratches.mp4', ...)`, stop.

---

# PART A — Filter polish

## A.1 Update `src/lib/videoPipeline.ts` filter chain

The current `filterChain` is:
```ts
const filterChain = [
  'hue=s=0',
  `eq=contrast=${contrast}:brightness=${brightness}`,
  `noise=alls=${noiseStrength}:allf=t+u`,
  'vignette',
].join(',')
```

Replace with this expanded version (Part B adds one more line on top of this in §B.4):
```ts
// Slow projector-pulse drift (0.7 Hz) + faster film-stock instability (3.3 Hz),
// superimposed. Looks stochastic to the eye, but deterministic and cheap.
const brightnessExpr =
  `${brightness}+0.04*sin(2*PI*t*0.7)+0.02*sin(2*PI*t*3.3)`
const contrastExpr =
  `${contrast}+0.08*sin(2*PI*t*0.5)`

const filterChain = [
  'hue=s=0',
  `eq=contrast='${contrastExpr}':brightness='${brightnessExpr}':eval=frame`,
  // Two-layer grain: temporal+uniform base + a uniform-only flicker accent layer
  `noise=alls=${noiseStrength}:allf=t+u`,
  'noise=alls=10:allf=u',
  // Part B inserts `geq=lum='...'` here, after grain, before vignette
  'vignette',
].join(',')
```

Bump default `noiseStrength` in `StyleOptions` defaults from `18` → `24`.

`eval=frame` is critical — without it ffmpeg evaluates the expressions once at init, getting a single static value. With `eval=frame`, the expressions are re-evaluated every frame, producing the flicker.

## A.2 Test Part A standalone (optional checkpoint)

If Sasha wants to ship Part A before Part B for staged verification:

```bash
npx tsc --noEmit && npm run build       # both clean
npm run dev
```

Cmd+Q Chrome, fresh tab to http://localhost:5173/, drop `~/Downloads/test-5s.mp4`. Expected:
- Same processing flow as Phase 1 (~5-15 sec)
- Output: noticeably grainier than before, **brightness visibly pulses** at ~1 Hz with subtle faster jitter on top
- Duration matches input

If flicker looks too aggressive (motion-sickness territory), drop `0.04` → `0.02` in the brightness formula. If too subtle, push `0.04` → `0.06`. These are taste calls; ask Sasha.

Optional commit checkpoint:
```bash
git add . && git commit -m "feat: phase 1.5a — boosted grain and projector flicker"
```

Don't push yet — Part B follows in the same Phase 1.5 deliverable.

---

# PART B — Procedural film scratches

## B.1 The approach

We generate a list of scratch specifications in JS (per-video, randomized with `Math.random()`), then construct a `geq` filter expression that draws those scratches by modifying the luminance plane of each pixel.

Each scratch has:
- `baseX` — column position in pixels (slightly drifts via sine)
- `driftAmp` — drift amplitude (1-5 px)
- `driftFreq` — drift frequency (1-5 Hz)
- `tStart` / `tEnd` — when the scratch is visible (typical lifetime 80-400 ms)
- `thickness` — line width in pixels (1-2)
- `intensity` — brightness boost (180-255)

Per-scratch contribution at pixel (X, Y, T):
```
intensity * lt(abs(X - (baseX + driftAmp*sin(2*PI*T*driftFreq))), thickness)
          * between(T, tStart, tEnd)
```

Sum all scratch contributions, clamp at 255, add to original `lum(X,Y)`:
```
geq=lum='min(255, lum(X,Y) + scratch_1 + scratch_2 + ... + scratch_N)'
```

We don't touch `cb` and `cr` — geq's default behavior is to pass them through, which is exactly what we want (the video is already desaturated by `hue=s=0` upstream, so cb/cr are neutral anyway).

Variable case matters: in `geq` the time variable is uppercase `T`. In `eq` (Part A) it's lowercase `t`. ffmpeg-ism, both correct in their respective filters.

## B.2 Replace `getVideoDuration` with `getVideoMetadata`

The scratch generator needs width (to scale `baseX` positions) AND duration (to schedule `tStart`/`tEnd`). Combine into one metadata helper.

In `src/lib/videoPipeline.ts`, replace the existing `getVideoDuration` function with:

```ts
export interface VideoMetadata {
  duration: number   // seconds
  width: number      // pixels
  height: number     // pixels
}

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
```

If anything still imports `getVideoDuration`, update to use `getVideoMetadata` and pluck `.duration`.

## B.3 Add the scratch generator

Add to `src/lib/videoPipeline.ts` (above `applyStyle`):

```ts
interface ScratchSpec {
  baseX: number       // pixel column
  driftAmp: number    // px
  driftFreq: number   // Hz
  tStart: number      // seconds
  tEnd: number        // seconds
  thickness: number   // px
  intensity: number   // 0-255 luminance boost
}

/**
 * Generate a randomized list of film-scratch specs sized to the given
 * video dimensions and duration. Density scales with duration.
 */
function generateScratches(width: number, duration: number): ScratchSpec[] {
  // Density tuning: ~0.6 scratches per second on average.
  // Minimum 3 scratches even for very short clips so the effect is always visible.
  const numScratches = Math.max(3, Math.round(duration * 0.6))

  const scratches: ScratchSpec[] = []
  for (let i = 0; i < numScratches; i++) {
    const lifetime = 0.08 + Math.random() * 0.35   // 80–430 ms
    const tStart = Math.random() * Math.max(0.01, duration - lifetime)
    scratches.push({
      baseX: Math.random() * width,
      driftAmp: 1 + Math.random() * 4,
      driftFreq: 1 + Math.random() * 4,
      tStart,
      tEnd: tStart + lifetime,
      thickness: 1 + Math.random() * 1.0,         // 1.0–2.0 px (avoid sub-pixel lines)
      intensity: 180 + Math.floor(Math.random() * 75),  // 180–254
    })
  }

  return scratches
}

/**
 * Build the geq lum expression from a list of scratch specs.
 * Each scratch becomes one additive term; the whole sum is clamped at 255.
 */
function buildScratchExpression(scratches: ScratchSpec[]): string {
  const terms = scratches.map((s) => {
    // Column center with horizontal drift via sine
    const cx =
      `(${s.baseX.toFixed(2)}+${s.driftAmp.toFixed(2)}*sin(2*PI*T*${s.driftFreq.toFixed(3)}))`
    // 1 if pixel X is within `thickness` of column center
    const inColumn = `lt(abs(X-${cx}),${s.thickness.toFixed(2)})`
    // 1 if T is within scratch lifetime
    const inTime = `between(T,${s.tStart.toFixed(3)},${s.tEnd.toFixed(3)})`
    return `${s.intensity}*${inColumn}*${inTime}`
  })

  return `min(255,lum(X,Y)+${terms.join('+')})`
}
```

## B.4 Wire scratches into `applyStyle`

Update `applyStyle` in `src/lib/videoPipeline.ts`:

```ts
export async function applyStyle(
  videoBlob: Blob,
  opts: StyleOptions = {}
): Promise<Blob> {
  const contrast = opts.contrast ?? 1.25
  const brightness = opts.brightness ?? -0.05
  const noiseStrength = opts.noiseStrength ?? 24

  const ff = await getFFmpeg()

  // Get dimensions + duration. Width drives scratch column positioning;
  // duration drives scratch scheduling.
  const { duration, width } = await getVideoMetadata(videoBlob)

  // Generate procedural scratches — different every call
  const scratches = generateScratches(width, duration)
  const scratchExpr = buildScratchExpression(scratches)

  // Flicker expressions (lowercase `t` for eq filter, uppercase `T` for geq)
  const brightnessExpr =
    `${brightness}+0.04*sin(2*PI*t*0.7)+0.02*sin(2*PI*t*3.3)`
  const contrastExpr =
    `${contrast}+0.08*sin(2*PI*t*0.5)`

  const filterChain = [
    'hue=s=0',
    `eq=contrast='${contrastExpr}':brightness='${brightnessExpr}':eval=frame`,
    `noise=alls=${noiseStrength}:allf=t+u`,
    'noise=alls=10:allf=u',
    // Procedural scratches — uses uppercase T for time inside geq
    `geq=lum='${scratchExpr}'`,
    'vignette',
  ].join(',')

  const progressHandler = ({ progress, time }: { progress: number; time: number }) => {
    opts.onProgress?.({
      progress: Math.max(0, Math.min(1, progress)),
      time: time / 1_000_000,
    })
  }
  ff.on('progress', progressHandler)

  try {
    await ff.writeFile(INPUT_NAME, await fetchFile(videoBlob))

    const args = [
      '-i', INPUT_NAME,
      '-vf', filterChain,
      '-an',
      '-threads', '1',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      OUTPUT_NAME,
    ]

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
    const bytes = data instanceof Uint8Array
      ? data
      : new TextEncoder().encode(String(data))

    return new Blob([bytes], { type: 'video/mp4' })
  } finally {
    ff.off('progress', progressHandler)
    try { await ff.deleteFile(INPUT_NAME) } catch {}
    try { await ff.deleteFile(OUTPUT_NAME) } catch {}
  }
}
```

Note: this stays single-input `ffmpeg -i input.mp4 -vf "..."`. No `-filter_complex`, no `-stream_loop`, no multiple inputs. Much simpler than the asset-overlay approach we briefly considered.

## B.5 Optional: log scratch params for tuning

While iterating on the visual, it's useful to see what the generator produced. Add right before `ff.writeFile`:

```ts
if (import.meta.env.DEV) {
  console.log('[scratches]', scratches.length, 'scratches:', scratches)
  console.log('[filterChain]', filterChain)
}
```

Vite strips the `if (import.meta.env.DEV)` branch in production builds automatically. Safe to leave in.

## B.6 Test Part B

```bash
npx tsc --noEmit && npm run build      # both clean
npm run dev
```

Cmd+Q Chrome, fresh tab, drop `~/Downloads/test-5s.mp4`.

Expected:
- Processing takes longer than Phase 1 — `geq` with ~10 scratch terms per frame is expensive. Expect **~15-30 sec processing for 5-sec input** in single-threaded WASM. If much longer (>60 sec for 5-sec input), something's wrong — surface ffmpeg log and ask Sasha.
- Output video shows:
  - All Phase 1 effects (B&W, contrast, grain, vignette)
  - Part A additions (boosted grain, flicker)
  - **White vertical scratches flashing briefly at random columns**, ~3-5 visible per 5-sec clip on average
  - Each processing run produces different scratch positions/timing

**Do "Process another" with the same file at least twice** — verify the second run gives different scratches than the first. If they look identical, the generator is broken (probably called `Math.random()` at module load instead of inside the function).

## B.7 Visual tuning

Common adjustments after first prod test:

- **Too many scratches:** lower density in `generateScratches` — `0.6` → `0.3`.
- **Too few:** raise to `0.9` or `1.2`.
- **Scratches too thin / hard to see:** raise `thickness` range to `1.5 + Math.random() * 1.5` (1.5-3.0 px).
- **Scratches too bright (look like solid bars):** lower intensity range to `140 + Math.floor(Math.random() * 80)` (140-220).
- **Scratches too short-lived (flicker too fast):** raise lifetime to `0.15 + Math.random() * 0.5` (150-650 ms).
- **Want scratches that stay longer / drift more:** raise `driftAmp` to `2 + Math.random() * 8`.

All tuning is taste-driven. Default values are a reasonable starting point but expect Sasha to want adjustments after seeing first results.

## B.8 Commit + push

```bash
git add .
git commit -m "feat: phase 1.5 — flicker, boosted grain, procedural scratches"
git push
```

---

## Production verify

After push, wait for Netlify deploy (`npx netlify watch` or dashboard). Then:

```bash
SITE=https://silent-reels.netlify.app

curl -sf -o /dev/null -w "%{http_code}\n" "$SITE"                # 200
curl -sI "$SITE" | grep -i "cross-origin"                        # both headers
curl -sf "$SITE/api/ping"                                        # {"ok":true,...}
```

Then ask Sasha to do the visual test on production: drop a video, confirm scratches + flicker + grain are visible. Run twice with same file to confirm randomization works on prod.

---

## Report back

When Sasha confirms visual test passes, report in Russian:

```
Phase 1.5 готово.

Filter polish (grain boost + flicker): ✓
Procedural scratches (random per video): ✓
Локально: ✓
Build clean: ✓
Production smoke: ✓
Визуальная проверка: ✓ (2 прогона одного файла → разные царапины)

Готов идти в Phase 2 (Gemini-анализ стилизованного видео).
Жди handoff от Sasha в новой сессии.
```

Then **stop**. Do not start Phase 2. Phase 2 is Gemini integration — Netlify Function, API key in env, prompt design, JSON parsing. Different context, different session.

---

## Common pitfalls

- **TypeScript error about `getVideoDuration` being unused or removed** — make sure the old function is fully deleted and replaced with `getVideoMetadata`. Search the codebase for any lingering references.
- **`geq` expression syntax errors** — ffmpeg quotes are unforgiving. The whole expression goes inside single quotes in the filter argument: `geq=lum='...'`. Numbers inside the expression don't need quotes, but the whole expression does. `.toFixed(2)`/`.toFixed(3)` in JS avoids scientific notation from very small floats (`1e-7` will break the parser).
- **`Math.random()` called outside the function** — if you accidentally compute scratches at module load time (e.g. assigning to a `const`), every video gets the same set. Has to be inside `generateScratches`, called fresh each invocation of `applyStyle`.
- **Scratches show but don't move (no drift)** — check that `T` is uppercase in the geq expression. `t` (lowercase) is undefined in geq, evaluates to 0, all scratches will be motionless.
- **Output much slower than expected (>3x)** — geq with 12 scratch terms is a lot of math per pixel. If too slow, reduce density to 6-8 scratches max, or accept the cost. Don't switch to multi-threaded — we proved `-threads 1` is required and switching breaks Phase 1's hard-won stability.
- **Aborted() at end** — same cosmetic emscripten issue as Phase 1, encoding finished successfully. Don't fix unless it causes actual problems.
- **Scratches look like sharp pixelated bars, not film-like lines** — that's actually authentic for low-thickness values. If Sasha wants softer edges, replace `lt(abs(X-cx), thickness)` with a linear falloff: `max(0, 1 - abs(X-cx)/thickness)` and multiply by intensity. This makes the edges gradient. More expensive but prettier.

For anything else not covered here, ask Sasha rather than improvising. Phase 1.5 is bounded — if there's a surprise, escalate.

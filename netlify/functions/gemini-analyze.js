const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Cascade fallback: try newer model first, fall through to older if 5xx persists.
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash'];

const ANALYSIS_PROMPT = `You are analyzing a short video that has been stylized as a 1920s silent film (black and white, film grain, vignette, brightness flicker). Your job is to describe the scene and suggest a soundtrack a silent-film accompanist would play.

Watch carefully. Return ONLY valid JSON with these fields:

{
  "mood": "2-4 mood adjectives describing the emotional feel",
  "cinema_genre": "ONE of: melodrama | comedy | adventure | horror | romance | documentary | slapstick | tragedy | mystery | fantasy. Choose by visual content, not by music style.",
  "scene_description": "1-2 sentences describing what is shown, in cinematic terms (e.g. 'A woman gazes wistfully out a window in a dimly lit interior. Her stillness suggests longing or recollection.')",
  "setting": "where it takes place, 5-10 words",
  "energy": "low | medium | high | very_high",
  "pace": "slow | medium | fast | variable",
  "estimated_bpm": "BPM range for the music, e.g. 70-90",
  "genre_suggestions": ["3 musical genres that would fit a silent-film accompaniment to this scene"],
  "instruments": ["3-5 specific instruments — piano is default for silent film, but strings, organ, accordion, brass, woodwinds are all valid period choices"],
  "production_style": "cinematic | acoustic | orchestral | chamber | solo_piano | hybrid",

  "recommended_scale": "ONE of: major, major_pentatonic, lydian, mixolydian, minor, minor_pentatonic, dorian, harmonic_minor, phrygian, phrygian_dominant, whole_tone, chromatic, japanese_hirajoshi. Choose by mood: bright/comedic → major/major_pentatonic, sad/longing → minor/minor_pentatonic/dorian, dreamy → lydian, suspenseful → harmonic_minor, dark/foreboding → phrygian, dissonant/tense → chromatic.",
  "alternative_scales": ["2-3 other scales that could also work"],

  "recommended_density": "ONE of: sparse | medium | dense. DEFAULT to 'sparse' (most silent-film accompaniment is sparse piano). Use 'medium' for active scenes with sustained motion. Use 'dense' only for chase sequences, slapstick, or fast-cut action.",

  "key_moments": [
    {"time": "0:03", "event": "what happens visually", "musical_cue": "what the music could do here (e.g. 'soft tremolo', 'descending minor scale', 'staccato chords')"}
  ],
  "music_prompt": "Ready-to-use Suno prompt, ~30-40 words. Frame as silent-film soundtrack. Include genre, BPM, instruments, mood, and 'instrumental' (no vocals). Example: 'Wistful solo piano in A minor, 75 BPM, sparse and contemplative, occasional cello swell, silent-film era accompaniment, instrumental, lo-fi vintage character'."
}

Base analysis on visual content. The video has been stylized to look 1920s — base your read on the SCENE, not on the stylization itself (e.g. if it shows a modern street, describe a modern street; the silent-film treatment is just a costume).

If audio is present, note its emotional tone but never copy or describe specific dialogue.

Return JSON only. No preamble. No markdown. No backticks.`;


exports.handler = async function (event) {
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!GEMINI_API_KEY) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        error: 'GEMINI_API_KEY not set. Add it to Netlify Environment Variables and redeploy.',
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { videoBase64, mimeType } = body;
  if (!videoBase64) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'videoBase64 required' }) };
  }
  if (!mimeType || !mimeType.startsWith('video/')) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'mimeType must be a video/* type' }) };
  }

  // Estimate decoded size — base64 grows by ~33%
  const approxBytes = (videoBase64.length * 3) / 4;
  if (approxBytes > 18 * 1024 * 1024) {
    return {
      statusCode: 413,
      headers: cors,
      body: JSON.stringify({
        error: `Video too large for inline analysis (${(approxBytes / 1024 / 1024).toFixed(1)} MB). Max ~18 MB.`,
      }),
    };
  }

  const payload = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: videoBase64 } },
        { text: ANALYSIS_PROMPT },
      ],
    }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.4,
    },
  };

  // Model cascade with retry on 5xx
  let geminiRes = null;
  let geminiData = null;
  let lastErr = null;
  let usedModel = null;
  const maxAttempts = 3;

  outer: for (const model of GEMINI_MODELS) {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    console.log(`[gemini-analyze] trying model: ${model}`);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (geminiRes.status < 500) {
          geminiData = await geminiRes.json();
          usedModel = model;
          break outer;
        }
        geminiData = await geminiRes.json().catch(() => ({}));
        lastErr = `${model} ${geminiRes.status}`;
        console.warn(`[gemini-analyze] ${model} attempt ${attempt}/${maxAttempts} failed: ${lastErr}`);
      } catch (err) {
        lastErr = `${model} network: ${err.message}`;
        console.warn(`[gemini-analyze] ${model} attempt ${attempt}/${maxAttempts} network error: ${lastErr}`);
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
      }
    }
    if (geminiRes && geminiRes.ok) {
      usedModel = model;
      break;
    }
    console.warn(`[gemini-analyze] ${model} exhausted retries, falling through`);
    geminiRes = null;
    geminiData = null;
  }

  if (!geminiRes || !geminiRes.ok) {
    const status = geminiRes ? geminiRes.status : 503;
    return {
      statusCode: status,
      headers: cors,
      body: JSON.stringify({
        error: `All Gemini models exhausted: ${lastErr}`,
        details: geminiData || { networkError: lastErr },
        modelsAttempted: GEMINI_MODELS,
      }),
    };
  }

  console.log(`[gemini-analyze] succeeded with model: ${usedModel}`);

  const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return {
      statusCode: 502,
      headers: cors,
      body: JSON.stringify({ error: 'Gemini returned no text', raw: geminiData }),
    };
  }

  let analysis;
  try {
    analysis = JSON.parse(text);
  } catch (err) {
    return {
      statusCode: 502,
      headers: cors,
      body: JSON.stringify({
        error: 'Gemini did not return valid JSON',
        raw_text: text.slice(0, 500),
      }),
    };
  }

  const usage = geminiData.usageMetadata || {};

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      analysis,
      usage: {
        prompt_tokens: usage.promptTokenCount,
        output_tokens: usage.candidatesTokenCount,
        total_tokens: usage.totalTokenCount,
      },
      modelUsed: usedModel,
    }),
  };
};

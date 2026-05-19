const KIE_API_KEY = process.env.KIE_API_KEY;
const BASE_URL = 'https://api.kie.ai';

async function kieApiFetch(path, options) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${KIE_API_KEY}`,
    },
  });
}

exports.handler = async function (event) {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  if (!KIE_API_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'KIE_API_KEY not set' }) };
  }

  const taskId = event.queryStringParameters && event.queryStringParameters.taskId;
  if (!taskId) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'taskId required' }) };
  }

  try {
    const response = await kieApiFetch(
      `/api/v1/generate/record-info?taskId=${taskId}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    );
    const raw = await response.json();
    const taskStatus = raw?.data?.status || 'PENDING';
    const sunoData   = raw?.data?.response?.sunoData || [];

    const tracks = sunoData
      .filter(t => t.streamAudioUrl || t.audioUrl)
      .map(t => ({
        title:         t.title || t.tags || 'Track',
        audioUrl:      t.audioUrl       || t.streamAudioUrl || '',
        streamUrl:     t.streamAudioUrl || t.audioUrl       || '',
        imageUrl:      t.imageUrl  || '',
        imageLargeUrl: t.imageLargeUrl || t.image_large_url || t.imageUrl || '',
        duration:      t.duration  || 0,
        ready:         !!(t.streamAudioUrl || t.audioUrl),
        sunoTags:      t.tags || '',
      }));

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ status: taskStatus, tracks, _raw: raw }),
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};

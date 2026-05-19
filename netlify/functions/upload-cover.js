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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  if (!KIE_API_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'KIE_API_KEY not set' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { uploadUrl, prompt, style, title, instrumental } = body;
  if (!uploadUrl) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'uploadUrl required' }) };
  }

  const host = (event.headers && (event.headers['x-forwarded-host'] || event.headers['host'])) || '';
  const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
  const callBackUrl = host ? `${proto}://${host}/api/callback` : '';

  const coverPayload = {
    uploadUrl,
    customMode:          true,
    instrumental:        instrumental === true,
    model:               'V5',
    style:               (style || '').slice(0, 1000),
    title:               (title || 'Silent Reel Score').slice(0, 100),
    callBackUrl,
    audioWeight:         0.9,
    styleWeight:         0.85,
    weirdnessConstraint: 0.4,
  };
  if (prompt) {
    coverPayload.prompt = String(prompt).slice(0, 5000);
  }

  try {
    const coverRes = await kieApiFetch('/api/v1/generate/upload-cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(coverPayload),
    });
    const coverData = await coverRes.json();
    return { statusCode: coverRes.status, headers: cors, body: JSON.stringify(coverData) };
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: err.message, step: 'upload-cover' }),
    };
  }
};

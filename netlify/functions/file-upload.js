const KIE_API_KEY = process.env.KIE_API_KEY;
const UPLOAD_BASE_URL = 'https://kieai.redpandaai.co';

async function kieApiFetch(path, options) {
  return fetch(`${UPLOAD_BASE_URL}${path}`, {
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

  const { audioBase64 } = body;
  if (!audioBase64) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'audioBase64 required' }) };
  }

  try {
    const uploadRes = await kieApiFetch('/api/file-base64-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base64Data: audioBase64,
        uploadPath: 'silent-reel-sonifications',
        fileName: `sonification_${Date.now()}.mp3`,
      }),
    });

    const uploadData = await uploadRes.json();
    const fileUrl =
      uploadData?.data?.fileDownloadUrl ||
      uploadData?.data?.fileUrl ||
      uploadData?.data?.url ||
      uploadData?.data?.downloadUrl;

    if (!fileUrl) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: 'No file URL returned', kieResponse: uploadData }),
      };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ uploadUrl: fileUrl }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: err.message, step: 'file-upload' }),
    };
  }
};

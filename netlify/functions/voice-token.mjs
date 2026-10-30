/**
 * Mint xAI ephemeral client secret for browser Grok realtime voice.
 * Env: XAI_API_KEY (required). Optional: BCS_VOICE_XAI_KEY (alias, must start with xai-).
 * Never returns the API key. Requires portal auth cookie.
 */
import { isAuthenticated, corsHeaders as sharedCors } from '../lib/auth_shared.mjs';

const CLIENT_SECRETS_URL = 'https://api.x.ai/v1/realtime/client_secrets';
const REALTIME_WS =
  'wss://api.x.ai/v1/realtime?model=grok-voice-latest';

function corsHeaders(origin) {
  return {
    ...sharedCors(origin),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
}

function resolveXaiKey() {
  const primary = String(process.env.XAI_API_KEY || '').trim();
  if (primary.startsWith('xai-')) return primary;
  const alt = String(process.env.BCS_VOICE_XAI_KEY || '').trim();
  if (alt.startsWith('xai-')) return alt;
  // Never use OpenAI sk- keys for xAI voice
  return '';
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '*';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  if (!isAuthenticated(event)) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const apiKey = resolveXaiKey();
  if (!apiKey) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: 'Voice not configured',
        detail: 'XAI_API_KEY missing on server',
      }),
    };
  }

  let upstream;
  try {
    upstream = await fetch(CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: { seconds: 300 },
      }),
    });
  } catch {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Upstream unreachable' }),
    };
  }

  let data = {};
  try {
    data = await upstream.json();
  } catch {
    data = {};
  }

  if (!upstream.ok) {
    return {
      statusCode: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      headers,
      body: JSON.stringify({
        error: 'Failed to mint voice token',
        detail: typeof data?.error === 'string' ? data.error : data?.error?.message || undefined,
      }),
    };
  }

  const token = data.value || data.client_secret || data.secret || data.token;
  const expires_at = data.expires_at || null;
  if (!token || typeof token !== 'string') {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Malformed token response' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      token,
      expires_at,
      url: REALTIME_WS,
    }),
  };
}

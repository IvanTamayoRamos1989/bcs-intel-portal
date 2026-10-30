import { clearAuthCookieHeader, corsHeaders } from '../lib/auth_shared.mjs';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(origin || undefined),
    'Set-Cookie': clearAuthCookieHeader(),
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true }),
  };
}

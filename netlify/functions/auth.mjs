import crypto from 'node:crypto';
import {
  getPassword,
  signToken,
  authCookieHeader,
  corsHeaders,
  isAuthenticated,
} from '../lib/auth_shared.mjs';

function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(origin || undefined),
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: isAuthenticated(event) }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const password = typeof body.password === 'string' ? body.password : '';
  const expected = getPassword();
  if (!expected) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: 'Auth not configured' }),
    };
  }

  if (!safeEqualStr(password, expected)) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ ok: false, error: 'Invalid password' }),
    };
  }

  const token = signToken();
  if (!token) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: 'Session secret not configured' }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      ...headers,
      'Set-Cookie': authCookieHeader(token),
    },
    body: JSON.stringify({ ok: true }),
  };
}

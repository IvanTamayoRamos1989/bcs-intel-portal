/**
 * Shared portal auth helpers (Node functions).
 * Cookie: bcs_portal_auth=1.<hmac>  — password never embedded in client JS.
 */
import crypto from 'node:crypto';

export const COOKIE_NAME = 'bcs_portal_auth';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

export function getPassword() {
  return process.env.BCS_PORTAL_PASSWORD || '';
}

export function getSecret() {
  return process.env.BCS_PORTAL_SESSION_SECRET || '';
}

export function signToken() {
  const secret = getSecret();
  if (!secret) return null;
  const sig = crypto.createHmac('sha256', secret).update('bcs-portal-ok').digest('hex');
  return `1.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const expected = signToken();
  if (!expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header)
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i < 0) return;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      out[k] = decodeURIComponent(v);
    });
  return out;
}

export function isAuthenticated(event) {
  const cookies = parseCookies(event.headers?.cookie || event.headers?.Cookie || '');
  return verifyToken(cookies[COOKIE_NAME]);
}

export function authCookieHeader(token) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  return parts.join('; ');
}

export function clearAuthCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };
}

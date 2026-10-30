/**
 * Stakeholders directory CRUD — Netlify Blobs persistence.
 * Seed from stakeholders_seed.json when blob empty.
 * Writes require portal auth cookie.
 */
import { getStore, connectLambda } from '@netlify/blobs';
import { isAuthenticated, corsHeaders } from '../lib/auth_shared.mjs';
import seed from './stakeholders_seed.json' with { type: 'json' };

const STORE_NAME = 'bcs-portal';
const KEY = 'stakeholders-directory';

function openStore() {
  const siteID =
    process.env.SITE_ID ||
    process.env.NETLIFY_SITE_ID ||
    'a07498b1-eb96-4477-aaad-5d1361741116';
  const token =
    process.env.NETLIFY_BLOBS_TOKEN ||
    process.env.BLOBS_TOKEN ||
    process.env.NETLIFY_API_TOKEN ||
    process.env.NETLIFY_AUTH_TOKEN ||
    '';
  // After connectLambda, plain getStore should work. Explicit creds as fallback.
  try {
    return getStore(STORE_NAME);
  } catch (e1) {
    if (!token) throw e1;
    return getStore({ name: STORE_NAME, siteID, token, consistency: 'strong' });
  }
}


function json(status, body, origin) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin || undefined),
    },
    body: JSON.stringify(body),
  };
}

function normalizeList(data) {
  if (!data) return null;
  if (Array.isArray(data)) {
    return { version: 1, updated: new Date().toISOString().slice(0, 10), items: data };
  }
  if (data.items && Array.isArray(data.items)) return data;
  return null;
}

function newId(items) {
  let max = 0;
  for (const it of items) {
    const m = String(it.id || '').match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `st-${String(max + 1).padStart(3, '0')}`;
}

function sanitizeRow(input, { requireName = true } = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (requireName && !name) return { error: 'name required' };
  const type = ['person', 'institution', 'business'].includes(input.type)
    ? input.type
    : 'person';
  return {
    name,
    description: typeof input.description === 'string' ? input.description.trim() : '',
    contact: typeof input.contact === 'string' ? input.contact.trim() : '',
    group: typeof input.group === 'string' ? input.group.trim() : '',
    subgroup: typeof input.subgroup === 'string' ? input.subgroup.trim() : '',
    type,
    org: typeof input.org === 'string' && input.org.trim() ? input.org.trim() : null,
  };
}

async function loadDirectory(store) {
  try {
    const raw = await store.get(KEY, { type: 'json' });
    const norm = normalizeList(raw);
    if (norm && norm.items.length) return { data: norm, from: 'blob' };
  } catch {
    /* empty / missing */
  }
  const seeded = normalizeList(seed) || { version: 1, items: [], updated: null };
  try {
    await store.setJSON(KEY, seeded);
  } catch (e) {
    console.warn('seed write failed', e?.message || e);
  }
  return { data: seeded, from: 'seed' };
}

export async function handler(event, context) {
  try {
    // @netlify/blobs connectLambda expects the Lambda event (not context)
    if (typeof connectLambda === 'function') connectLambda(event);
  } catch (e) {
    console.warn('connectLambda', e?.message || e);
  }
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const method = event.httpMethod || 'GET';

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders(origin || undefined),
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      },
      body: '',
    };
  }

  let store = null;
  let storeError = null;
  try {
    store = openStore();
  } catch (e) {
    storeError = e;
  }

  if (method === 'GET') {
    if (!store) {
      const seeded = normalizeList(seed) || { version: 1, items: [], updated: null };
      return json(200, { ok: true, ...seeded, persistence: 'seed-only', warning: String(storeError?.message || storeError) }, origin);
    }
    const { data, from } = await loadDirectory(store);
    return json(200, { ok: true, ...data, persistence: from }, origin);
  }

  // Mutations require auth + blobs
  if (!isAuthenticated(event)) {
    return json(401, { ok: false, error: 'Unauthorized' }, origin);
  }
  if (!store) {
    return json(503, { error: 'Blobs unavailable', detail: String(storeError?.message || storeError) }, origin);
  }

  const { data } = await loadDirectory(store);

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' }, origin);
  }

  const items = [...(data.items || [])];
  const now = new Date().toISOString().slice(0, 10);

  if (method === 'POST') {
    // replace-all or create one
    if (Array.isArray(body.items)) {
      const next = {
        version: 1,
        updated: now,
        items: body.items.map((row, i) => {
          const s = sanitizeRow(row, { requireName: true });
          if (s.error) return null;
          return { id: row.id || `st-${String(i + 1).padStart(3, '0')}`, ...s };
        }).filter(Boolean),
      };
      await store.setJSON(KEY, next);
      return json(200, { ok: true, ...next }, origin);
    }
    const s = sanitizeRow(body);
    if (s.error) return json(400, { error: s.error }, origin);
    const row = { id: newId(items), ...s };
    items.push(row);
    const next = { version: 1, updated: now, items };
    await store.setJSON(KEY, next);
    return json(201, { ok: true, item: row, ...next }, origin);
  }

  if (method === 'PUT' || method === 'PATCH') {
    const id = body.id || event.queryStringParameters?.id;
    if (!id) return json(400, { error: 'id required' }, origin);
    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) return json(404, { error: 'not found' }, origin);
    const s = sanitizeRow({ ...items[idx], ...body }, { requireName: true });
    if (s.error) return json(400, { error: s.error }, origin);
    items[idx] = { id, ...s };
    const next = { version: 1, updated: now, items };
    await store.setJSON(KEY, next);
    return json(200, { ok: true, item: items[idx], ...next }, origin);
  }

  if (method === 'DELETE') {
    const id = body.id || event.queryStringParameters?.id;
    if (!id) return json(400, { error: 'id required' }, origin);
    const nextItems = items.filter((x) => x.id !== id);
    if (nextItems.length === items.length) return json(404, { error: 'not found' }, origin);
    const next = { version: 1, updated: now, items: nextItems };
    await store.setJSON(KEY, next);
    return json(200, { ok: true, ...next }, origin);
  }

  return json(405, { error: 'Method not allowed' }, origin);
}

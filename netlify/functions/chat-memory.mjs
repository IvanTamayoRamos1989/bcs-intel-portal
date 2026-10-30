/**
 * GET /api/chat-memory — recent chat turns + themes; ?export=gaps for JSON/CSV.
 * Auth: portal cookie required.
 */
import { isAuthenticated, corsHeaders } from '../lib/auth_shared.mjs';
import {
  connectBlobs,
  openChatStore,
  loadTurns,
  aggregateThemes,
  topQuestions,
  gapsToCsv,
} from '../lib/chat_memory.mjs';

function json(status, body, origin, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin || undefined),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const method = event.httpMethod || 'GET';

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders(origin || undefined),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: '',
    };
  }

  if (method !== 'GET') {
    return json(405, { ok: false, error: 'Method not allowed' }, origin);
  }

  if (!isAuthenticated(event)) {
    return json(401, { ok: false, error: 'Unauthorized' }, origin);
  }

  let store;
  try {
    connectBlobs(event);
    store = openChatStore();
  } catch (e) {
    return json(503, { ok: false, error: 'Blobs unavailable', detail: String(e?.message || e) }, origin);
  }

  let data;
  try {
    data = await loadTurns(store);
  } catch (e) {
    return json(500, { ok: false, error: 'Read failed', detail: String(e?.message || e) }, origin);
  }

  const qs = event.queryStringParameters || {};
  const exportMode = String(qs.export || '').toLowerCase();
  const gapsOnly = qs.gaps_only === '1' || qs.gaps_only === 'true' || exportMode === 'gaps';
  let limit = parseInt(qs.limit || '50', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;
  const format = String(qs.format || 'json').toLowerCase();

  let turns = Array.isArray(data.turns) ? data.turns : [];
  if (gapsOnly) turns = turns.filter((t) => t && t.gap);

  if (exportMode === 'gaps') {
    const gaps = turns.slice(0, Math.min(limit, 500)).map((t) => ({
      ts: t.ts,
      question: t.q,
      theme: t.theme_guess || null,
      notes: t.a_preview || '',
      sources: t.sources || [],
      lang: t.lang,
      session: t.session,
    }));
    if (format === 'csv') {
      const csv = gapsToCsv(
        gaps.map((g) => ({
          ts: g.ts,
          q: g.question,
          theme_guess: g.theme,
          a_preview: g.notes,
          sources: g.sources,
        }))
      );
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="bcs-chat-gaps.csv"',
          ...corsHeaders(origin || undefined),
        },
        body: csv,
      };
    }
    return json(
      200,
      {
        ok: true,
        export: 'gaps',
        count: gaps.length,
        total_stored: (data.turns || []).length,
        gaps,
      },
      origin
    );
  }

  const recent = turns.slice(0, limit);
  const allForAgg = Array.isArray(data.turns) ? data.turns : [];
  return json(
    200,
    {
      ok: true,
      updated: data.updated || null,
      total: allForAgg.length,
      gaps_total: allForAgg.filter((t) => t && t.gap).length,
      list_count: data.list_count ?? null,
      index_count: data.index_count ?? null,
      limit,
      gaps_only: gapsOnly,
      turns: recent,
      themes: aggregateThemes(allForAgg),
      top_questions: topQuestions(allForAgg, 20),
    },
    origin
  );
}

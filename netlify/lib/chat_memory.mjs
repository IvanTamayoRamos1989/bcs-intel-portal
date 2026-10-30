/**
 * Conversation memory + knowledge-gap store (Netlify Blobs).
 * Privacy: no passwords, no API keys; q/a truncated; session hashed.
 * Storage: one blob per turn under chat-turns/{id} (no clobber races).
 */
import crypto from 'node:crypto';
import { getStore, connectLambda } from '@netlify/blobs';

export const STORE_NAME = 'bcs-portal';
export const TURNS_PREFIX = 'chat-turns/';
export const INDEX_KEY = 'chat-turns-index';
export const LEGACY_TURNS_KEY = 'chat-turns';
export const MAX_TURNS = 500;
export const Q_MAX = 500;
export const A_PREVIEW_MAX = 300;
export const BODY_MAX_BYTES = 48_000;
export const WRITE_RATE_WINDOW_MS = 60_000;
export const WRITE_RATE_MAX = 40;

const writeHits = new Map();

export function connectBlobs(event) {
  try {
    if (typeof connectLambda === 'function') connectLambda(event);
  } catch (e) {
    console.warn('connectLambda', e?.message || e);
  }
}

export function openChatStore() {
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
  // Default consistency (strong needs uncachedEdgeURL not present in this Functions env).
  // Per-turn keys avoid read-modify-write races.
  try {
    return getStore(STORE_NAME);
  } catch (e1) {
    if (!token) throw e1;
    return getStore({ name: STORE_NAME, siteID, token });
  }
}

export function memoryLoggingEnabled() {
  const v = String(process.env.CHAT_LOG_BLOBS || '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

export function writeRateOk(ip) {
  const now = Date.now();
  let arr = writeHits.get(ip) || [];
  arr = arr.filter((t) => now - t < WRITE_RATE_WINDOW_MS);
  if (arr.length >= WRITE_RATE_MAX) {
    writeHits.set(ip, arr);
    return false;
  }
  arr.push(now);
  writeHits.set(ip, arr);
  return true;
}

export function hashSession(raw) {
  const s = String(raw || '').trim().slice(0, 128);
  if (!s) return null;
  return crypto.createHash('sha256').update(`bcs-chat-sid:${s}`).digest('hex').slice(0, 16);
}

export function truncate(str, max) {
  const t = String(str || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

/** Heuristic: answer refuses / names a data-gap / soft-hedges / weak sources */
export function detectGap(answer, sources) {
  const a = String(answer || '');
  const low = a
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  // Explicit product data-gap section (even when an estimate was given)
  if (
    /\bdata[\s-]?gap\s*:/i.test(a) ||
    /\bdato(?:s)? que falta(?:n)?\s*:/i.test(a) ||
    /\bmissing (metric|data|figure|baseline)\s*:/i.test(a)
  ) {
    return true;
  }
  const refuseRe = [
    /no (consta|esta) en (el )?contexto/i,
    /not (found|in (the )?context)/i,
    /no (tengo|encuentro|dispongo|hallo).{0,80}(cifra|dato|informacion|evidencia)/i,
    /no hay informacion( disponible)?/i,
    /informacion no disponible/i,
    /sin (evidencia|datos) suficientes?/i,
    /sin informacion (suficiente|en (el )?(corpus|contexto|portal))/i,
    /evidencia (insuficiente|faltante)/i,
    /no (hay|aparece|encuentro).{0,50}(en el (corpus|contexto|portal)|entre (los )?document)/i,
    /insufficient evidence/i,
    /i (do not|don't) (have|find)/i,
    /cannot (find|answer)/i,
    /no puedo (proporcionar|responder|encontrar|citar|dar)/i,
    /fuera de (mi|el) (alcance|conocimiento)/i,
    /no (existe|figura).{0,40}(en|entre).{0,30}(portal|corpus|document|fuente|contexto)/i,
    /mi enfoque se (centra|limita)/i,
    // Soft hedges that still mean a material gap (even if some proxy text follows)
    /necesito datos actualizados/i,
    /need (updated|current|more) (data|figures|numbers)/i,
    /faltan (datos|cifras|proyecciones|series)/i,
    /no (hay|cuenta con|dispone de).{0,60}(consumo|demanda|proyeccion).{0,40}(estatal|oficial|actual)/i,
    /lack(s)? (current |updated )?(consumption|demand|projection)/i,
  ];
  if (refuseRe.some((re) => re.test(low) || re.test(a))) return true;
  // Estimate + named missing input
  if (
    /estimaci[oó]n basada|estimate based on portal/i.test(low) &&
    /falt|missing|no (hay|consta|incluye|aparece)|ausente/i.test(low)
  ) {
    return true;
  }
  const src = Array.isArray(sources) ? sources : [];
  if (src.length === 0 && /no\b.{0,30}(cifra|dato|informacion|evidenc|disponible)/i.test(low)) return true;
  return false;
}

export function guessTheme(message, intents) {
  const m = String(message || '').toLowerCase();
  if (intents?.isEconomyIntent || /\b(pib|pibe|ied|economia|empleo)\b/i.test(m)) return 'economia';
  if (intents?.isWaterIntent || /\b(agua|dma|acuifero|conagua)\b/i.test(m)) return 'agua';
  if (intents?.isEnergyIntent || /\b(energia|cfe|poer|mw)\b/i.test(m)) return 'energia';
  if (intents?.isTourismAnpIntent || /\b(turismo|hotel|anp|visitante)\b/i.test(m)) return 'turismo';
  if (intents?.isDemoIntent || /\b(poblacion|habitante|censo|demograf)/i.test(m)) return 'demografia';
  if (intents?.isFacetIntent) {
    if (/vocaci/i.test(m)) return 'vocaciones';
    if (/capacidad/i.test(m)) return 'capacidades';
    if (/restric|candado|constraint/i.test(m)) return 'restricciones';
    if (/actor|stakeholder/i.test(m)) return 'actores';
    if (/instrumento|pdu|ped/i.test(m)) return 'instrumentos';
  }
  if (/\b(crecimiento|oferta|demanda|foresight|prospectiv)\b/i.test(m)) return 'crecimiento';
  if (/\b(vuelo|aeropuerto|conectividad)\b/i.test(m)) return 'conectividad';
  if (/\b(riesgo|huracan|sismo)\b/i.test(m)) return 'riesgos';
  return null;
}

export function sourcePaths(sources) {
  return (Array.isArray(sources) ? sources : [])
    .slice(0, 8)
    .map((s) => {
      if (!s) return null;
      if (typeof s === 'string') return truncate(s, 160);
      // human card title first (2026-10-08): the team memory page never shows raw file names
      return truncate(s.title || s.path || s.id || '', 160);
    })
    .filter(Boolean);
}

export function buildTurn({
  q,
  answer,
  sources,
  lang,
  sessionRaw,
  intents,
  gapExplicit,
  voice,
  place,
}) {
  const gap =
    gapExplicit === true || gapExplicit === false
      ? !!gapExplicit
      : detectGap(answer, sources);
  return {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    ts: new Date().toISOString(),
    q: truncate(q, Q_MAX),
    a_preview: truncate(answer, A_PREVIEW_MAX),
    sources: sourcePaths(sources),
    gap,
    theme_guess: guessTheme(q, intents),
    session: hashSession(sessionRaw),
    lang: lang === 'en' ? 'en' : 'es',
    voice: !!voice,
    place: place && typeof place === 'string' ? place.slice(0, 40) : null,
  };
}

async function listTurnKeys(store) {
  const keys = new Set();
  const absorb = (page) => {
    const blobs = page?.blobs || page?.keys || [];
    for (const b of blobs) {
      const key = typeof b === 'string' ? b : b?.key;
      if (!key) continue;
      // Accept chat-turns/<id> only (skip legacy aggregate key "chat-turns")
      if (key.startsWith(TURNS_PREFIX) && key.length > TURNS_PREFIX.length) keys.add(key);
    }
  };
  try {
    // Non-paginated first (most reliable in Functions)
    absorb(await store.list({ prefix: TURNS_PREFIX }));
  } catch (e) {
    console.warn('list turns plain', e?.message || e);
  }
  if (keys.size === 0) {
    try {
      let cursor;
      do {
        const page = await store.list({ prefix: TURNS_PREFIX, paginate: true, cursor });
        absorb(page);
        cursor = page?.next_cursor || page?.nextCursor || undefined;
      } while (cursor);
    } catch (e) {
      console.warn('list turns paginated', e?.message || e);
    }
  }
  // Broader prefix without trailing slash as fallback
  if (keys.size === 0) {
    try {
      const page = await store.list({ prefix: 'chat-turns' });
      absorb(page);
    } catch (e) {
      console.warn('list turns broad', e?.message || e);
    }
  }
  return [...keys];
}

export async function loadTurns(store) {
  const byId = new Map();
  let updated = null;
  let list_count = 0;
  let index_count = 0;

  // 1) Index of turn ids (primary — works without list())
  try {
    const idx = await store.get(INDEX_KEY, { type: 'json' });
    const ids = idx && Array.isArray(idx.ids) ? idx.ids : [];
    index_count = ids.length;
    const take = ids.slice(0, MAX_TURNS);
    const batch = await Promise.all(
      take.map(async (id) => {
        try {
          return await store.get(`${TURNS_PREFIX}${id}`, { type: 'json' });
        } catch {
          return null;
        }
      })
    );
    for (const row of batch) {
      if (row && row.q) byId.set(row.id || row.ts || row.q, row);
    }
    if (idx?.updated) updated = idx.updated;
  } catch (e) {
    console.warn('index load', e?.message || e);
  }

  // 2) list() fallback / supplement
  try {
    const keys = await listTurnKeys(store);
    list_count = keys.length;
    const missing = keys.filter((k) => {
      const id = k.slice(TURNS_PREFIX.length);
      return id && ![...byId.keys()].includes(id);
    });
    const batch = await Promise.all(
      missing.slice(0, MAX_TURNS).map(async (key) => {
        try {
          return await store.get(key, { type: 'json' });
        } catch {
          return null;
        }
      })
    );
    for (const row of batch) {
      if (row && row.q) byId.set(row.id || row.ts || row.q, row);
    }
  } catch (e) {
    console.warn('list turns', e?.message || e);
  }

  // 3) Legacy aggregate merge
  try {
    const raw = await store.get(LEGACY_TURNS_KEY, { type: 'json' });
    const legacy = raw && Array.isArray(raw.turns) ? raw.turns : Array.isArray(raw) ? raw : [];
    for (const row of legacy) {
      if (!row || !row.q) continue;
      const id = row.id || row.ts || row.q;
      if (!byId.has(id)) byId.set(id, row);
    }
  } catch {
    /* empty */
  }

  const turns = [...byId.values()].sort((a, b) =>
    String(b.ts || '').localeCompare(String(a.ts || ''))
  );
  if (turns[0]?.ts) updated = turns[0].ts;

  // Rebuild index if empty but we found turns (migration)
  if (index_count === 0 && turns.length) {
    try {
      const ids = turns.map((row) => row.id).filter(Boolean).slice(0, MAX_TURNS);
      if (ids.length) {
        await store.setJSON(INDEX_KEY, { version: 1, updated: updated || new Date().toISOString(), ids });
        index_count = ids.length;
      }
    } catch (e) {
      console.warn('index rebuild', e?.message || e);
    }
  }

  return { version: 1, updated, turns, list_count, index_count };
}


export async function appendTurn(store, turn) {
  const key = `${TURNS_PREFIX}${turn.id}`;
  await store.setJSON(key, turn);
  // Best-effort index (list() is unreliable in some Functions contexts)
  try {
    let idx = { ids: [] };
    try {
      const raw = await store.get(INDEX_KEY, { type: 'json' });
      if (raw && Array.isArray(raw.ids)) idx = raw;
    } catch {
      /* empty */
    }
    const ids = [turn.id, ...(idx.ids || []).filter((x) => x !== turn.id)].slice(0, MAX_TURNS);
    await store.setJSON(INDEX_KEY, { version: 1, updated: turn.ts, ids });
  } catch (e) {
    console.warn('chat-turns index', e?.message || e);
  }
  return { version: 1, updated: turn.ts, turns: [turn] };
}

export async function logChatTurn(event, turnInput, ip) {
  if (!memoryLoggingEnabled()) return { ok: false, reason: 'disabled' };
  if (!writeRateOk(ip || 'anon')) return { ok: false, reason: 'rate' };
  try {
    connectBlobs(event);
    const store = openChatStore();
    const turn = buildTurn(turnInput);
    await appendTurn(store, turn);
    return { ok: true, id: turn.id, gap: turn.gap };
  } catch (e) {
    console.warn('chat-memory log failed', e?.message || e);
    return { ok: false, reason: String(e?.message || e) };
  }
}

export function aggregateThemes(turns) {
  const counts = new Map();
  const samples = new Map();
  for (const t of turns) {
    const theme = t.theme_guess || 'otro';
    counts.set(theme, (counts.get(theme) || 0) + 1);
    if (!samples.has(theme)) samples.set(theme, []);
    const arr = samples.get(theme);
    if (arr.length < 3 && t.q) arr.push(t.q);
  }
  return [...counts.entries()]
    .map(([theme, count]) => ({ theme, count, sample_qs: samples.get(theme) || [] }))
    .sort((a, b) => b.count - a.count);
}

export function topQuestions(turns, n = 15) {
  const counts = new Map();
  for (const t of turns) {
    const key = String(t.q || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[¿?¡!.,;:]+/g, '')
      .trim()
      .slice(0, 120);
    if (!key || key.length < 4) continue;
    const prev = counts.get(key) || { q: t.q, count: 0, gap: false };
    prev.count += 1;
    if (t.gap) prev.gap = true;
    if (String(t.q || '').length < String(prev.q || '').length) prev.q = t.q;
    counts.set(key, prev);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, n);
}

export function gapsToCsv(gaps) {
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = [['ts', 'question', 'theme', 'notes', 'sources']];
  for (const g of gaps) {
    rows.push([
      g.ts || '',
      g.q || '',
      g.theme_guess || '',
      g.a_preview || '',
      (g.sources || []).join('; '),
    ]);
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

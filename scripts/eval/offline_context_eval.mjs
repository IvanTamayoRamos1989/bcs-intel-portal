// Offline pre-deploy gate: runs a chat handler with the LLM mocked and checks whether the
// retrieved CONTEXT contains the facts each eval question needs ("context recall").
// node scripts/eval/offline_context_eval.mjs <path/to/chat.mjs> [label]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
process.env.BCS_CHAT_API_KEY = 'xai-dummy';
process.env.XAI_API_KEY = 'xai-dummy';
process.env.BCS_PORTAL_SESSION_SECRET = 'local-test';
let captured = null;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('x.ai') || String(url).includes('openai')) { captured = JSON.parse(opts.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'MOCK' } }] }), { status: 200 }); }
  return new Response('{}', { status: 404 });
};
const modPath = path.resolve(process.argv[2]);
const label = process.argv[3] || 'run';
const libDir = path.join(path.dirname(modPath), '..', 'lib', 'auth_shared.mjs');
let cookie;
try { const { signToken } = await import(pathToFileURL(libDir)); cookie = `bcs_portal_auth=${signToken()}`; } catch { cookie = 'bcs_portal_auth=1.' + crypto.createHmac('sha256', 'local-test').update('bcs-portal-ok').digest('hex'); }
const mod = await import(pathToFileURL(modPath));
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const QDOC = JSON.parse(fs.readFileSync(new URL('./questions_es.json', import.meta.url)));
const Q = QDOC.questions;
// Pass mark (Ivan, 2026-10-08): >= 91 on the original 100 (E001–E100) AND >= 5/6 on the news questions
const GATE = QDOC.gate || { original_min: 91, original_n: 100, news_cat: 'noticias', news_min: 5 };
// Source-card titles must never be raw file names (2026-10-08)
const CARD_FILE_RE = /\.(pdf|md|csv|tsv|xlsx?|json|geojson|zip|kml|kmz|docx?|pptx?|txt|py|mjs|ya?ml|shp|dbf|prj|esp|html?|jpe?g|png|webp)\b|_|^\d{4}(-\d{2}){0,2}[ _-]?_/i;
const cardViolations = [];
let cardsSeen = 0;
const out = { label, n: 0, fact_ok: 0, fact_n: 0, refuse_empty: 0, refuse_n: 0, open_ctx: 0, open_n: 0, by_cat: {}, items: [] };
let i = 0;
for (const q of Q) {
  captured = null;
  const r = await mod.handler({ httpMethod: 'POST', headers: { cookie, 'x-forwarded-for': '10.1.' + Math.floor(i / 200) + '.' + (i++ % 200) }, body: JSON.stringify({ message: q.q, lang: 'es', history: [], place: q.place || undefined }) });
  let b = {}; try { b = JSON.parse(r.body); } catch {}
  for (const card of [...(b.sources || []), ...(b.primary_file ? [b.primary_file] : [])]) {
    cardsSeen++;
    if (card.type !== 'news' && (!card.title || CARD_FILE_RE.test(card.title))) cardViolations.push({ id: q.id, title: card.title || '' });
  }
  const sys = captured?.messages?.[0]?.content || '';
  const ctx = (sys.split(/\nCONTEXTO:\n|\nCONTEXT:\n/)[1] || '');
  const empty = !ctx.trim() || /sin evidencia relevante/.test(ctx) || b.grounded === false;
  const C = fold(ctx);
  let ok;
  if (q.kind === 'fact') { ok = q.all.every((x) => new RegExp(fold(x), 'i').test(C)) && (q.any.length ? q.any.some((x) => new RegExp(fold(x), 'i').test(C)) : true); out.fact_n++; if (ok) out.fact_ok++; }
  else if (q.kind === 'refuse') { ok = empty; out.refuse_n++; if (ok) out.refuse_empty++; }
  else { ok = !empty && (q.any.length ? q.any.some((x) => new RegExp(fold(x), 'i').test(C)) : true); out.open_n++; if (ok) out.open_ctx++; }
  out.n++; const c = (out.by_cat[q.cat] ||= [0, 0]); c[1]++; if (ok) c[0]++;
  out.items.push({ id: q.id, kind: q.kind, ok, status: r.statusCode, ctx_chars: ctx.length });
}
out.total_ok = out.fact_ok + out.refuse_empty + out.open_ctx;
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`./results/offline_${label}.json`, import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ label, total_ok: out.total_ok, n: out.n, fact: `${out.fact_ok}/${out.fact_n}`, refuse: `${out.refuse_empty}/${out.refuse_n}`, open: `${out.open_ctx}/${out.open_n}`, by_cat: out.by_cat }));
const origIds = new Set(Q.slice(0, GATE.original_n).map((q) => q.id));
const origOk = out.items.filter((x) => origIds.has(x.id) && x.ok).length;
const newsQ = Q.filter((q) => q.cat === GATE.news_cat).map((q) => q.id);
const newsOk = out.items.filter((x) => newsQ.includes(x.id) && x.ok).length;
console.log(`CARD TITLES: ${cardsSeen} cards, ${cardViolations.length} filename-like` + (cardViolations.length ? ' — ' + cardViolations.slice(0, 5).map((v) => `${v.id}: ${v.title}`).join(' | ') : ''));
const pass = origOk >= GATE.original_min && newsOk >= GATE.news_min && cardViolations.length === 0;
console.log(`GATE ${pass ? 'PASS' : 'FAIL'}: original ${origOk}/${GATE.original_n} (min ${GATE.original_min}), news ${newsOk}/${newsQ.length} (min ${GATE.news_min}), filename-like card titles ${cardViolations.length} (max 0)`);
if (!pass) process.exitCode = 1;

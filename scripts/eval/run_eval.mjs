#!/usr/bin/env node
/**
 * BCS portal chat evaluation.
 *   node scripts/eval/run_eval.mjs --base https://bajacaliforniasur2050.com --label before
 *   node scripts/eval/run_eval.mjs --rescore scripts/eval/results/<file>.json   (re-score saved raw answers)
 * Password: env BCS_PORTAL_PASSWORD (default: the shared portal password).
 * Output: scripts/eval/results/<label>_<timestamp>.json + .md
 *
 * Scoring
 *  - fact:   all `all` regexes and >=1 `any` regex (if given) must match the answer.
 *  - refuse: answer must contain an honest "not in the portal" marker AND have 0 invented numbers.
 *  - open:   >=1 `any` regex, and 0 invented numbers.
 *  - invented number = a number in the answer that appears nowhere in the portal's indexed knowledge
 *    (chat corpus, portal facts, guides, aquifer/municipal/stakeholder data) nor in the question.
 *    Years 1900–2100 and integers <= 12 are ignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB = path.resolve(__dirname, '../..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, [])
);
const BASE = (args.base || 'https://bajacaliforniasur2050.com').replace(/\/$/, '');
const LABEL = args.label || 'run';
const CONC = Number(args.concurrency || 2);
const GAP_MS = Number(args.gap || 2600);
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/* ---------- grounded number set ---------- */
function numbersIn(text) {
  const out = [];
  const t = String(text || '').replace(/\u2212/g, '-');
  const re = /(?<![\w.])-?\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?(?![\d])|(?<![\w.])-?\d+(?:[.,]\d+)?(?![\d])/g;
  let m;
  while ((m = re.exec(t))) out.push(m[0]);
  return out;
}
function canon(raw) {
  let s = String(raw).replace(/^-/, '').trim();
  // thousands with space/comma groups of 3
  if (/^\d{1,3}([ ,]\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/[ ,]/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.'); // decimal comma
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
function forms(v) {
  const f = new Set();
  f.add(String(v));
  f.add(v.toFixed(0));
  f.add(v.toFixed(1));
  f.add(v.toFixed(2));
  if (v >= 1000) {
    f.add((v / 1000).toFixed(0)); f.add((v / 1000).toFixed(1));
    f.add((v / 1e6).toFixed(1)); f.add((v / 1e6).toFixed(2)); f.add((v / 1e6).toFixed(0));
    f.add((v / 1e9).toFixed(1)); f.add((v / 1e9).toFixed(2));
  }
  return f;
}
function buildGrounded() {
  const files = [
    'netlify/functions/chat_corpus.json', 'src/data/portal_facts.json', 'src/data/aquifers_bcs.json',
    'src/data/municipios.json', 'netlify/functions/stakeholders_seed.json', 'src/data/los_cabos_organigrama.json',
    'netlify/functions/growth_demand_supply.json', 'netlify/functions/foresights.json',
    'netlify/functions/strategic_questions.json', 'netlify/functions/ontology_graph.json',
    'src/data/federal_projects.json', 'src/data/data_inventory.json',
  ];
  const g = new Set();
  const add = (txt) => { for (const n of numbersIn(txt)) { const v = canon(n); if (v != null) for (const x of forms(v)) g.add(x); } };
  for (const f of files) { const p = path.join(HUB, f); if (fs.existsSync(p)) add(fs.readFileSync(p, 'utf8')); }
  const gdir = path.join(HUB, 'src/content/guides');
  for (const f of fs.readdirSync(gdir)) add(fs.readFileSync(path.join(gdir, f), 'utf8'));
  return g;
}
function inventedNumbers(answer, question, grounded) {
  const qNums = new Set(numbersIn(question).map((n) => String(canon(n))));
  const bad = [];
  for (const raw of numbersIn(answer)) {
    const v = canon(raw);
    if (v == null) continue;
    if (Number.isInteger(v) && v >= 1900 && v <= 2100) continue;
    if (Number.isInteger(v) && v <= 12) continue;
    if (qNums.has(String(v))) continue;
    const fs_ = forms(v);
    let ok = false;
    for (const x of fs_) if (grounded.has(x)) { ok = true; break; }
    if (!ok) bad.push(raw);
  }
  return bad;
}
const REFUSAL = /(no (consta|tengo|encuentro|encontr[eé]|hay (datos|evidencia|informaci[oó]n|cifra|registro)|aparece|est[aá] (en|disponible|documentad)|cuento con|dispongo|se (encuentra|incluye|reporta|registra)|existe (un|una|dato|informaci)|contiene|figura|incluye)|sin (evidencia|dato|informaci[oó]n|cifra|fuente)|fuera del (alcance|acervo)|brecha de datos|dato no (consolidado|disponible)|no est[aá] consolidad|no se (dispone|cuenta)|el (portal|acervo) no (tiene|incluye|contiene|registra|cuenta|reporta|documenta|dispone))/i;

// Source-card titles must never be raw file names (2026-10-08)
const CARD_FILE_RE = /\.(pdf|md|csv|tsv|xlsx?|json|geojson|zip|kml|kmz|docx?|pptx?|txt|py|mjs|ya?ml|shp|dbf|prj|esp|html?|jpe?g|png|webp)\b|_|^\d{4}(-\d{2}){0,2}[ _-]?_/i;
function badCardTitles(res) {
  return [...(res.sources || []), ...(res.primary_file ? [res.primary_file] : [])]
    .filter((c) => c.type !== 'news' && (!c.title || CARD_FILE_RE.test(c.title))).map((c) => c.title || '');
}
function scoreOne(q, res, grounded) {
  const ans = String(res.answer || '');
  const A = fold(ans);
  const inv = inventedNumbers(ans, q.q, grounded);
  const mAll = q.all.every((r) => new RegExp(fold(r), 'i').test(A));
  const mAny = q.any.length ? q.any.some((r) => new RegExp(fold(r), 'i').test(A)) : true;
  let pass = false;
  if (res.error || !ans) pass = false;
  else if (q.kind === 'fact') pass = mAll && mAny;
  else if (q.kind === 'refuse') pass = REFUSAL.test(ans) && inv.length === 0;
  else if (q.kind === 'open') pass = mAny && inv.length === 0;
  const srcTitles = (res.sources || []).map((s) => `${s.title || ''} ${s.path || ''}`).join(' | ');
  const srcHit = q.expect_sources?.length ? q.expect_sources.some((s) => fold(srcTitles).includes(fold(s))) : null;
  return { pass, invented: inv, n_sources: (res.sources || []).length, src_hit: srcHit, bad_cards: badCardTitles(res) };
}

/* ---------- live calls ---------- */
async function login() {
  const pw = process.env.BCS_PORTAL_PASSWORD || 'BCS2050';
  const r = await fetch(`${BASE}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  const sc = r.headers.get('set-cookie') || '';
  const m = sc.match(/bcs_portal_auth=([^;]+)/);
  if (!r.ok || !m) throw new Error(`login failed ${r.status}`);
  return `bcs_portal_auth=${m[1]}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ask(cookie, q, session) {
  const body = { message: q.q, lang: 'es', history: [], place: q.place || null, session };
  for (let attempt = 0; attempt < 4; attempt++) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
      if (r.status === 429) { await sleep(20000); continue; }
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ms: Date.now() - t0, answer: j.answer || '', sources: (j.sources || []).map((s) => ({ title: s.title, path: s.path, type: s.type || null })), primary_file: j.primary_file ? { title: j.primary_file.title, path: j.primary_file.path } : null, stakeholder: j.stakeholder ? (j.stakeholder.name || j.stakeholder.title || true) : null, error: r.ok ? null : (j.error || `HTTP ${r.status}`) };
    } catch (e) { await sleep(3000); if (attempt === 3) return { status: 0, error: String(e), answer: '' }; }
  }
  return { status: 429, error: 'rate limited', answer: '' };
}

function report(run) {
  const qs = run.items;
  const by = {};
  for (const it of qs) {
    const c = (by[it.cat] ||= { n: 0, pass: 0, inv: 0 });
    c.n++; if (it.score.pass) c.pass++; c.inv += it.score.invented.length;
  }
  const total = qs.length, pass = qs.filter((x) => x.score.pass).length;
  const invTotal = qs.reduce((a, x) => a + x.score.invented.length, 0);
  const invQs = qs.filter((x) => x.score.invented.length).length;
  const refuseQs = qs.filter((x) => x.kind === 'refuse');
  const noSrcOnRefuse = refuseQs.filter((x) => x.score.n_sources === 0).length;
  // Pass mark (Ivan, 2026-10-08): >= 91 on the original 100 (E001–E100) AND >= 5/6 news, and 0 invented numbers
  const orig = qs.filter((x) => /^E(0\d\d|100)$/.test(x.id));
  const newsQs = qs.filter((x) => x.cat === 'noticias');
  const gate = { original_pass: orig.filter((x) => x.score.pass).length, original_n: orig.length, news_pass: newsQs.filter((x) => x.score.pass).length, news_n: newsQs.length };
  gate.bad_card_titles = qs.reduce((a, x) => a + ((x.score.bad_cards || []).length), 0);
  gate.cards_total = qs.reduce((a, x) => a + (x.res?.sources || []).length + (x.res?.primary_file ? 1 : 0), 0);
  gate.pass = gate.original_pass >= 91 && (gate.news_n === 0 || gate.news_pass >= 5) && qs.every((x) => !x.score.invented.length) && gate.bad_card_titles === 0;
  run.summary = { gate, total, pass, accuracy: +(100 * pass / total).toFixed(1), invented_numbers: invTotal, answers_with_invented: invQs, refuse_total: refuseQs.length, refuse_pass: refuseQs.filter((x) => x.score.pass).length, refuse_no_sources: noSrcOnRefuse, errors: qs.filter((x) => x.res.error).length, by_category: by };
  let md = `# Chat eval — ${run.label}\n\n- Base: ${run.base}\n- Date: ${run.date}\n- Accuracy: **${pass}/${total} (${run.summary.accuracy}%)**\n- Invented numbers: **${invTotal}** in ${invQs} answers\n- Honest refusals (out-of-acervo questions): ${run.summary.refuse_pass}/${refuseQs.length}; with zero sources shown: ${noSrcOnRefuse}/${refuseQs.length}\n- Errors: ${run.summary.errors}\n- Gate (≥91/100 original AND ≥5/6 news, 0 invented): **${gate.pass ? 'PASS' : 'FAIL'}** (original ${gate.original_pass}/${gate.original_n}, news ${gate.news_pass}/${gate.news_n})\n- Source-card titles: ${gate.cards_total} cards, **${gate.bad_card_titles}** filename-like (must be 0)\n\n| Category | Pass | Invented # |\n|---|---:|---:|\n`;
  for (const [k, v] of Object.entries(by)) md += `| ${k} | ${v.pass}/${v.n} | ${v.inv} |\n`;
  md += `\n## Failures\n\n`;
  for (const it of qs.filter((x) => !x.score.pass || x.score.invented.length)) {
    md += `- **${it.id}** [${it.cat}/${it.kind}] ${it.q}\n  - ${it.score.pass ? 'PASS' : 'FAIL'}; invented: ${it.score.invented.join(', ') || '—'}; sources: ${it.score.n_sources}\n  - A: ${String(it.res.answer || it.res.error).replace(/\s+/g, ' ').slice(0, 300)}\n`;
  }
  return md;
}

async function main() {
  const grounded = buildGrounded();
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  if (args.rescore) {
    const run = JSON.parse(fs.readFileSync(args.rescore, 'utf8'));
    const Qs = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions_es.json'), 'utf8')).questions;
    const byId = Object.fromEntries(Qs.map((q) => [q.id, q]));
    for (const it of run.items) { const q = byId[it.id] || it; Object.assign(it, { all: q.all, any: q.any, kind: q.kind }); it.score = scoreOne(q, it.res, grounded); }
    const md = report(run);
    fs.writeFileSync(args.rescore, JSON.stringify(run, null, 1));
    fs.writeFileSync(args.rescore.replace(/\.json$/, '.md'), md);
    console.log(JSON.stringify({ label: run.label, ...run.summary, by_category: undefined }));
    return;
  }
  const Qs = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions_es.json'), 'utf8')).questions.filter((q) => !ONLY || ONLY.has(q.id));
  const cookie = await login();
  const session = `eval-${LABEL}-${Date.now()}`;
  const items = new Array(Qs.length);
  let idx = 0;
  async function worker() {
    while (idx < Qs.length) {
      const i = idx++;
      const q = Qs[i];
      const res = await ask(cookie, q, session);
      items[i] = { id: q.id, cat: q.cat, kind: q.kind, q: q.q, place: q.place, all: q.all, any: q.any, res, score: scoreOne(q, res, grounded) };
      process.stdout.write(`${q.id} ${items[i].score.pass ? 'PASS' : 'fail'} inv=${items[i].score.invented.length} ${res.ms || ''}ms\n`);
      await sleep(GAP_MS);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const run = { label: LABEL, base: BASE, date: new Date().toISOString(), items };
  const md = report(run);
  const f = path.join(outDir, `${LABEL}_${stamp}.json`);
  fs.writeFileSync(f, JSON.stringify(run, null, 1));
  fs.writeFileSync(f.replace(/\.json$/, '.md'), md);
  console.log(JSON.stringify({ file: f, ...run.summary, by_category: undefined }));
  if (!run.summary.gate.pass) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });

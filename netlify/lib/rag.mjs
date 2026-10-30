/**
 * Grounded retrieval for the BCS portal chat (BM25 + light Spanish stemming + fuzzy + relevance gate).
 * Replaces the substring/keyword-bonus retriever diagnosed in CHAT_DIAGNOSIS_2026-09-30.md.
 *
 *  - word-level tokens with accent folding; stems = first 6 chars for long words (presidente ~ presidencia)
 *  - BM25 over title (x3) + cleaned summary (x1) + path (x0.5); keyword "[ … ]" tails are NOT indexed
 *    (except for fact / municipio cards where they are short and specific)
 *  - typo tolerance: unknown query tokens (>=5 chars) map to vocabulary words at edit distance 1
 *  - place is a soft boost only (never appended to the query)
 *  - relevance gate: a chunk must match >=1 content (non-generic, non-place) term; weak tails are cut;
 *    if nothing passes -> "no evidence" (empty sources, no chips)
 *  - filename-only file chunks are never indexed
 */

export function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const STOP = new Set(`a al algo algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra cual cuales
cualquier cuan cuando cuanta cuantas cuanto cuantos de del desde donde dos el ella ellas ello ellos en entre era eran es esa
esas ese eso esos esta estaba estado_x estan estas este esto estos fue fueron ha hace hacia han hasta hay la las le les lo los mas
me mi mis mucho muy nada ni no nos o otra otras otro otros para pero poco por porque que quien quienes se segun ser si sido
sin sobre son su sus tal tambien tan tanto te tiene tienen todo toda todas todos tu tus un una unas uno unos usted y ya yo
cual cuál dime dame quiero saber puedes podrias favor hoy actual actualmente
representa representan significa pasa paso ocurre existe existen cuesta vale sirve tuvo hubo fue dice dicen explica explicame
habla trata busca encuentra muestra equivale equivalen rige rigen encabeza encabezan dirige corresponde
the of and or to in on for with by from at as is are was were be been this that these those what which who whom how many much
does do did has have had it its about tell me please`.split(/\s+/));

// Count toward score but never on their own make a chunk "relevant"
const GENERIC = new Set(`bcs baja california sur mexico estado estatal portal dato datos informacion info documento documentos
fuente fuentes archivo archivos acervo guia tema cifra cifras numero total año ano anos años 2020 2021 2022 2023 2024 2025 2026
municipio municipal municipios ciudad region zona general nivel actual principal principales tipo hecho
noticia noticias nota notas news prensa reciente recientes recientemente ultima ultimas ultimo ultimos latest recent`.split(/\s+/));
// ^ news-intent words (2026-10-08) are not topical: they select the news layer via isNewsIntent(), never make a chunk relevant

const PLACE_WORDS = new Set(`los cabos cabo san lucas jose paz loreto comondu mulege todos santos east cape este pescadero
constitucion rosalia vizcaino guerrero negro ribera barriles pulmo santiago`.split(/\s+/));

// Query-side synonym expansion (added with reduced weight)
const SYN = [
  [/\b(habitantes?|poblacion|gente|personas|abitantes|poblasion|censo)\b/, 'poblacion habitantes pobtot'],
  [/\b(alcalde|alcaldesa|presidente municipal|presidenta municipal|edil)\b/, 'presidencia municipal ayuntamiento mayor'],
  [/\b(presidente|presidenta)\b/, 'presidencia'],
  [/\bgobernador(a)?\b/, 'gobernador governor'],
  [/\b(dirige|director|directora|titular|encabeza|quien)\b/, 'titular'],
  [/\b(desaladora|desalinizadora|desalacion|desalinizacion)\b/, 'desaladora desalinizadora desalacion'],
  [/\b(luz|electricidad|electrica|electrico)\b/, 'energia electricidad sibcs'],
  [/\b(sedena|ejercito|militar|militares|defensa|cuartel|cuarteles)\b/, 'sedena guardia nacional defensa'],
  [/\b(marina|semar|naval)\b/, 'semar marina'],
  [/\bpib\b/, 'pib producto interno'],
  [/\b(ied|inversion extranjera)\b/, 'ied inversion extranjera'],
  [/\b(cruceros?|crucero)\b/, 'crucero arribos pasajeros'],
  [/\b(cuartos|habitaciones)\b/, 'habitaciones cuartos hoteles'],
  [/\b(dma|disponibilidad media)\b/, 'dma disponibilidad'],
  [/\bhectometros?\b/, 'hm3 hm'],
  [/\b(metros? cubicos?|cubicos?)\b/, 'm3 hm3'],
  [/\bhectareas?\b/, 'ha superficie'],
  [/\b(instrumento|plan|programa) (urbano|de desarrollo urbano)\b/, 'pdu pducp pmdu desarrollo urbano'],
  [/\bacuiferos?\b/, 'acuifero dma'],
  [/\b(vivienda|casas)\b/, 'vivienda residencial'],
  [/\b(inmobiliario|bienes raices|real estate)\b/, 'inmobiliario residencial jll'],
  [/\b(creo|creado|creada|creacion|fundo|fundado|fundacion|erigio|erigido)\b/, 'decreto erigido creacion fundacion'],
  [/\b(maxima|maximo|pico|punta)\b/, 'pico maxima'],
];

const MUNI_TOKENS = {
  los_cabos: ['cabos', 'lucas', 'jose del cabo'], la_paz: ['la paz'], loreto: ['loreto'],
  comondu: ['comondu', 'constitucion'], mulege_north: ['mulege', 'rosalia', 'vizcaino', 'guerrero negro'],
  todos_santos: ['todos santos', 'pescadero'], east_cape: ['east cape', 'cabo pulmo', 'la ribera', 'barriles'],
};

/* ---------- news (press) chunks: current-events intent + recency (2026-10-08) ---------- */
// Questions about current events / the news feed. News chunks are press reports, never official data:
// outside this intent they are demoted and capped so official facts keep priority.
export const NEWS_INTENT_RE = /\b(noticias?|nota|notas|prensa|periodic[oa]s?|medios|reciente(s|mente)?|ultim[oa]s?|actualidad|esta semana|este mes|semana pasada|hoy|ayer|ahora|ahorita|ultimamente|que paso|que esta pasando|que pasa|se reporta|reporta(n|ron)?|informa(n|ron)?|anuncia(n|ron|do)?|hurac[a-z]*|tormenta|depresion tropical|ciclon(es)?|trayectoria|pronostico|alerta|protecci[o]n civil|espera(n)?|expectativas?|preve(n)?|proyecta(n)?|blanqueamiento|news|latest|recent(ly)?|this week|today|yesterday|currently|hurricane|storm|forecast|expect(s|ed|ations)?)\b/;
export function isNewsIntent(message) {
  return NEWS_INTENT_RE.test(fold(message));
}
function dayNum(iso) {
  const t = Date.parse(String(iso || '').slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) ? Math.floor(t / 86400000) : null;
}

export function stem(t) {
  if (/^\d/.test(t)) return t;
  if (t.length >= 7) return t.slice(0, 6);
  if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

export function words(text) {
  return fold(text)
    .replace(/<[^>]+>/g, ' ')
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w && (w.length >= 2 || /\d/.test(w)) && !STOP.has(w));
}

export function cleanSummary(s, keepTail = false) {
  let t = String(s || '').replace(/<[^>]+>/g, ' ');
  if (!keepTail) t = t.replace(/\s*\[[^\]]{3,400}\]\s*$/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

function isThinFile(c) {
  if (c.type !== 'file') return false;
  const s = cleanSummary(c.sum_es || c.sum_en || '');
  if (s.length < 80) return true;
  const base = fold(String(c.title || '').replace(/\.[a-z0-9]+$/i, '')).replace(/[^a-z0-9]+/g, ' ').trim();
  const body = fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
  return body.length < base.length + 60; // summary ≈ filename + theme label
}

function editDistance1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return diff + (la - i) + (lb - j) <= 1;
}

export function buildIndex(corpus, extra = []) {
  const docs = [];
  const df = new Map();
  const vocab = new Set();
  let totalLen = 0;
  for (const c of [...corpus, ...extra]) {
    if (!c || isThinFile(c)) continue;
    const keepTail = c.type === 'fact' || c.type === 'municipio';
    const sum = cleanSummary(c.sum_es || '', keepTail) + ' ' + cleanSummary(c.sum_en && c.sum_en !== c.sum_es ? c.sum_en : '', keepTail);
    const tf = new Map();
    const addField = (txt, w) => {
      for (const raw of words(txt)) {
        vocab.add(raw);
        const s = stem(raw);
        tf.set(s, (tf.get(s) || 0) + w);
      }
    };
    addField(c.title || '', 3);
    addField(c.metric ? `${c.metric} ${c.value || ''}` : '', 2);
    addField(sum, 1);
    addField(String(c.path || '').replace(/[_/.\-#]+/g, ' '), 0.5);
    let len = 0;
    for (const v of tf.values()) len += v;
    totalLen += len;
    for (const s of tf.keys()) df.set(s, (df.get(s) || 0) + 1);
    docs.push({ c, tf, len, hay: fold(`${c.title || ''} ${sum} ${c.path || ''}`) });
  }
  const N = docs.length;
  // newest news date in the corpus = "today" for recency (deterministic for evals; follows the feed)
  let newsRef = null;
  for (const d of docs) {
    if (d.c.type !== 'news') continue;
    const dn = dayNum(d.c.date);
    if (dn != null && (newsRef == null || dn > newsRef)) newsRef = dn;
  }
  const idf = new Map();
  for (const [s, n] of df) idf.set(s, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  const byLen = new Map();
  for (const v of vocab) {
    if (v.length < 4 || /\d/.test(v)) continue;
    const k = v.length;
    if (!byLen.has(k)) byLen.set(k, []);
    byLen.get(k).push(v);
  }
  return { docs, idf, N, avgdl: totalLen / Math.max(1, N), vocab, byLen, newsRef };
}

function fuzzyFix(index, w) {
  if (w.length < 5 || index.vocab.has(w) || /\d/.test(w)) return null;
  for (const L of [w.length, w.length - 1, w.length + 1]) {
    for (const v of index.byLen.get(L) || []) if (editDistance1(w, v)) return v;
  }
  return null;
}

export function inferPlace(message) {
  const q = ` ${fold(message)} `;
  const order = ['east_cape', 'todos_santos', 'los_cabos', 'la_paz', 'loreto', 'comondu', 'mulege_north'];
  for (const id of order) if (MUNI_TOKENS[id].some((t) => new RegExp(`\\b${t}\\b`).test(q))) return id;
  return null;
}

/** Analyse the query: content terms (weighted), place terms, synonyms, fuzzy fixes. */
export function analyseQuery(index, message) {
  const q = fold(message);
  const terms = new Map(); // stem -> {w, content}
  const add = (raw, w, forceContent) => {
    if (!raw || STOP.has(raw)) return;
    const fixed = fuzzyFix(index, raw);
    const word = fixed || raw;
    const s = stem(word);
    const content = forceContent ?? !(GENERIC.has(word) || PLACE_WORDS.has(word));
    const prev = terms.get(s);
    if (!prev || prev.w < w) terms.set(s, { w, content, word, place: PLACE_WORDS.has(word) });
  };
  for (const w of words(q)) add(w, 1);
  for (const [re, exp] of SYN) if (re.test(q)) for (const w of exp.split(' ')) if (!terms.has(stem(w))) add(w, 0.6);
  // 4-digit aquifer keys / identifiers stay as content terms
  for (const m of q.matchAll(/\b0[0-9]{3}\b/g)) terms.set(m[0], { w: 1.4, content: true, word: m[0] });
  for (const t of terms.values()) t.hasSyn = SYN.some(([re]) => re.test(t.word || ''));
  return { terms, place: inferPlace(message) };
}

const OTHER_MUNI = [
  ['los_cabos', /\b(los cabos|san jose del cabo|cabo san lucas)\b/], ['la_paz', /\bla paz\b/], ['loreto', /\bloreto\b/],
  ['comondu', /\b(comondu|constitucion)\b/], ['mulege_north', /\b(mulege|santa rosalia)\b/],
];

export function search(index, message, { k = 8, place = null, minRel = 0.3, newsIntent = null } = {}) {
  const { terms, place: inferred } = analyseQuery(index, message);
  const wantNews = newsIntent == null ? isNewsIntent(message) : !!newsIntent;
  const placeId = place || inferred;
  const strictPlace = !!inferPlace(message);
  const whoQuery = /\bqui[eé]n(es)?\b|\bwho\b|\btitular\b|\bencabeza\b|\bdirige\b/i.test(message);
  const placeToks = placeId ? MUNI_TOKENS[placeId] || [] : [];
  const k1 = 1.2, b = 0.75;
  const contentTerms = [...terms.entries()].filter(([, t]) => t.content);
  const maxIdf = Math.log(1 + (index.N + 0.5) / 0.5);
  // terms absent from the corpus get the maximum idf: they are the clearest sign the portal lacks the answer
  const contentIdfSum = contentTerms.reduce((a, [s, t]) => a + (index.idf.has(s) ? index.idf.get(s) : t.hasSyn ? 0 : maxIdf) * t.w, 0);
  const scored = [];
  for (const d of index.docs) {
    let score = 0, contentHit = 0, contentIdf = 0;
    for (const [s, t] of terms) {
      const f = d.tf.get(s);
      if (!f) continue;
      const idf = index.idf.get(s) || 0;
      score += t.w * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avgdl)));
      if (t.content) { contentHit++; contentIdf += idf * t.w; }
    }
    if (score <= 0) continue;
    if (contentTerms.length && !contentHit) continue; // relevance gate
    const coverage = contentIdfSum ? contentIdf / contentIdfSum : 1;
    score *= 0.5 + coverage; // reward covering the whole question
    if (placeToks.length && placeToks.some((t) => d.hay.includes(t))) score *= 1.25;
    else if (placeToks.length && strictPlace) {
      // question names a place: chunks titled for another municipality only are demoted
      const tl = fold(d.c.title || '');
      if (OTHER_MUNI.some(([id, re]) => id !== placeId && re.test(tl))) score *= 0.5;
    }
    if (whoQuery && (d.c.type === 'actor' || String(d.c.id || '').startsWith('gobierno:'))) score *= 1.8;
    if (d.c.type === 'ontology') score *= 0.8;
    if (d.c.type === 'still') score *= 0.7;
    if (d.c.type === 'news') {
      // recency: fresh = 1 for the newest item, ~0.5 after a week, ~0.1 after 3 weeks (relative to the newest feed item)
      const dn = dayNum(d.c.date);
      const age = index.newsRef != null && dn != null ? Math.max(0, index.newsRef - dn) : 60;
      const fresh = Math.exp(-age / 10);
      score *= wantNews ? 1.0 + 0.8 * fresh : 0.75 + 0.1 * fresh;
      if (d.c.archived) score *= 0.85;
    }
    scored.push({ c: d.c, score, coverage, contentHit });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return { hits: [], placeId, terms, top: 0 };
  const top = scored[0].score;
  // minimum evidence quality: best chunk must cover a meaningful share of the question
  const best = scored[0];
  // weak evidence: low coverage, or the most specific term of the question is absent from the top hits
  let weakTop = contentTerms.length >= 2 && best.coverage < 0.34;
  if (!weakTop && contentTerms.length >= 2 && best.coverage < 0.45) {
    // a content word of the question that exists nowhere in the portal (e.g. "gasolina", "homicidios")
    if (contentTerms.some(([st, t]) => t.w >= 1 && !t.hasSyn && !index.idf.has(st))) weakTop = true;
  }
  const hits = [];
  const perFolder = new Map();
  let onto = 0, still = 0, news = 0;
  const newsMax = wantNews ? 5 : 2;
  const seenTitle = new Set();
  for (const h of scored) {
    if (h.score < top * minRel) break;
    const c = h.c;
    const tkey = fold(c.title || '').trim();
    if (seenTitle.has(tkey)) continue;
    if (c.type === 'ontology' && ++onto > 2) continue;
    if (c.type === 'still' && ++still > 2) continue;
    if (c.type === 'news' && ++news > newsMax) continue;
    const folder = String(c.path || '').split('/')[0];
    const n = perFolder.get(folder) || 0;
    if (c.type === 'file' || c.type === 'library') {
      if (n >= 2) continue;
      perFolder.set(folder, n + 1);
    }
    seenTitle.add(tkey);
    hits.push(h);
    if (hits.length >= k) break;
  }
  pinMunicipalPopulation(index, message, place, hits, k, top);
  return { hits, placeId, terms, top, weakTop, newsIntent: wantNews };
}

/* Population of a municipio (2026-10-08): "población de La Paz" must read the MUNICIPAL total (292,241),
   not the cabecera locality (La Paz city, 250,141). When a population question names a municipio (or the
   chat runs with that municipio as explicit place), the municipal-total card goes first and the cabecera
   card second; if the user asks for the city/locality, the cabecera card leads and the municipal card follows. */
const POP_MUNIS = [
  ['La Paz', /\bla paz\b/, 'la_paz'], ['Los Cabos', /\blos cabos\b/, 'los_cabos'], ['Comondú', /\bcomondu\b/, 'comondu'],
  ['Mulegé', /\bmulege\b/, 'mulege_north'], ['Loreto', /\bloreto\b/, 'loreto'],
];
function pinMunicipalPopulation(index, message, place, hits, k, top) {
  const q = fold(message);
  if (!/\b(poblacion|h?abitantes?|gente|viven?|h?abitan|residen|censo|demograf\w*|population|inhabitants|people|census)\b/.test(q)) return;
  if (/triplic|duplic|proyecc|escenario|crecer|crece\b|what if|projection|scenario/.test(q)) return;
  let named = POP_MUNIS.filter(([, re]) => re.test(q));
  // no municipio named but the message names one of its localities (e.g. Santa Rosalía) → locality question
  const localityNamed = !named.length && !!inferPlace(message);
  if (!named.length && place) named = POP_MUNIS.filter(([, , id]) => id === place);
  if (!named.length || named.length > 2) return;
  const cityAsk = localityNamed || /\b(ciudad|localidad|cabecera|city|town|locality|seat)\b/.test(q);
  const byId = (id) => index.docs.find((d) => d.c.id === id)?.c;
  const pins = [];
  for (const [name] of named) {
    const mun = byId(`m:${name}`);
    const loc = index.docs.find((d) => d.c.type === 'municipio' && String(d.c.path || '').startsWith(`municipios/${name}/localidad/`))?.c;
    // a locality other than the cabecera (e.g. Cabo San Lucas) keeps the normal ranking
    if (localityNamed && !(loc && q.includes(fold(String(loc.path).split('/localidad/')[1] || '')))) continue;
    for (const c of cityAsk ? [loc, mun] : [mun, loc]) if (c) pins.push(c);
  }
  if (!pins.length) return;
  const ids = new Set(pins.map((c) => c.id));
  const old = new Map(hits.map((h) => [h.c.id, h]));
  const rest = hits.filter((h) => !ids.has(h.c.id));
  hits.length = 0;
  for (const c of pins) hits.push(old.get(c.id) || { c, score: top, coverage: 1, contentHit: 1 });
  hits.push(...rest.slice(0, Math.max(0, k - pins.length)));
}

/** Relevance of an arbitrary text to the query (content-term overlap count). */
export function overlap(index, message, text) {
  const { terms } = analyseQuery(index, message);
  const hay = new Set(words(text).map(stem));
  let n = 0;
  for (const [s, t] of terms) if (t.content && hay.has(s)) n++;
  return n;
}

/* ---------- numbers (shared with the eval script logic) ---------- */
export function numbersIn(text) {
  const out = [];
  const t = String(text || '').replace(/\u2212/g, '-');
  const re = /(?<![\w.])-?\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?(?![\d])|(?<![\w.])-?\d+(?:[.,]\d+)?(?![\d])/g;
  let m;
  while ((m = re.exec(t))) out.push(m[0]);
  return out;
}
function canon(raw) {
  let s = String(raw).replace(/^-/, '').trim();
  if (/^\d{1,3}([ ,]\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/[ ,]/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
function forms(v) {
  const f = new Set([String(v), v.toFixed(0), v.toFixed(1), v.toFixed(2)]);
  if (v >= 1000) for (const d of [1e3, 1e6, 1e9]) { f.add((v / d).toFixed(0)); f.add((v / d).toFixed(1)); f.add((v / d).toFixed(2)); }
  return f;
}
export function numberSet(text) {
  const g = new Set();
  for (const n of numbersIn(text)) { const v = canon(n); if (v != null) for (const x of forms(v)) g.add(x); }
  return g;
}
/** Numbers in `answer` that are not supported by `allowedText` (years and small integers ignored). */
export function unsupportedNumbers(answer, allowedText) {
  const allowed = numberSet(allowedText);
  const bad = [];
  for (const raw of numbersIn(answer)) {
    const v = canon(raw);
    if (v == null) continue;
    if (Number.isInteger(v) && ((v >= 1900 && v <= 2100) || v <= 12)) continue;
    let ok = false;
    for (const x of forms(v)) if (allowed.has(x)) { ok = true; break; }
    if (!ok) bad.push(raw);
  }
  return bad;
}

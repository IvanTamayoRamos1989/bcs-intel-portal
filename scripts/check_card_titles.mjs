#!/usr/bin/env node
// Build guard (2026-10-08): every chat-corpus chunk must carry a human `display_title` for source cards —
// never a raw file name (extension, underscores, or a `YYYY-MM-DD_` prefix). News headlines are exempt.
import { readFileSync } from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname;
const FILE_RE = /\.(pdf|md|csv|tsv|xlsx?|json|geojson|zip|kml|kmz|docx?|pptx?|txt|py|mjs|ya?ml|shp|dbf|prj|esp|html?|jpe?g|png|webp)\b|_|^\d{4}(-\d{2}){0,2}[ _-]?_/i;
let bad = [], missing = 0, generic = 0;
for (const f of ['netlify/functions/chat_corpus.json', 'public/chat_corpus.json']) {
  const chunks = JSON.parse(readFileSync(ROOT + f, 'utf8'));
  for (const c of chunks) {
    const t = c.display_title;
    if (!t) { missing++; bad.push(`${f}: ${c.id} (no display_title)`); continue; }
    if (c.type !== 'news' && FILE_RE.test(t)) bad.push(`${f}: ${c.id} «${t}»`);
    if (f.startsWith('netlify') && t.startsWith('Documento del acervo BCS 2050')) generic++;
  }
}
if (bad.length) {
  console.error(`card-titles: FAIL — ${bad.length} chunk(s) without a clean display title`);
  for (const b of bad.slice(0, 20)) console.error('  ' + b);
  process.exit(1);
}
console.log(`card-titles: OK (all chunks have human display titles; ${generic} use the generic archive label)`);

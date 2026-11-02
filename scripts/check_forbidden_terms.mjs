#!/usr/bin/env node
// Build guard: fails if any shipped file contains a forbidden internal term.
// Terms are stored ONLY as SHA-256 hashes of the lowercased token, so the term
// itself never appears in this repository. Add hashes via FORBIDDEN_TERM_SHA256
// (comma-separated) or extend DEFAULT_HASHES.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_HASHES = [
  'e509dc8b2493027f47eca0d365050fe7bffb0c776e56538e6057af2d70853172',
];
const HASHES = new Set([
  ...DEFAULT_HASHES,
  ...String(process.env.FORBIDDEN_TERM_SHA256 || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
]);
const TARGETS = (process.argv.slice(2).length ? process.argv.slice(2) : ['dist', 'src', 'public', 'netlify']);
const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.ts', '.astro', '.json', '.geojson', '.md', '.mdx', '.css', '.txt', '.xml', '.svg', '.csv', '.toml', '.yml', '.yaml', '.webmanifest', '.map', '']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.astro', '.netlify']);
const MAX_BYTES = 60 * 1024 * 1024;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const seen = new Map(); // token -> isForbidden
function isForbidden(tok) {
  let v = seen.get(tok);
  if (v === undefined) { v = HASHES.has(sha(tok)); seen.set(tok, v); }
  return v;
}
// split on non-alphanumerics and camelCase boundaries
function tokens(text) {
  const out = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = m[0];
    out.push(w.toLowerCase());
    if (/[a-z][A-Z]/.test(w)) for (const p of w.split(/(?<=[a-z])(?=[A-Z])/)) out.push(p.toLowerCase());
  }
  return out;
}
const hits = [];
let files = 0;
function scanText(rel, text) {
  for (const t of tokens(text)) if (isForbidden(t)) { hits.push(rel); return; }
}
function walk(p) {
  let st; try { st = statSync(p); } catch { return; }
  const rel = relative(ROOT, p);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(p.split('/').pop())) return;
    scanText(rel + '/', rel); // directory names / URLs
    for (const e of readdirSync(p)) walk(join(p, e));
    return;
  }
  scanText(rel, rel); // file names / URLs
  if (!TEXT_EXT.has(extname(p).toLowerCase()) || st.size > MAX_BYTES) return;
  files++;
  scanText(rel, readFileSync(p, 'utf8'));
}
for (const t of TARGETS) { const p = join(ROOT, t); if (existsSync(p)) walk(p); }
if (hits.length) {
  console.error(`forbidden-terms: FAIL — ${hits.length} file(s) contain a forbidden internal term:`);
  for (const h of [...new Set(hits)]) console.error('  ' + h);
  process.exit(1);
}
console.log(`forbidden-terms: OK (${files} text files scanned in ${TARGETS.join(', ')}; ${HASHES.size} term hash(es))`);

#!/usr/bin/env node
// Build guard (2026-10-08): fails if user-visible text in dist/**/*.html shows an internal path or a data file name
// ('src/data', 'BCSFP/', '11_bcs_hub' or '<name>.json'; also 'scripts/…' and '<name>.py' script names). Visible = text nodes + title/alt/aria-label/placeholder
// attributes, after removing <script>, <style>, <template>, <noscript> and comments. Both languages are checked
// (hidden EN spans count). Source labels must be plain institution/dataset/year text instead.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, process.argv[2] || 'dist');
const BAD = /src\/data|BCSFP[\/\\]|11_bcs_hub|(?<![\w/.-])\/?[\w.-]+\.json\b|\b[\w-]+\.json\b|\bscripts\/\w+|\b[\w-]+\.py\b/gi;

function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (n.endsWith('.html')) out.push(p);
  }
  return out;
}
function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}
export function visibleText(html) {
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
  const attrs = [];
  h = h.replace(/<[a-z][^>]*>/gi, (tag) => {
    for (const m of tag.matchAll(/\s(title|alt|aria-label|placeholder)\s*=\s*("([^"]*)"|'([^']*)')/gi)) attrs.push(m[3] ?? m[4] ?? '');
    return ' ';
  }).replace(/<\/[a-z][^>]*>/gi, ' ');
  return decode(h + ' ' + attrs.join(' ')).replace(/\s+/g, ' ');
}

const hits = [];
for (const f of walk(DIST)) {
  const txt = visibleText(readFileSync(f, 'utf8'));
  for (const m of txt.matchAll(BAD)) {
    hits.push({ file: relative(ROOT, f), match: m[0], ctx: txt.slice(Math.max(0, m.index - 50), m.index + m[0].length + 30) });
  }
}
if (hits.length) {
  const byFile = {};
  for (const h of hits) (byFile[h.file] ||= []).push(h);
  for (const [f, hs] of Object.entries(byFile)) {
    console.error(`${f}: ${hs.length}`);
    for (const h of hs.slice(0, Number(process.env.VERBOSE || 3))) console.error(`   «${h.match}» … ${h.ctx}`);
  }
  console.error(`visible-paths: FAIL — ${hits.length} internal path / data-file names in visible text (${Object.keys(byFile).length} pages)`);
  process.exit(1);
}
console.log('visible-paths: OK (no internal paths or *.json names in visible text)');

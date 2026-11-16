import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const views = [
  ['inicio','ask','bcs-chat-input'],
  ['consulta','map','shell-map'],
  ['catalogo','docs','cat-q'],
  ['foresights','foresight','thesis'],
];
for (const [path, active, entry] of views) {
  const html = readFileSync(`dist/${path}/index.html`, 'utf8');
  assert.ok(html.includes(`id="${entry}"`), `Missing page entry: ${path}`);
  const nav = html.match(/<nav\b[^>]*aria-label="Navegación principal"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav, `Missing navigation: ${path}`);
  const links = [...nav.matchAll(/<a\b[^>]+>/g)].map(m => m[0]);
  assert.deepEqual(links.map(a=>a.match(/href="([^"]+)"/)?.[1]), views.map(([route])=>`/${route}/`));
  assert.equal(links.filter(a=>a.includes('aria-current="page"')).length,1);
  assert.ok(links.find(a=>a.includes('aria-current="page"')).includes(`data-destination="${active}"`));
  const forbidden = path === 'inicio' ? /<iframe\b|id="(?:shell-map|shell-tree|cat-q)"|class="shell-files"/i
    : path === 'consulta' ? /id="(?:bcs-chat-input|shell-tree|cat-q)"/
    : /id="(?:shell-map|bcs-chat-input)"/;
  assert.doesNotMatch(html,forbidden, `Mixed workspaces: ${path}`);
}
const index = readFileSync('dist/foresights/index.html', 'utf8');
assert.ok(index.includes('id="vision-tendencia"'), 'Missing Visión tendencia section');
assert.ok(index.includes('id="foresight-archive"'), 'Missing foresight archive list');
assert.ok(index.includes('/foresights/2026-11-09/'), 'Archive should link the 9 Nov edition');
assert.ok(existsSync('dist/foresights/2026-11-09/index.html'), 'Missing 2026-11-09 permalink');
assert.ok(existsSync('dist/foresights/2026-10-26/index.html'), 'Missing 2026-10-26 permalink');
assert.ok(existsSync('dist/foresights/2026-09-28/index.html'), 'Missing 2026-09-28 permalink');
const nov9 = readFileSync('dist/foresights/2026-11-09/index.html', 'utf8');
assert.ok(nov9.includes('Vance'), '9 Nov permalink should keep its recovered headline');
assert.doesNotMatch(readFileSync('dist/conversation.js','utf8'), /createElement\(\s*['"]iframe['"]|embed=1/);
console.log('Chat, Mapa 3D, Documentos y Foresight: navegación, archivo y separación correctas.');

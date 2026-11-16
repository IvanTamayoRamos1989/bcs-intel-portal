import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const portada = readFileSync('dist/portada/index.html', 'utf8');
assert.ok(portada.includes('id="landing-news"'), 'Missing news column on landing');
assert.ok(portada.includes('id="vision-tendencia"'), 'Missing Tendencia 2050 on landing');
assert.ok(portada.includes('id="vision-ideal"'), 'Missing Visión on landing');
assert.ok(portada.includes('Tendencia 2050'), 'Landing should name Tendencia 2050');
assert.ok((portada.match(/Actualizada:/g) || []).length >= 2, 'Landing should show Actualizada: on Tendencia and Visión');
assert.ok(portada.includes('/auth-gate.js'), 'Landing must keep the client auth gate');
assert.ok(!/<nav\b[^>]*aria-label="Navegación principal"/.test(portada), 'Landing should not show the main nav');
for (const href of ['/inicio/', '/consulta/', '/catalogo/', '/foresights/']) {
  assert.ok(portada.includes(`href="${href}"`), `Landing footer should link ${href}`);
}

const gate = readFileSync('dist/index.html', 'utf8');
assert.ok(gate.includes('id="gate-password"'), 'Root must remain the password gate for unauthenticated visitors');
assert.ok(gate.includes('/api/auth'), 'Gate must post to /api/auth');
assert.ok(!gate.includes('id="landing-news"'), 'Gate HTML must not leak landing news');
assert.ok(gate.includes('/portada/'), 'Gate should send authenticated users to /portada/');

const views = [
  ['inicio', 'ask', 'bcs-chat-input'],
  ['consulta', 'map', 'shell-map'],
  ['catalogo', 'docs', 'cat-q'],
  ['foresights', 'foresight', 'thesis'],
];
for (const [path, active, entry] of views) {
  const file = `dist/${path}/index.html`;
  assert.ok(existsSync(file), `Legacy route missing from build: ${path}`);
  const html = readFileSync(file, 'utf8');
  assert.ok(html.includes(`id="${entry}"`), `Missing page entry: ${path}`);
  const nav = html.match(/<nav\b[^>]*aria-label="Navegación principal"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav, `Missing navigation on legacy route: ${path}`);
  const links = [...nav.matchAll(/<a\b[^>]+>/g)].map(m => m[0]);
  assert.deepEqual(links.map(a => a.match(/href="([^"]+)"/)?.[1]), views.map(([route]) => `/${route}/`));
  assert.equal(links.filter(a => a.includes('aria-current="page"')).length, 1);
  assert.ok(links.find(a => a.includes('aria-current="page"')).includes(`data-destination="${active}"`));
  const forbidden = path === 'inicio' ? /<iframe\b|id="(?:shell-map|shell-tree|cat-q)"|class="shell-files"/i
    : path === 'consulta' ? /id="(?:bcs-chat-input|shell-tree|cat-q)"/
    : path === 'catalogo' ? /id="(?:shell-map|bcs-chat-input)"/
    : /id="(?:shell-map|bcs-chat-input)"/;
  assert.doesNotMatch(html, forbidden, `Mixed workspaces: ${path}`);
}

const foresights = readFileSync('dist/foresights/index.html', 'utf8');
assert.ok(foresights.includes('id="vision-tendencia"'), 'Missing Tendencia 2050 on /foresights/');
assert.ok(foresights.includes('id="vision-ideal"'), 'Missing Visión on /foresights/');
assert.ok(foresights.includes('id="foresight-archive"'), 'Missing foresight archive list');
assert.ok(foresights.includes('/foresights/2026-11-09/'), 'Archive should link the 9 Nov edition');
assert.ok(existsSync('dist/foresights/2026-11-09/index.html'), 'Missing 2026-11-09 permalink');
assert.ok(existsSync('dist/foresights/2026-10-26/index.html'), 'Missing 2026-10-26 permalink');
assert.ok(existsSync('dist/foresights/2026-09-28/index.html'), 'Missing 2026-09-28 permalink');
const nov9 = readFileSync('dist/foresights/2026-11-09/index.html', 'utf8');
assert.ok(nov9.includes('Vance'), '9 Nov permalink should keep its recovered headline');
assert.doesNotMatch(readFileSync('dist/conversation.js', 'utf8'), /createElement\(\s*['"]iframe['"]|embed=1/);
console.log('Portada (noticias, tendencia, visión), puerta de acceso y rutas heredadas: correctas.');

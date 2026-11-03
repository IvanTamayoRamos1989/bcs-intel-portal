import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const views = [['inicio','ask','bcs-chat-input'],['consulta','map','shell-map'],['catalogo','docs','cat-q']];
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
    : path === 'consulta' ? /id="(?:bcs-chat-input|shell-tree|cat-q)"/ : /id="(?:shell-map|bcs-chat-input)"/;
  assert.doesNotMatch(html,forbidden, `Mixed workspaces: ${path}`);
}
assert.doesNotMatch(readFileSync('dist/conversation.js','utf8'), /createElement\(\s*['"]iframe['"]|embed=1/);
console.log('Chat, Mapa 3D y Documentos: navegación y separación correctas.');

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL('../public/shell/evidence.js', import.meta.url), 'utf8'), context);
const { sources, safeLink } = context.ShellEvidence;
for (const url of ['javascript:alert(1)', '//untrusted.example', '/\\untrusted.example', 'data:text/html,x']) assert.equal(safeLink(url), null);
const cards = sources([
  { title: 'Informe oficial', href: 'https://example.org/informe.pdf' },
  { title: 'Duplicado', href: 'https://example.org/informe.pdf' },
  { title: 'Noticia', url: 'https://example.org/noticia' },
  { title: 'Referencia sin enlace' },
  { title: 'Enlace inválido', href: 'javascript:alert(1)', catalog_url: '/catalogo/?q=agua' },
]);
assert.equal(cards.length, 4);
assert.equal(cards[0].direct, true);
assert.equal(cards[1].href, 'https://example.org/noticia');
assert.equal(cards[2].direct, false);
assert.equal(cards[2].href, '/catalogo/?q=Referencia%20sin%20enlace');
assert.equal(cards[3].href, '/catalogo/?q=agua');
assert.equal(sources(null).length, 0);
console.log('PASS: evidence links, deduplication and honest catalog fallbacks');

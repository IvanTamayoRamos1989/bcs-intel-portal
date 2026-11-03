import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handler } from '../netlify/functions/chat.mjs';
import { signToken } from '../netlify/lib/auth_shared.mjs';

delete process.env.BCS_CHAT_API_KEY;
process.env.BCS_PORTAL_SESSION_SECRET = 'document-search-test';
const cookie = 'bcs_portal_auth=' + signToken();
async function ask(message) {
  const response = await handler({ httpMethod: 'POST', headers: {cookie}, body: JSON.stringify({message, lang:'es'}) });
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body);
}

const water = await ask('Disponibilidad del acuífero Santo Domingo 0306');
assert.equal(water.mode, 'document_search');
assert.match(water.answer, /-30\.280721/);
assert.ok(water.sources.some(s => s.href === '/gis/territorio/disponibilidad-acuiferos-2023.pdf#page=3'));
assert.equal(readFileSync(new URL('../public/gis/territorio/disponibilidad-acuiferos-2023.pdf', import.meta.url)).subarray(0,4).toString(), '%PDF');

const empty = await ask('qzx543z');
assert.equal(empty.grounded, false);
assert.deepEqual(empty.sources, []);
console.log('OK · Sin proveedor: búsqueda documental, cifra y fuente de 0306, consulta sin coincidencias.');

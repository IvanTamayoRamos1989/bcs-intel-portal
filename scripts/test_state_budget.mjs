import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stateBudgetOverview } from '../netlify/lib/state_budget.mjs';
import { buildIndex, search } from '../netlify/lib/rag.mjs';

const question = 'explain me the budget in detail of the state of baja claifornia sur';
const index = buildIndex(JSON.parse(readFileSync(new URL('../netlify/functions/chat_corpus.json', import.meta.url))));
assert.equal(search(index,question).weakTop,false);
assert.match(stateBudgetOverview(question,'es').answer,/Social development/);
for (const [q,lang] of [[question,'en'], ['Explícame en detalle el presupuesto de Baja California Sur','es']]) {
  const result = stateBudgetOverview(q,lang);
  assert.match(result.answer,/26,903,040,145/);
  assert.match(result.answer,/19,168,131,266/);
  assert.ok(result.answer.includes(lang==='en'?'Social development':'Desarrollo social'));
  assert.equal(result.sources.length,2);
  const sum = [...result.answer.matchAll(/^- .*?: \*\*([\d,]+) MXN\*\*/gm)]
    .reduce((s,m)=>s+Number(m[1].replaceAll(',','')),0);
  assert.equal(sum,26903040145);
}
for (const other of ['state budget for education in 2024','presupuesto de Los Cabos en BCS','the state budget for hurricane relief','state budget of Baja California Norte','explain the electricity grid']) {
  assert.equal(stateBudgetOverview(other,'en'),null);
}
console.log('PASS: state budget in English and Spanish, totals, period, sources, scope');

import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../public/finanzas-publicas/',import.meta.url));
const catalog=JSON.parse(readFileSync(root+'catalog.json','utf8'));
const budget=JSON.parse(readFileSync(root+'budget-2026-q2.json','utf8'));
assert.equal(budget.approved+budget.adjustments,budget.modified);
assert.equal(budget.modified-budget.accrued,budget.unspent);
assert.equal(budget.unit,'MXN');assert.equal(budget.source_page,2);
assert.equal(budget.period_end,'2026-06-30');
const prior=JSON.parse(readFileSync(new URL('../src/data/fiscal_docs.json',import.meta.url),'utf8'));
assert.equal(budget.approved,prior.state_pe_2026,'Approved total agrees with the existing fiscal source');
const ids=new Set();
for(const r of catalog.records){
 assert(!ids.has(r.id),'Unique URL identity');ids.add(r.id);
 assert.equal(r.status,'ok');assert.match(r.sha256,/^[a-f0-9]{64}$/);
 assert(r.excerpt.length>60,'No filename-only public entries');
 assert(new URL(r.url).hostname.endsWith('.gob.mx'));
 assert(!('local_path' in r));assert(r.source_pages.length>0);
}
const html=readFileSync(root+'index.html','utf8');
for(const [,asset] of html.matchAll(/(?:src|href)="([^"/:]+\.(?:css|js|json|csv))"/g))assert(existsSync(root+asset),'Missing '+asset);
assert(!html.includes('immersive-map.html'),'Production links use the current twin');
assert(catalog.complete===false || !['pending','running','error'].some(k=>catalog.counts[k]));
console.log(`finanzas: OK · ${ids.size} source-backed PDF entries · budget reconciliation passed`);

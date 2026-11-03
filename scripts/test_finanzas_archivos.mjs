#!/usr/bin/env node
/**
 * Verification suite for Issue #130 (Grok + Antigravity — Archivos y Catálogo Finanzas):
 * 1. «Cuenta pública» and «presupuesto de egresos» lead to the right document and year (2025 Cuenta Pública, 2026 Presupuesto de Egresos Decreto 3266, Mulegé 2026, Comondú 2026 BO 05).
 * 2. Approved budgets state "monto aprobado/asignado; no equivale a gasto ejercido".
 * 3. Broken links (La Paz HTTP 500, Datos Abiertos 2026 HTTP 404) and municipal gaps (Loreto) are explicitly marked (`status: 'broken'|'gap'`, `gid: null`, `dv: ''`).
 * 4. 3-pane Archivos index (`public/shell/files.json`) surfaces the verified finance documents.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slim = JSON.parse(fs.readFileSync(path.join(root, 'src/data/catalog_slim.json'), 'utf8'));
const fp = JSON.parse(fs.readFileSync(path.join(root, 'public/finanzas-publicas/catalog.json'), 'utf8'));
const shellFiles = JSON.parse(fs.readFileSync(path.join(root, 'public/shell/files.json'), 'utf8'));

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`PASS [${passed}]: ${name}`);
}

check('Search «cuenta pública» finds 2025 State Cuenta Pública (Gastos & Ingresos) and 2024 Mulegé Cuenta Pública', () => {
  const hits = slim.filter((r) => norm(`${r.n} ${r.sum_es}`).includes('cuenta publica') && (r.gid || r.dv));
  assert.ok(hits.some((r) => r.y === 2025 && /Gastos-Presupuestarios/i.test(r.n)), 'Missing 2025 Cuenta Pública Gastos');
  assert.ok(hits.some((r) => r.y === 2025 && /Ingresos-Presupuestarios/i.test(r.n)), 'Missing 2025 Cuenta Pública Ingresos');
  assert.ok(hits.some((r) => r.y === 2024 && /Mulege/i.test(r.n)), 'Missing 2024 Mulegé Cuenta Pública');
});

check('Search «presupuesto de egresos» finds 2026 State Decreto 3266, 2026 Mulegé, and 2026 Comondú BO 05 with approved-vs-spent caveat', () => {
  const hits = slim.filter((r) => norm(`${r.n} ${r.sum_es}`).includes('presupuesto de egresos') && (r.gid || r.dv));
  const state2026 = hits.find((r) => r.y === 2026 && /Decreto-3266/i.test(r.n));
  const mulege2026 = hits.find((r) => r.y === 2026 && /Mulege/i.test(r.n));
  const comondu2026 = hits.find((r) => r.y === 2026 && /Comondu/i.test(r.n));
  assert.ok(state2026, 'Missing 2026 State Presupuesto de Egresos Decreto 3266');
  assert.ok(mulege2026, 'Missing 2026 Mulegé Presupuesto de Egresos');
  assert.ok(comondu2026, 'Missing 2026 Comondú Presupuesto de Egresos BO 05');
  assert.match(state2026.sum_es, /no equivale a gasto ejercido/i);
  assert.match(mulege2026.sum_es, /no equivale a gasto ejercido/i);
  assert.match(comondu2026.sum_es, /no indica monto gastado/i);
});

check('Broken links (La Paz HTTP 500, Datos Abiertos 2026 HTTP 404) and gaps (Loreto) are marked as unavailable', () => {
  const brokenLaPaz = slim.find((r) => /ENLACE-ROTO-HTTP500/i.test(r.n));
  const broken2026 = slim.find((r) => /ENLACE-ROTO-HTTP404/i.test(r.n));
  const gapLoreto = slim.find((r) => /Hueco-Documental.*Loreto/i.test(r.n));
  assert.ok(brokenLaPaz && !brokenLaPaz.gid && !brokenLaPaz.dv, 'La Paz HTTP 500 must be marked without active link');
  assert.ok(broken2026 && !broken2026.gid && !broken2026.dv, 'Datos Abiertos 2026 HTTP 404 must be marked without active link');
  assert.ok(gapLoreto && !gapLoreto.gid && !gapLoreto.dv, 'Loreto gap must be marked without active link');

  const fpBroken = fp.records.filter((r) => r.status === 'broken' || r.status === 'gap');
  assert.ok(fpBroken.length >= 3, 'finanzas-publicas/catalog.json must record broken/gap entries');
});

check('3-pane Archivos index (public/shell/files.json) surfaces the verified 2025-2026 finance documents', () => {
  const hits = (shellFiles.files || []).filter((row) => row[1] === 'gobierno' && /Presupuesto|Cuenta Publica/i.test(norm(row[0])));
  assert.ok(hits.length >= 8, `Expected at least 8 verified finance files in shell/files.json, found ${hits.length}`);
});

console.log(`ALL ${passed} FINANZAS CHECKS PASSED.`);

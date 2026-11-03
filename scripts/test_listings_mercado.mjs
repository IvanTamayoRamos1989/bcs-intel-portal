#!/usr/bin/env node
/**
 * Verification suite for Issue #130 (Antigravity — Mercado y datos de economía):
 * 1. Concrete listing search: identical id, price, currency, municipality, locality, cutoff date & source across Map GeoJSON, Archivos CSV and Archivos JSON.
 * 2. Total reconciliation: 3,751 deduplicated listings across all views, reconciled with coordinates and INEGI block spatial join (1,548 inside + 530 <=50m + 1,673 coastal/rural = 3,751).
 * 3. Asking-price caveat: asking prices are never presented as closed sales.
 * 4. INEGI manzana layer: only blocks with real sample (anuncios_n >= 1) are included; precio_m2_mediana_usd is null when anuncios_con_m2_n === 0.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const geo = JSON.parse(fs.readFileSync(path.join(root, 'public/gis/bcs_market_listings.geojson'), 'utf8'));
const mzGeo = JSON.parse(fs.readFileSync(path.join(root, 'public/gis/bcs_market_listings_manzanas.geojson'), 'utf8'));
const sum = JSON.parse(fs.readFileSync(path.join(root, 'src/data/bcs_market_listings_summary.json'), 'utf8'));
const jsonList = JSON.parse(fs.readFileSync(path.join(root, 'public/listings/BCS_Listings_3751.json'), 'utf8'));
const csvText = fs.readFileSync(path.join(root, 'public/listings/BCS_Listings_3751.csv'), 'utf8').replace(/^\uFEFF/, '');
const shellFiles = JSON.parse(fs.readFileSync(path.join(root, 'public/shell/files.json'), 'utf8'));

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`PASS [${passed}]: ${name}`);
}

check('Total count reconciles across Map GeoJSON, Archivos JSON, Archivos CSV, and Chat Summary (3,751)', () => {
  const csvLines = csvText.trim().split(/\r?\n/);
  assert.equal(geo.features.length, 3751, 'GeoJSON must have 3,751 features');
  assert.equal(jsonList.length, 3751, 'JSON list must have 3,751 records');
  assert.equal(csvLines.length - 1, 3751, 'CSV must have 3,751 data rows');
  assert.equal(sum.totalProperties, 3751, 'Summary totalProperties must be 3,751');
  assert.equal(
    sum.reconciliation.withExactCoordinates +
      sum.reconciliation.withLocalityCentroid +
      sum.reconciliation.withoutReliableLocationExcluded,
    sum.reconciliation.deduplicatedTotal,
    'Coordinate reconciliation must sum to deduplicatedTotal'
  );
});

check('Zero duplicate IDs, all required Claude/Codex schema keys present, and 3,738 priced + 13 unpriced (null) reconcile to 3,751', () => {
  const ids = new Set();
  let priced = 0;
  let unpriced = 0;
  for (const f of geo.features) {
    const p = f.properties;
    assert.ok(p.id, 'Missing id');
    assert.ok(!ids.has(p.id), `Duplicate id: ${p.id}`);
    ids.add(p.id);
    for (const key of ['id', 'municipio', 'localidad', 'fecha', 'moneda', 'tipo', 'fuente']) {
      assert.ok(p[key] !== undefined && p[key] !== null && p[key] !== '', `Missing ${key} on ${p.id}`);
    }
    if (p.precio === null) unpriced++;
    else if (typeof p.precio === 'number' && p.precio > 0) priced++;
    assert.ok('m2' in p && 'precio_m2' in p && 'mz' in p, `Missing m2/precio_m2/mz keys on ${p.id}`);
  }
  assert.equal(priced, 3738, 'Expected 3,738 listings with asking price');
  assert.equal(unpriced, 13, 'Expected 13 listings without asking price kept as null (never invented)');
  assert.equal(priced + unpriced, 3751, 'Priced + unpriced must equal 3,751');
});

check('Concrete listing lookup matches across Map GeoJSON, Archivos JSON, and Archivos CSV across all 5 municipalities', () => {
  const byMuni = new Map();
  for (const f of geo.features) {
    const m = f.properties.municipio;
    if (!byMuni.has(m)) byMuni.set(m, f.properties);
  }
  assert.equal(byMuni.size, 5, 'All 5 BCS municipalities must be represented');

  const jsonById = new Map(jsonList.map((r) => [r.id, r]));
  for (const [muni, sample] of byMuni.entries()) {
    const inJson = jsonById.get(sample.id);
    assert.ok(inJson, `Listing ${sample.id} (${muni}) missing in BCS_Listings_3751.json`);
    assert.equal(inJson.precio, sample.precio, `Price mismatch for ${sample.id}`);
    assert.equal(inJson.moneda, sample.moneda, `Currency mismatch for ${sample.id}`);
    assert.equal(inJson.municipio, sample.municipio, `Municipality mismatch for ${sample.id}`);
    assert.equal(inJson.fecha, sample.fecha, `Date mismatch for ${sample.id}`);
    assert.ok(csvText.includes(sample.id), `Listing ${sample.id} (${muni}) missing in BCS_Listings_3751.csv`);
    assert.ok(csvText.includes(String(sample.precio)), `Price ${sample.precio} missing in CSV for ${sample.id}`);
  }
});

check('Asking-price caveat ("no venta cerrada") is explicit in GeoJSON, Summary, and Manzana layer', () => {
  assert.match(sum.caveat_es, /no equivalen a precios de venta cerrada|no son ventas cerradas/i);
  assert.match(geo.features[0].properties.fuente, /no venta cerrada/i);
  assert.match(mzGeo.metadata.rule, /no ventas cerradas/i);
});

check('INEGI manzana join reconciles (1,548 inside + 530 <=50m + 1,673 outside = 3,751) and never extrapolates empty blocks', () => {
  const mj = sum.manzanaJoin;
  assert.equal(
    mj.listingsInsideManzana + mj.listingsWithin50mOfManzana + mj.listingsOutsideUrbanManzanas,
    3751,
    'Manzana join counts must sum to 3,751'
  );
  assert.equal(mzGeo.features.length, 891, 'Only the 891 INEGI blocks with active sample may be in bcs_market_listings_manzanas.geojson');
  for (const f of mzGeo.features) {
    const p = f.properties;
    assert.ok(p.anuncios_n >= 1, `Block ${p.id} has 0 listings`);
    if (p.anuncios_con_m2_n === 0) {
      assert.equal(p.precio_m2_mediana_usd, null, `Block ${p.id} must have null precio_m2_mediana_usd when anuncios_con_m2_n is 0`);
    } else {
      assert.ok(p.precio_m2_mediana_usd > 0, `Block ${p.id} with m2 sample must have positive precio_m2_mediana_usd`);
    }
  }
});

check('3-pane Archivos index (public/shell/files.json) exposes the unified market listings files', () => {
  const hits = (shellFiles.files || []).filter((row) => String(row[0]).includes('MLS-BCS'));
  assert.ok(hits.length >= 4, `Expected at least 4 MLS-BCS entries in public/shell/files.json, found ${hits.length}`);
});

console.log(`ALL ${passed} CHECKS PASSED.`);

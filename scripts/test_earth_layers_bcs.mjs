#!/usr/bin/env node
/**
 * Automated verification for the Baja California Sur 2050 Google Earth layers
 * integrated into the 3D Map (/consulta/) and Documents (/catalogo/).
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const EXPECTED_LAYER_IDS = [
  'curvas_nivel_bcs',
  'pendiente_terreno_bcs',
  'altitud_terreno_bcs',
  'cobertura_vegetal_bcs',
  'agricultura_inegi',
  'ran_nucleos',
  'acuiferos_conagua',
  'presas_cea',
  'desagues_pluviales_bcs',
  'inundaciones_historico_bcs',
  'infraestructura_urbana_bcs',
  'limites_velocidad_vial_bcs',
  'ciclovias_bcs',
  'reparto_bicicleta_bcs',
  'estaciones_carga_ve_bcs',
  'traffic_sict_bcs',
  'bottlenecks_sict_bcs',
  'vivienda_multifamiliar_bcs',
  'codigos_postales_bcs',
  'bcs_market_listings_manzanas',
  'density_muni',
];

const layers = JSON.parse(readFileSync(join(ROOT, 'public/gis/layers.json'), 'utf8'));
const byId = Object.fromEntries(layers.map((l) => [l.id, l]));

// 1. Check all layers exist in public/gis/layers.json and have valid GeoJSON files
let totalFeatures = 0;
for (const id of EXPECTED_LAYER_IDS) {
  const meta = byId[id];
  assert.ok(meta, `Missing layer in public/gis/layers.json: ${id}`);
  const relPath = meta.url.replace(/^\//, '');
  const fullPath = join(ROOT, 'public', relPath);
  assert.ok(existsSync(fullPath), `Missing GeoJSON file on disk for ${id}: ${fullPath}`);
  const fc = JSON.parse(readFileSync(fullPath, 'utf8'));
  assert.equal(fc.type, 'FeatureCollection', `${id} must be a FeatureCollection`);
  assert.ok(Array.isArray(fc.features) && fc.features.length > 0, `${id} must have features`);
  totalFeatures += fc.features.length;
}
console.log(`PASS [1]: All ${EXPECTED_LAYER_IDS.length} BCS 2050 geospatial layers exist and validate (${totalFeatures.toLocaleString('en-US')} total features)`);

// 2. Check /consulta/ (dist/consulta/index.html) renders checkboxes for all expected layers
const consultaHtml = readFileSync(join(ROOT, 'dist/consulta/index.html'), 'utf8');
for (const id of EXPECTED_LAYER_IDS) {
  assert.ok(
    consultaHtml.includes(`data-layer="${id}"`),
    `dist/consulta/index.html missing checkbox for data-layer="${id}"`
  );
}
console.log(`PASS [2]: 3D Map page (/consulta/) renders layer controls for all ${EXPECTED_LAYER_IDS.length} layers`);

// 3. Check public/shell/files.json includes the geospatial layer catalog for /catalogo/
const filesDoc = JSON.parse(readFileSync(join(ROOT, 'public/shell/files.json'), 'utf8'));
assert.ok(
  filesDoc.folders.includes('Capas geoespaciales · Baja California Sur 2050'),
  'Missing folder Capas geoespaciales · Baja California Sur 2050 in public/shell/files.json'
);
console.log('PASS [3]: Documents index (public/shell/files.json) exposes the BCS 2050 geospatial layers');
console.log('ALL BCS 2050 EARTH LAYER CHECKS PASSED.');

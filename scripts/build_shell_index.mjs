/**
 * Compact file index for the 3-pane shell. Real catalog, news and stills only.
 * Writes public/shell/files.json. No invented documents.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/shell/files.json');

const FOLDERS = [
  ['catalogo', 'Catálogo', 'Catalog'],
  ['planeacion', 'Planeación', 'Planning'],
  ['agua', 'Agua', 'Water'],
  ['energia', 'Energía', 'Energy'],
  ['movilidad', 'Movilidad', 'Mobility'],
  ['poblacion', 'Población', 'Population'],
  ['ambiente', 'Ambiente', 'Environment'],
  ['economia', 'Economía', 'Economy'],
  ['estudios', 'Estudios', 'Studies'],
  ['acervo', 'Acervo', 'Archive'],
  ['portal', 'Portal', 'Portal'],
  ['relaciones', 'Relaciones', 'Relationships'],
  ['proyectos', 'Proyectos federales', 'Federal projects'],
  ['biblioteca', 'Biblioteca', 'Library'],
  ['territorio', 'Territorio', 'Territory'],
  ['atlas', 'Atlas', 'Atlas'],
  ['gobierno', 'Gobierno', 'Government'],
  ['noticias', 'Noticias', 'News'],
  ['fotogramas', 'Fotogramas', 'Frames'],
  ['otros', 'Otros archivos', 'Other files'],
];

const FOLDER_OF = {
  '00_catalog': 'catalogo',
  '01_planning': 'planeacion',
  '02_water': 'agua',
  '03_energy': 'energia',
  '04_mobility_waste': 'movilidad',
  '05_demographics': 'poblacion',
  '06_environment': 'ambiente',
  '07_economy_investment': 'economia',
  '09_shadow_programme': 'estudios',
  '10_data_lake': 'acervo',
  '11_bcs_hub': 'portal',
  '12_ontology': 'relaciones',
  '13_federal_projects': 'proyectos',
  '13_library': 'biblioteca',
  '13_territorial_intelligence': 'territorio',
  '14_gis_atlas': 'atlas',
  '14_gobierno': 'gobierno',
};

function readJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

function niceName(filename) {
  return String(filename || '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const files = [];
const seen = new Set();
const slim = readJson('src/data/catalog_slim.json');
for (const row of slim) {
  const href = row.dv || row.dd || '';
  if (!href) continue;
  const key = row.gid || href;
  if (seen.has(key)) continue;
  seen.add(key);
  const folder = FOLDER_OF[row.f] || 'otros';
  files.push([niceName(row.n), folder, row.e || '', href, 'd']);
}

const news = readJson('src/data/news.json');
for (const item of news.items || []) {
  if (!item.url || !item.title_es) continue;
  files.push([item.title_es, 'noticias', 'web', item.url, 'w']);
}

const stills = readJson('src/data/stills.json');
for (const s of stills) {
  if (!s.image || !s.name) continue;
  const label = s.municipio ? `${s.name} · ${s.municipio}` : s.name;
  files.push([label, 'fotogramas', 'jpg', s.image, 'i']);
}

mkdirSync(dirname(out), { recursive: true });
const payload = { folders: FOLDERS, files };
writeFileSync(out, JSON.stringify(payload));
console.log(`shell index: ${files.length} files, ${FOLDERS.length} folders, ${Buffer.byteLength(JSON.stringify(payload))} bytes`);

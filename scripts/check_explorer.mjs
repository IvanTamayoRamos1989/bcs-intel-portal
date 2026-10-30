// Build gate for /explorar (atlas). Fails the build on:
//  - pure black in the atlas CSS/JS/page (#000, #000000, black, rgb(a)(0,0,0))
//  - manifest/layer mismatch, missing provenance, features without key/name/valid geometry
//  - synthetic points in polygon/line/facility layers, coordinates outside the BCS frame
//  - visible file paths / filenames in atlas data or page
//  - missing reduced-motion path, OSM attribution, WebGL fallback, aquifers drawn without polygons
import { readFileSync, existsSync, statSync } from 'node:fs';
const errors = [];
const fail = m => errors.push(m);
const root = existsSync('dist/explorar/data/manifest.json') ? 'dist/explorar' : 'public/explorar';
const read = p => readFileSync(p, 'utf8');

// 1. no pure black
const blackRe = [/#000(?![0-9a-f])/i, /#000000(?![0-9a-f])/i, /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*[,)]/i, /\bblack\b(?![ _]marble)/i];
const pageHtml = existsSync('dist/explorar/index.html') ? 'dist/explorar/index.html' : null;
for (const f of [`${root}/explorer.css`, `${root}/explorer.js`, 'src/pages/explorar.astro', ...(pageHtml ? [pageHtml] : [])]) {
  let txt = read(f);
  if (f.endsWith('index.html')) txt = txt.replace(/<aside id="bcs-chat"[\s\S]*?<\/aside>/, '').replace(/<style[^>]*>[\s\S]*?<\/style>/g, m => (m.includes('bcs-chat') || m.includes('bcs-ps-') ? '' : m));
  txt.split('\n').forEach((line, i) => { for (const re of blackRe) if (re.test(line)) fail(`no-black: ${f}:${i + 1}: ${line.trim().slice(0, 120)}`); });
}

// 2. manifest, provenance, geometry
const M = JSON.parse(read(`${root}/data/manifest.json`));
const REQ = ['title', 'owner', 'date', 'license', 'url', 'resolution', 'method', 'limits'];
// Whole features are kept (no clipping): the federal Pacific-islands reserve reaches the Coronado islands (~32.5° N).
const FRAME = [-118.5, 20.0, -105.5, 33.0];
const counts = {};
for (const L of M.layers) {
  for (const k of REQ) if (!L.source?.[k] || String(L.source[k]).trim().length < 2) fail(`provenance: ${L.id} missing source.${k}`);
  const fc = JSON.parse(read(`${root}/data/${L.file}`));
  if (fc.features.length !== L.count) fail(`count: ${L.id} manifest ${L.count} != features ${fc.features.length}`);
  counts[L.id] = fc.features.length;
  const keys = new Set();
  for (const f of fc.features) {
    const p = f.properties || {};
    if (!p._k) fail(`feature without key in ${L.id}`); else if (keys.has(p._k)) fail(`duplicate key ${p._k} in ${L.id}`); else keys.add(p._k);
    if (!p._n || !String(p._n).trim()) fail(`feature without name ${p._k} in ${L.id}`);
    const g = f.geometry; if (!g || !g.coordinates) { fail(`feature without geometry ${p._k}`); continue; }
    const t = g.type;
    if (L.geom === 'point' && t !== 'Point') fail(`${L.id}: expected Point, got ${t}`);
    if (L.geom !== 'point' && /Point/.test(t) && !(L.geom === 'facility' && /^osm-(node|relation|tr)-/.test(p._k) && p._geom_note)) fail(`synthetic point in ${L.id}: ${p._k}`);
    if (L.geom === 'line' && !/LineString/.test(t)) fail(`${L.id}: expected line, got ${t}`);
    if ((L.geom === 'polygon' || (L.geom === 'facility' && !p._geom_note)) && !/Polygon/.test(t)) fail(`${L.id}: expected polygon, got ${t}`);
    (function walk(c) {
      if (typeof c[0] === 'number') { if (!(c[0] >= FRAME[0] && c[0] <= FRAME[2] && c[1] >= FRAME[1] && c[1] <= FRAME[3])) fail(`coordinate outside frame in ${L.id} ${p._k}: ${c}`); }
      else c.forEach(walk);
    })(g.coordinates);
    if (L.id === 'substations' && /cartografiada\s+\d/i.test(p._n)) fail(`substation title uses bare OSM id: ${p._n}`);
  }
}
for (const id of ['protected', 'priority', 'zoning', 'agrarian', 'roads', 'rivers', 'runoff']) if (!(M.checks?.vertex_subset_checked?.[id] > 0)) fail(`vertex-subset verification missing for ${id}`);
if (M.layers.some(l => /acu[ií]fero/i.test(l.label))) fail('aquifers drawn as a layer without official polygons');
if (!(M.missing || []).some(x => x.id === 'aquifers')) fail('aquifers row (Información por ubicar) missing');
for (const b of M.base_sources || []) for (const k of REQ) if (!b[k]) fail(`provenance: base ${b.id} missing ${k}`);

// 3. leaks: file paths / filenames
const leakRe = /(\/workspace\/|\/home\/|[A-Z]:\\|\.gpkg\b|\.shp\b|\.kmz?\b|\.zip\b|\.xlsx?\b|\.csv\b|\.geojson\b|\.py\b)/i;
for (const f of [`${root}/data/manifest.json`, `${root}/data/knowledge.json`, ...(pageHtml ? [pageHtml] : [])]) {
  let txt = read(f);
  if (f.endsWith('knowledge.json')) { const K = JSON.parse(txt); txt = JSON.stringify({ t: K.topics, u: K.unlocated, m: K.municipal, r: K.relations, i: K.items.map(i => [i.title, i.text, i.kind]) }); }
  const m = txt.match(leakRe); if (m) fail(`visible path/filename in ${f}: …${txt.slice(Math.max(0, m.index - 60), m.index + 40)}…`);
}

// 4. behaviour contracts in the atlas code
const js = read(`${root}/explorer.js`);
for (const [needle, what] of [["prefers-reduced-motion", 'reduced-motion path'], ['openstreetmap.org/copyright', 'OSM attribution'], ['enterFallback', 'WebGL fallback'], ["e.key === 'Escape'", 'Escape handling'], ['focusIn(', 'panel focus management'], ['conexión temática', 'thematic link label'], ['Información por ubicar', 'unlocated inventory']]) if (!js.toLowerCase().includes(needle.toLowerCase())) fail(`missing ${what}`);
if (/Archivo de origen|source\.path/.test(js)) fail('atlas code exposes source file paths');

// 5. first-load budget (map + base data, excluding lazy layers)
const first = ['explorer.js', 'explorer.css', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css', 'data/manifest.json', 'data/base.json', 'data/knowledge.json'].reduce((s, f) => s + statSync(`${root}/${f}`).size, 0);
if (first > 2.6e6) fail(`first-load raw size ${first} B exceeds 2.6 MB budget`);

if (errors.length) { console.error(`check_explorer: ${errors.length} problem(s)\n` + errors.slice(0, 60).join('\n')); process.exit(1); }
console.log(`check_explorer: OK (${root}) · layers ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')} · first-load raw ${(first / 1e6).toFixed(2)} MB`);

#!/usr/bin/env node
// Building engine test (Claude). Against a served build:
//   npm run build && npx astro preview --port 4321
//   BASE=http://localhost:4321 node scripts/test_edificios.mjs
// Acceptance points from issue #130 (map):
//   1. index.json lists the nine zones with source and limits, and the PMTiles file answers byte ranges.
//   2. The statewide view downloads no building tiles, even with buildings on.
//   3. Loreto and La Paz draw buildings at city zoom, with height, storeys, area and block fields.
//   4. setBuildings(false) hides them; setBuildings(true) brings them back.
//   5. Tapping a building opens its fiche. This needs the shell wiring of `cdt-bld-*` (Codex):
//      reported as PENDING, not FAIL, until the shell answers with a building fiche.
// Exit code 0 when checks 1-4 pass.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4321';
// The map page: PAGE if given, otherwise the first of these that loads the 3D engine script.
async function mapPage() {
  if (process.env.PAGE) return process.env.PAGE;
  for (const p of ['/consulta/', '/inicio/']) {
    const r = await fetch(BASE + p).catch(() => null);
    if (r && r.ok && /gemelo\/cdt3d\.js/.test(await r.text())) return p;
  }
  return '/inicio/';
}
const PAGE = await mapPage();
const results = [];
function check(name, ok, detail = '', pending = false) {
  const tag = ok ? 'PASS' : pending ? 'PENDING' : 'FAIL';
  results.push({ name, ok: ok || pending });
  console.log(`${tag} · ${name}${detail ? ' · ' + detail : ''}`);
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const tileHits = [];
// Building tile reads = range requests on the PMTiles file beyond its header (first 16 KB).
page.on('request', (r) => {
  if (!r.url().includes('/gis/edificios/edificios.pmtiles')) return;
  const m = /bytes=(\d+)-/.exec(r.headers()['range'] || '');
  if (!m || Number(m[1]) >= 16384) tileHits.push(r.url());
});
// A local preview has no Netlify functions: let the auth gate through.
await page.route('**/api/auth**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
await page.addInitScript(() => { try { localStorage.setItem('cdt3d-hint-v1', '1'); } catch (e) {} });

const E = 'window.CDT3D.engines[window.CDT3D.engines.length - 1]';
const call = (expr) => page.evaluate(expr);

try {
  // 1. Index and the PMTiles file
  const ix = await (await fetch(BASE + '/gis/edificios/index.json')).json();
  check('index lists nine zones', (ix.cities || []).length === 9, (ix.cities || []).map((c) => c.id).join(', '));
  check('index carries source, height rule and limits', !!(ix.source && ix.limits && ix.height_rule));
  const pm = ix.pmtiles || {};
  const head = await fetch(BASE + pm.url, { headers: { Range: 'bytes=0-6' } });
  const magic = Buffer.from(await head.arrayBuffer()).toString('latin1');
  check('PMTiles file answers byte ranges', head.status === 206 && magic.startsWith('PMTiles'), `${pm.url} · ${head.status} · ${(pm.buildings || 0).toLocaleString('en-US')} buildings · z${pm.minzoom}-${pm.maxzoom}`);

  // Engine up
  console.log(`map page: ${PAGE}`);
  await page.goto(BASE + PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CDT3D && window.CDT3D.engines && window.CDT3D.engines.length > 0, null, { timeout: 90000 });
  const jump = (lng, lat, zoom) => call(`${E}.jumpCamera({ lng: ${lng}, lat: ${lat}, zoom: ${zoom}, bearing: -20, pitch: 55 })`);

  // 2. Statewide view
  await jump(-111.6, 25.4, 6.4);
  await call(`${E}.setBuildings(true)`);
  await page.waitForTimeout(4000);
  check('statewide view downloads no building tiles', tileHits.length === 0, `${tileHits.length} tile requests`);

  // 3. City views
  let last = null;
  for (const [name, lng, lat] of [['Loreto', -111.3435, 26.0115], ['La Paz', -110.312, 24.152]]) {
    const before = tileHits.length;
    await jump(lng, lat, 15.8);
    await page.waitForFunction(`${E}.buildingsStatus().rendered > 0`, null, { timeout: 90000 }).catch(() => {});
    // Let the visible tiles finish loading and the camera settle before reading the sample.
    let prev = -1;
    for (let k = 0; k < 10; k++) {
      await page.waitForTimeout(2000);
      const n = (await call(`${E}.buildingsStatus()`)).rendered;
      if (n > 0 && n === prev) break;
      prev = n;
    }
    last = await call(`${E}.buildingsStatus()`);
    const s = last.sample || {};
    const fields = ['h', 'hm', 'n', 'a', 'mz'].every((k) => k in s);
    check(`${name}: buildings drawn at city zoom`, last.rendered > 0, `${last.rendered} on screen, ${tileHits.length - before} tile reads`);
    check(`${name}: building carries height, storeys, area and block`, fields && s.h >= 3, JSON.stringify(s));
    check(`${name}: layers use the cdt-bld- prefix`, /^cdt-bld-/.test(last.layerOfSample || ''), last.layerOfSample || '');
  }

  // 5. Tap a building
  if (last && last.screenPoint) {
    await page.mouse.click(last.screenPoint.x, last.screenPoint.y);
    await page.waitForTimeout(1500);
    const fiche = await call(`(() => { const f = document.getElementById('shell-fiche'); return f && !f.hidden ? f.innerText.replace(/\\s+/g, ' ').slice(0, 160) : ''; })()`);
    const ok = /edificio|building/i.test(fiche);
    check('tapping a building opens its fiche', ok, fiche || 'no fiche', !ok);
  } else {
    check('tapping a building opens its fiche', false, 'no building point on screen', true);
  }

  // 4. Toggle
  await call(`${E}.setBuildings(false)`);
  await page.waitForTimeout(1500);
  const off = await call(`${E}.buildingsStatus()`);
  await call(`${E}.setBuildings(true)`);
  await page.waitForTimeout(2500);
  const on = await call(`${E}.buildingsStatus()`);
  check('setBuildings(false) hides and (true) restores', off.rendered === 0 && on.rendered > 0, `off ${off.rendered}, on ${on.rendered}`);
} catch (err) {
  check('test ran to the end', false, String((err && err.message) || err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed or pending`);
process.exit(failed.length ? 1 : 0);

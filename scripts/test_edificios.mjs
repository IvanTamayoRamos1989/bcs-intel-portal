#!/usr/bin/env node
// Building engine test (Claude). Against a served build:
//   npm run build && npx astro preview --port 4321
//   BASE=http://localhost:4321 node scripts/test_edificios.mjs
// Acceptance points from issue #130 (map):
//   1. index.json lists the nine zones, carries source and limits, and every tile URL answers.
//   2. The statewide view downloads no building tiles, even with buildings on.
//   3. Loreto and La Paz draw buildings at city zoom, with height, storeys, area and block fields.
//   4. setBuildings(false) hides them; setBuildings(true) brings them back.
//   5. Tapping a building opens its fiche. This needs the shell wiring of `cdt-bld-*` (Codex):
//      opening the building fiche is required.
// Exit code 0 only when all checks pass.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4321';
const PAGE = process.env.PAGE || '/consulta/';
const results = [];
function check(name, ok, detail = '', pending = false) {
  const tag = ok ? 'PASS' : pending ? 'PENDING' : 'FAIL';
  results.push({ name, ok: ok || pending });
  console.log(`${tag} · ${name}${detail ? ' · ' + detail : ''}`);
}

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const tileHits = [];
page.on('request', (r) => { if (r.url().includes('/gis/edificios/tiles/')) tileHits.push(r.url()); });
// A local preview has no Netlify functions: let the auth gate through.
await page.route('**/api/auth**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
await page.addInitScript(() => { try { localStorage.setItem('cdt3d-hint-v1', '1'); } catch (e) {} });

const E = 'window.CDT3D.engines[window.CDT3D.engines.length - 1]';
const call = (expr) => page.evaluate(expr);

try {
  // 1. Index and tiles
  const ix = await (await fetch(BASE + '/gis/edificios/index.json')).json();
  check('index lists nine zones', (ix.cities || []).length === 9, (ix.cities || []).map((c) => c.id).join(', '));
  let missing = 0;
  for (let i=0;i<ix.tiles.length;i+=5) await Promise.all(ix.tiles.slice(i,i+5).map(async (t) => { const r = await fetch(BASE + t.url, { method: 'HEAD' }); if (!r.ok) missing += 1; }));
  const total = ix.cities.reduce((n, c) => n + (c.buildings || 0), 0);
  check('every tile URL answers', missing === 0, `${ix.tiles.length} tiles, ${missing} missing, ${total.toLocaleString('en-US')} buildings`);
  check('index carries source, height rule and limits', !!(ix.source && ix.limits && ix.height_rule));

  // Engine up
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
    last = await call(`${E}.buildingsStatus()`);
    const s = last.sample || {};
    const fields = ['h', 'hm', 'n', 'a', 'mz'].every((k) => k in s);
    check(`${name}: buildings drawn at city zoom`, last.rendered > 0, `${last.rendered} on screen, ${last.tilesLoaded} tiles in memory, ${tileHits.length - before} requested`);
    check(`${name}: building carries height, storeys, area and block`, fields && s.h >= 3, JSON.stringify(s));
    check(`${name}: layers use the cdt-bld- prefix`, /^cdt-bld-/.test(last.layerOfSample || ''), last.layerOfSample || '');
  }

  // 5. Tap a building
  if (last && last.screenPoint) {
    await page.mouse.click(last.screenPoint.x, last.screenPoint.y);
    await page.waitForTimeout(1500);
    const fiche = await call(`(() => { const f = document.getElementById('shell-fiche'); return f && !f.hidden ? f.innerText.replace(/\\s+/g, ' ').slice(0, 160) : ''; })()`);
    const ok = /edificio|building/i.test(fiche);
    check('tapping a building opens its fiche', ok, fiche || 'no fiche');
  } else {
    check('tapping a building opens its fiche', false, 'no building point on screen');
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
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);


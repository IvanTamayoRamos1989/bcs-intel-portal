import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const BASE = 'https://bajacaliforniasur2050.com';
const OUT = '/workspace/BCSFP/11_bcs_hub/ux_redesign_shots';
const PASS = 'BCS2050';
const results = {};

async function login(page) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const pwd = page.locator('input[type="password"]');
  if (await pwd.count()) {
    await pwd.fill(PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 90000 }).catch(() => {}),
      page.locator('button[type="submit"]').click(),
    ]);
  }
  await page.waitForTimeout(800);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Gate check (fresh context without auth)
{
  const gateCtx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const gp = await gateCtx.newPage();
  const resp = await gp.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const title = await gp.title();
  const hasPwd = await gp.locator('input[type="password"]').count();
  results.gate = {
    status: resp?.status(),
    title,
    hasPasswordField: !!hasPwd,
    ok: hasPwd > 0 || title.toLowerCase().includes('acceso'),
  };
  await gateCtx.close();
}

await login(page);

// Inicio
await page.goto(BASE + '/explorar/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(1200);
const inicio = await page.evaluate(() => {
  const badge = document.querySelector('.draft-badge, #draft-badge');
  const badgeVisible = !!(badge && badge.offsetParent !== null && !badge.hidden);
  const h1 = document.querySelector('h1')?.textContent?.trim();
  const htmlProd = document.documentElement.classList.contains('is-prod');
  return {
    url: location.href,
    h1,
    badgeVisible,
    htmlProd,
    bodyHasBorrador: /BORRADOR|Borrador/.test(document.querySelector('.site-header')?.innerText || ''),
  };
});
results.inicio = inicio;
await page.screenshot({ path: path.join(OUT, 'prod_desktop_inicio.png'), fullPage: false });
results.screenshot = path.join(OUT, 'prod_desktop_inicio.png');

// proyectos-federales
await page.goto(BASE + '/proyectos-federales/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(800);
results.proyectos = await page.evaluate(() => ({
  url: location.href,
  h1: document.querySelector('h1')?.textContent?.trim(),
  ok: !!(document.querySelector('h1') || document.querySelector('main')),
}));

// mapa
await page.goto(BASE + '/mapas/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(3500);
results.mapa = await page.evaluate(() => ({
  url: location.href,
  toolbar: !!document.getElementById('gis-map-toolbar'),
  map: !!document.getElementById('gis-map'),
  leaflet: !!(window.L && document.querySelector('.leaflet-container')),
}));

// ontologia
await page.goto(BASE + '/ontologia/?node=rc_sibcs', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(2500);
await page.waitForFunction(() => window.__ontoCy && window.__ontoCy.nodes().length > 5, { timeout: 30000 }).catch(() => {});
results.ontologia = await page.evaluate(() => {
  const cy = window.__ontoCy;
  try { if (cy) { cy.resize(); cy.fit(cy.nodes(), 48); } } catch (e) {}
  return {
    url: location.href,
    nodes: cy ? cy.nodes().length : 0,
    chips: document.querySelectorAll('#onto-type-seg .onto-type-chip').length,
    cyH: document.getElementById('onto-cy')?.clientHeight || 0,
  };
});

// municipio hub
await page.goto(BASE + '/studio/los_cabos/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(1000);
results.dossier = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('.desktop-nav .nav-group')].map((g) => ({
    label: g.querySelector('[data-i18n]')?.textContent?.trim(),
    active: g.classList.contains('active'),
  }));
  return {
    url: location.href,
    h1: document.querySelector('h1')?.textContent?.trim(),
    territorioActive: groups.find((g) => g.label === 'Territorio')?.active === true,
    masActive: groups.find((g) => g.label === 'Más')?.active === true,
  };
});

// Chat API
const cookies = await ctx.cookies();
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
async function api(pathname, opts = {}) {
  const r = await fetch(BASE + pathname, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Cookie: cookieHeader,
    },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text: text.slice(0, 400) };
}

results.chat = await api('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '¿Cuál es la situación del agua en Los Cabos?' }),
});
if (results.chat.json) {
  const a = results.chat.json.answer || results.chat.json.reply || results.chat.json.text || results.chat.json.message;
  results.chat.hasAnswer = typeof a === 'string' && a.length > 20;
  results.chat.answerPreview = typeof a === 'string' ? a.slice(0, 180) : null;
  results.chat.keys = Object.keys(results.chat.json);
}

results.voice = await api('/api/voice-token', { method: 'GET' });
if (!results.voice.json) {
  results.voice = await api('/api/voice-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}
if (results.voice.json) {
  results.voice.hasToken = !!(results.voice.json.token || results.voice.json.accessToken || results.voice.json.client_secret);
  results.voice.keys = Object.keys(results.voice.json);
}

await browser.close();
fs.writeFileSync('/tmp/prod_verify_pass5.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

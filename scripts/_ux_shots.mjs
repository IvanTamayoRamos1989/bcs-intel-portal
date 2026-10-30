import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'https://6ab52cfc201b845ba478340e--bcs-intel-portal.netlify.app';
const OUT = '/workspace/BCSFP/11_bcs_hub/ux_redesign_shots';
const PASS = 'BCS2050';

async function login(page) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  const pwd = page.locator('input[type="password"]');
  if (await pwd.count()) {
    await pwd.fill(PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {}),
      page.locator('button[type="submit"]').click(),
    ]);
  }
  await page.waitForTimeout(1500);
  if (page.url().endsWith('/') || page.url().match(/\/$/)) {
    await page.goto(BASE + '/explorar/', { waitUntil: 'networkidle', timeout: 60000 });
  }
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.waitForTimeout(800);
  await page.screenshot({ path: file, fullPage: false });
  console.log('saved', file);
}

async function runViewport(browser, label, size) {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: label === 'mobile' ? 2 : 1,
    userAgent: label === 'mobile'
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await context.newPage();
  await login(page);

  await page.goto(BASE + '/explorar/', { waitUntil: 'networkidle', timeout: 60000 });
  await shot(page, `${label}_inicio.png`);

  await page.goto(BASE + '/mapas/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await shot(page, `${label}_territorio_mapas.png`);
  if (label === 'desktop') {
    await shot(page, `desktop_mapa_panel.png`);
  }

  await page.goto(BASE + '/proyectos-federales/', { waitUntil: 'networkidle', timeout: 60000 });
  await shot(page, `${label}_datos_proyectos_federales.png`);

  await page.goto(BASE + '/studio/los_cabos/', { waitUntil: 'networkidle', timeout: 60000 });
  await shot(page, `${label}_lugar_dossier_los_cabos.png`);

  await page.goto(BASE + '/noticias/', { waitUntil: 'networkidle', timeout: 60000 });
  await shot(page, `${label}_noticias.png`);

  if (label === 'desktop') {
    await page.goto(BASE + '/catalogo/', { waitUntil: 'networkidle', timeout: 60000 });
    await shot(page, `desktop_catalogo.png`);
  }

  await page.goto(BASE + '/explorar/', { waitUntil: 'networkidle', timeout: 60000 });
  const openBtn = page.locator('#bcs-chat-open, .bcs-chat-tab, [data-open-chat], button:has-text("Consulta"), button:has-text("Ask")');
  if (await openBtn.count()) {
    await openBtn.first().click().catch(() => {});
    await page.waitForTimeout(800);
  } else {
    await page.evaluate(() => {
      const el = document.getElementById('bcs-chat');
      if (el) el.setAttribute('data-open', 'true');
      document.body.classList.add('chat-drawer-open');
      const panel = document.getElementById('bcs-chat-panel');
      if (panel) panel.style.display = 'flex';
    });
    await page.waitForTimeout(500);
  }
  await shot(page, `${label}_chat_open.png`);

  await context.close();
}

const browser = await chromium.launch({ headless: true });
await runViewport(browser, 'desktop', { width: 1440, height: 900 });
await runViewport(browser, 'mobile', { width: 390, height: 844 });
await browser.close();
console.log('done');
fs.readdirSync(OUT).forEach((f) => console.log(path.join(OUT, f)));

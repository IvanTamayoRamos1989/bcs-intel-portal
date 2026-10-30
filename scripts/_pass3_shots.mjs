import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'https://6ab530847b500f0a74642646--bcs-intel-portal.netlify.app';
const OUT = '/workspace/BCSFP/11_bcs_hub/ux_redesign_shots';
const PASS = 'BCS2050';

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
  await page.waitForTimeout(1000);
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.waitForTimeout(700);
  await page.screenshot({ path: file, fullPage: false });
  console.log('saved', file);
}

const browser = await chromium.launch({ headless: true });

// desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(BASE + '/explorar/', { waitUntil: 'networkidle', timeout: 90000 });
  await shot(page, 'pass3_desktop_inicio.png');
  await page.goto(BASE + '/studio/los_cabos/', { waitUntil: 'networkidle', timeout: 90000 });
  await shot(page, 'pass3_desktop_dossier_los_cabos.png');
  await page.goto(BASE + '/energia/', { waitUntil: 'networkidle', timeout: 90000 });
  await shot(page, 'pass3_desktop_tema_energia.png');
  await page.goto(BASE + '/ontologia/?node=rc_sibcs', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(2800);
  await shot(page, 'pass3_desktop_ontologia_sheet.png');
  await page.goto(BASE + '/mapas/?layers=federal_projects,energy_assets', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3500);
  await shot(page, 'pass3_desktop_mapa_federales.png');
  await ctx.close();
}
// mobile
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    colorScheme: 'light',
  });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(BASE + '/explorar/', { waitUntil: 'networkidle', timeout: 90000 });
  await shot(page, 'pass3_mobile_inicio.png');
  await page.goto(BASE + '/studio/los_cabos/', { waitUntil: 'networkidle', timeout: 90000 });
  await shot(page, 'pass3_mobile_dossier_los_cabos.png');
  await page.goto(BASE + '/energia/', { waitUntil: 'networkidle', timeout: 90000 });
  await shot(page, 'pass3_mobile_tema_energia.png');
  await page.goto(BASE + '/mapas/?layers=federal_projects', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3000);
  const toggle = page.locator('#gis-drawer-toggle, button:has-text("Capas")');
  if (await toggle.count()) await toggle.first().click().catch(()=>{});
  await page.waitForTimeout(500);
  await shot(page, 'pass3_mobile_mapa.png');
  await ctx.close();
}
// dark
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await login(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(BASE + '/explorar/', { waitUntil: 'networkidle', timeout: 90000 });
  await shot(page, 'pass3_desktop_inicio_dark.png');
  await ctx.close();
}
await browser.close();
console.log('done', BASE);
fs.readdirSync(OUT).filter(f => f.startsWith('pass3_')).sort().forEach(f => console.log(path.join(OUT, f)));

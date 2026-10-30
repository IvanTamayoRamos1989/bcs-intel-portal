import { chromium } from 'playwright';
import path from 'path';
const BASE = 'https://6ab5336d983f871c25ea823b--bcs-intel-portal.netlify.app';
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
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  console.log('saved', name);
}

const browser = await chromium.launch({ headless: true });

// desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);

  await page.goto(BASE + '/studio/los_cabos/', { waitUntil: 'networkidle', timeout: 90000 });
  await shot(page, 'pass4_desktop_dossier_los_cabos.png');

  await page.goto(BASE + '/ontologia/?node=rc_sibcs', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3500);
  await shot(page, 'pass4_desktop_ontologia.png');

  await page.goto(BASE + '/mapas/', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(4000);
  await shot(page, 'pass4_desktop_mapa_default.png');

  await page.goto(BASE + '/explorar/', { waitUntil: 'networkidle', timeout: 90000 });
  // open chat if needed
  const openBtn = page.locator('#bcs-chat-open, .bcs-chat-tab, button:has-text("Consulta")');
  if (await openBtn.count()) await openBtn.first().click().catch(()=>{});
  await page.waitForTimeout(600);
  await shot(page, 'pass4_desktop_chat.png');
  await ctx.close();
}

// mobile map
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(BASE + '/mapas/', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3500);
  await shot(page, 'pass4_mobile_mapa.png');
  await ctx.close();
}

await browser.close();
console.log('done', BASE);

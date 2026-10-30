import { chromium } from 'playwright';
const BASE = 'https://6ab5316070bdf40a76a5365f--bcs-intel-portal.netlify.app';
const OUT = '/workspace/BCSFP/11_bcs_hub/ux_redesign_shots';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
const pwd = page.locator('input[type="password"]');
if (await pwd.count()) {
  await pwd.fill('BCS2050');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 90000 }).catch(() => {}),
    page.locator('button[type="submit"]').click(),
  ]);
}
await page.goto(BASE + '/ontologia/?node=rc_sibcs', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(4500);
const info = await page.evaluate(() => {
  const cy = window.__ontoCy;
  if (!cy) return { err: 'no cy' };
  let n = cy.getElementById('rc_sibcs');
  if (!n.length) n = cy.nodes().first();
  if (!n.length) return { err: 'no nodes', n: cy.nodes().length };
  cy.nodes().unselect();
  n.select();
  cy.fit(n.closedNeighborhood(), 40);
  // trigger same handlers as tap if possible
  n.emit('tap');
  const sheet = document.getElementById('onto-detail');
  return { id: n.id(), sheet: sheet ? sheet.innerText.slice(0, 240) : null, n: cy.nodes().length };
});
console.log(info);
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + '/pass3_desktop_ontologia_sheet.png', fullPage: false });
console.log('saved', BASE);
await browser.close();

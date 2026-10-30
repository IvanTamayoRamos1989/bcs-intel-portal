import { chromium } from 'playwright';
import path from 'path';
const BASE = 'https://6ab5350241d647346b564f8c--bcs-intel-portal.netlify.app';
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
  await page.waitForTimeout(600);
}

async function waitOntoReady(page) {
  await page.waitForFunction(() => {
    const cy = window.__ontoCy;
    if (!cy) return false;
    return cy.nodes().length > 5;
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const el = document.getElementById('onto-graph-shell') || document.getElementById('onto-cy');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const cy = window.__ontoCy;
    if (!cy) return { err: 'no cy' };
    try { cy.resize(); } catch (e) {}
    const chips = [...document.querySelectorAll('#onto-type-seg .onto-type-chip')].map((b) => b.textContent.trim());
    const sheet = document.getElementById('onto-detail');
    const prefer = cy.getElementById('muni_los_cabos');
    const n = (prefer && prefer.length) ? prefer : cy.nodes().first();
    if (n && n.length) {
      try {
        cy.elements().removeClass('faded highlighted focus-center');
        cy.elements().addClass('faded');
        n.closedNeighborhood().removeClass('faded').addClass('highlighted');
        n.addClass('focus-center');
        cy.fit(n.closedNeighborhood(), 40);
        n.emit('tap');
      } catch (e) {
        try { cy.fit(cy.nodes(), 48); } catch (e2) {}
      }
    } else {
      try { cy.fit(cy.nodes(), 48); } catch (e) {}
    }
    return {
      nodes: cy.nodes().length,
      edges: cy.edges().length,
      chips: chips.slice(0, 12),
      sheet: sheet ? sheet.innerText.slice(0, 280) : null,
      cyH: document.getElementById('onto-cy')?.clientHeight,
      wrapH: document.querySelector('.onto-cy-wrap')?.clientHeight,
    };
  });
  console.log('onto', info);
  await page.waitForTimeout(900);
  return info;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  console.log('saved', name);
}

const browser = await chromium.launch({ headless: true });

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);

  await page.goto(BASE + '/ontologia/?node=rc_sibcs', { waitUntil: 'networkidle', timeout: 90000 });
  await waitOntoReady(page);
  await shot(page, 'pass5_desktop_ontologia.png');

  await page.goto(BASE + '/studio/los_cabos/', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(1200);
  const navActive = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.desktop-nav .nav-group')].map((g) => ({
      label: g.querySelector('[data-i18n]')?.textContent?.trim(),
      active: g.classList.contains('active'),
    }));
    return groups;
  });
  console.log('nav', navActive);
  await shot(page, 'pass5_desktop_dossier_los_cabos.png');

  await page.goto(BASE + '/mapas/', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(4000);
  const mapTb = await page.evaluate(() => {
    const tb = document.getElementById('gis-map-toolbar');
    return {
      present: !!tb,
      kids: tb ? tb.children.length : 0,
      panelOpacity: !!document.querySelector('.gis-panel #gis-opacity'),
    };
  });
  console.log('map', mapTb);
  await shot(page, 'pass5_desktop_mapa.png');
  await ctx.close();
}

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
  await page.goto(BASE + '/ontologia/?node=rc_sibcs', { waitUntil: 'networkidle', timeout: 90000 });
  await waitOntoReady(page);
  await shot(page, 'pass5_mobile_ontologia.png');
  await ctx.close();
}

await browser.close();
console.log('done', BASE);

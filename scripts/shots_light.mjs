import { chromium } from 'playwright';
const base = process.argv[2]; const prefix = process.argv[3];
const pages = [['gate','/'],['explorar','/explorar/'],['pregunta_east_cape','/preguntas/sq-east-cape-edge/'],['inmobiliario','/inmobiliario/'],['mapas','/mapas/'],['ontologia','/ontologia/'],['proyectos_federales','/proyectos-federales/'],['studio_los_cabos','/studio/los_cabos/']];
const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
if (base.startsWith('https')) {
  const r = await page.request.post(base + '/api/auth', { data: { password: 'BCS2050' } });
  console.log('auth', r.status());
}
if (!base.startsWith('https')) await page.route('**/api/auth', r => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
const out = [];
for (const [name, path] of pages) {
  const resp = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => null);
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const cs = e => e ? getComputedStyle(e) : null;
    const q = s => document.querySelector(s);
    const b = cs(document.body), h = cs(q('header')), m = matchMedia('(prefers-color-scheme: dark)').matches;
    return { osDark: m, title: document.title, bodyBg: b.backgroundColor, bodyColor: b.color, htmlBg: cs(document.documentElement).backgroundColor, headerBg: h && h.backgroundColor, mies: /MIES/.test(document.body.innerText), borrador: /BORRADOR/i.test(document.body.innerText) };
  });
  out.push({ name, status: resp && resp.status(), ...info });
  await page.screenshot({ path: `ux_redesign_shots/${prefix}${name}.png` });
}
// chat sidebar
await page.goto(base + '/preguntas/sq-east-cape-edge/', { waitUntil: 'networkidle' });
const tab = await page.$('.bcs-chat-tab, [data-chat-open], button[aria-controls*="chat"]');
if (tab) { await tab.click().catch(()=>{}); await page.waitForTimeout(1000); }
const chat = await page.evaluate(() => { const p = document.querySelector('.bcs-chat-panel, .bcs-chat, [class*="bcs-chat"]'); const i = document.querySelector('.bcs-chat-input, textarea, input[type=text]'); return { panelBg: p && getComputedStyle(p).backgroundColor, inputBg: i && getComputedStyle(i).backgroundColor, inputColor: i && getComputedStyle(i).color }; });
out.push({ name: 'chat', tabFound: !!tab, ...chat });
await page.screenshot({ path: `ux_redesign_shots/${prefix}chat_sidebar.png` });
console.log(JSON.stringify(out, null, 1));
await browser.close();

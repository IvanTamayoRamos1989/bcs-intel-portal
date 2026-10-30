import { chromium } from 'playwright';
const BASE = process.argv[2] || 'https://bajacaliforniasur2050.com';
const TAG = process.argv[3] || 'after';
const OUT = 'ux_redesign_shots/hero_clean/';
const b = await chromium.launch();
async function login(page){ await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  const pwd = page.locator('input[type=password]'); if (await pwd.count()) { await pwd.first().fill('BCS2050'); await pwd.first().press('Enter'); await page.waitForTimeout(2500);} }
for (const [name, vp] of [['desk',{width:1440,height:900}],['mob',{width:390,height:844}]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 }); const page = await ctx.newPage();
  await login(page); await page.goto(BASE + '/inicio', { waitUntil: 'networkidle', timeout: 60000 }); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}${TAG}_${name}.png` });
  if (name === 'desk' && !['before','preview'].includes(TAG)) {
    for (const [i,q] of [['lapaz','Cuanta gente vive en la paz?'],]) {
      await page.goto(BASE + '/inicio', { waitUntil: 'networkidle' });
      await page.fill('#bcs-chat-input', q); await page.press('#bcs-chat-input','Enter').catch(()=>{});
      await page.locator('#bcs-chat-form button[type=submit]').click().catch(()=>{});
      await page.waitForSelector('.bcs-fu', { timeout: 90000 }).catch(()=>{}); await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}${TAG}_${name}_${i}.png`, fullPage: false });
      const msgs = page.locator('#bcs-chat-msgs'); await msgs.evaluate(e=>e.scrollTop=e.scrollHeight); await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}${TAG}_${name}_${i}_bottom.png` });
    }
  }
  await ctx.close();
}
await b.close();

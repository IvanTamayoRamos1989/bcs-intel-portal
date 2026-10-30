import { chromium } from 'playwright';
const b = await chromium.launch(); const c = await b.newContext({ colorScheme: 'dark', viewport:{width:1440,height:900} }); const p = await c.newPage();
await p.goto('https://bajacaliforniasur2050.com/', { waitUntil: 'networkidle' });
console.log(JSON.stringify(await p.evaluate(()=>({t:document.title,bg:getComputedStyle(document.body).backgroundColor,dark:matchMedia('(prefers-color-scheme: dark)').matches}))));
await p.screenshot({ path: 'ux_redesign_shots/white_gate.png' }); await b.close();
